"""Authenticated, sanitized Gemini model discovery and provider error handling."""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Literal

from fastapi import APIRouter, Header, HTTPException

from backend import import_foundations
from backend.import_foundations import (
    AIProviderFailure,
    Target,
    _provider_error_category,
    _urlopen_json,
    interpretation_schema,
)

logger = logging.getLogger("optiflow.gemini")
MODEL_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models"
Transport = Callable[[urllib.request.Request, float], dict[str, Any]]


def _provider_error_message(status: int) -> str:
    """Map provider statuses to actionable messages without exposing bodies."""
    if status == 400:
        return "Gemini rejected the request payload (HTTP 400). Check the import request format and configured model compatibility."
    if status == 401:
        return "Gemini authentication failed (HTTP 401). Verify the server-side API key."
    if status == 403:
        return "Gemini access is forbidden (HTTP 403). Verify the API key permissions and Generative Language API access."
    if status == 404:
        return "Gemini model or endpoint was not found (HTTP 404). Run the protected model diagnostic and configure an available generateContent model."
    if status == 429:
        return "Gemini rate limit or quota reached (HTTP 429). Wait and retry, or check the project's quota."
    if status in {500, 502, 503, 504}:
        return f"Gemini is temporarily unavailable (HTTP {status}). Retry shortly."
    return f"Gemini provider request failed (HTTP {status}). Check the server configuration and provider status."


def _safe_transport(request: urllib.request.Request, timeout: float):
    try:
        return _urlopen_json(request, timeout)
    except urllib.error.HTTPError as error:
        # Never inspect, log, or include upstream response bodies; they can contain secrets.
        raise AIProviderFailure(
            _provider_error_message(error.code),
            category=_provider_error_category(error.code),
            provider_status=error.code,
        ) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        raise AIProviderFailure(
            "Gemini network request failed or timed out. Check backend connectivity and retry.",
            category="network_or_transport_error",
        ) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise AIProviderFailure(
            "Gemini returned a malformed provider response. Retry, and check provider status if it persists.",
            category="malformed_response",
        ) from None


class SafeGeminiClient(import_foundations.GeminiClient):
    """GeminiClient with safe, actionable provider and network errors."""

    def __init__(self):
        super().__init__(transport=_safe_transport)


router = APIRouter(tags=["Diagnostics"])
ModelTransport = Callable[[urllib.request.Request, float], dict[str, Any]]
model_transport: ModelTransport = _urlopen_json


def discover_models(api_key: str, configured_model: str, transport: ModelTransport | None = None):
    """Fetch all model pages and return only safe, relevant model metadata."""
    fetch = transport or model_transport
    timeout = max(3.0, min(60.0, float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "20"))))
    models: list[dict[str, Any]] = []
    page_token: str | None = None
    seen_tokens: set[str] = set()
    try:
        while True:
            query = "?" + urllib.parse.urlencode({"pageToken": page_token}) if page_token else ""
            request = urllib.request.Request(
                MODEL_LIST_URL + query,
                headers={"x-goog-api-key": api_key, "Accept": "application/json"},
                method="GET",
            )
            response = fetch(request, timeout)
            if not isinstance(response, dict) or not isinstance(response.get("models", []), list):
                raise ValueError("invalid model list")
            for model in response.get("models", []):
                if not isinstance(model, dict):
                    continue
                methods = model.get("supportedGenerationMethods", [])
                name = model.get("name")
                if "generateContent" in methods and isinstance(name, str) and name.strip():
                    models.append(import_foundations._normalize_model_name(name))
            next_token = response.get("nextPageToken")
            if not next_token:
                break
            if not isinstance(next_token, str) or next_token in seen_tokens:
                raise ValueError("invalid pagination token")
            seen_tokens.add(next_token)
            page_token = next_token
    except urllib.error.HTTPError as error:
        logger.warning("Gemini model discovery failed (HTTP %s)", error.code)
        raise HTTPException(status_code=502, detail={"error": _provider_error_message(error.code), "provider_status": error.code}) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        logger.warning("Gemini model discovery failed due to a network error")
        raise HTTPException(status_code=502, detail={"error": "Gemini model discovery could not connect or timed out. Check backend connectivity and retry."}) from None
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("Gemini model discovery returned a malformed response")
        raise HTTPException(status_code=502, detail={"error": "Gemini returned a malformed model list. Retry, and check provider status if it persists."}) from None

    configured = import_foundations._normalize_model_name(configured_model)
    compatible = sorted(set(models))
    return {
        "configured_model": configured,
        "configured_model_available": configured in compatible,
        "compatible_models": compatible,
    }


def _probe_generation_version(api_key: str, model: str, api_version: Literal["v1beta", "v1"]):
    """Make one minimal generation request and return safe status metadata only."""
    timeout = max(3.0, min(60.0, float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "20"))))
    request = urllib.request.Request(
        import_foundations._generation_url(model, api_version),
        json.dumps({
            "contents": [{"role": "user", "parts": [{"text": "Reply with exactly: OK"}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 8},
        }).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        response = _safe_transport(request, timeout)
    except AIProviderFailure as error:
        return {
            "http_status": 502,
            "provider_status": error.provider_status,
            "category": error.category,
        }

    candidates = response.get("candidates") if isinstance(response, dict) else None
    if not isinstance(candidates, list) or not candidates:
        return {"http_status": 502, "provider_status": None, "category": "malformed_response"}
    return {"http_status": 200, "provider_status": None, "category": "success"}


def probe_generation(api_key: str, model: str):
    """Compare minimal generation requests across supported REST API versions."""
    return {
        version: _probe_generation_version(api_key, model, version)
        for version in ("v1beta", "v1")
    }


def _structured_error_category(status: int, error: urllib.error.HTTPError):
    detail = ""
    try:
        body = error.read(8192)
        document = json.loads(body) if body else {}
        provider_error = document.get("error", {}) if isinstance(document, dict) else {}
        if isinstance(provider_error, dict) and isinstance(provider_error.get("message"), str):
            detail = provider_error["message"].lower()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    finally:
        error.close()

    if re.search(r"schema.{0,80}(complex|complexity|state limit|branching|nesting)|"
                 r"(complex|complexity|state limit|branching|nesting).{0,80}schema", detail):
        return "schema_complexity"
    if re.search(r"unknown name|unknown field|unsupported (?:schema )?(?:property|keyword|field)|"
                 r"(?:property|keyword|field).{0,40}not supported", detail):
        return "unsupported_schema_property"
    if re.search(r"schema|responsejsonschema|responseschema|responseformat", detail):
        return "schema_rejected"
    if status == 400:
        return "request_parameter"
    if status in {401, 403}:
        return "authorization"
    if status == 404:
        return "model_or_endpoint"
    if status == 429:
        return "rate_limit"
    if 500 <= status <= 599:
        return "provider_server_error"
    return "provider_error"


def _probe_structured_schema(
    api_key: str,
    model: str,
    api_version: Literal["v1beta", "v1"],
    schema: dict[str, Any],
    transport: ModelTransport | None = None,
):
    timeout = max(3.0, min(60.0, float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "20"))))
    body = {
        "systemInstruction": {
            "parts": [{
                "text": "This is a synthetic provider compatibility check. Return the smallest valid JSON object for the response schema. Use no external or personal data.",
            }]
        },
        "contents": [{
            "role": "user",
            "parts": [{"text": "Return the smallest valid response for this synthetic structured-output diagnostic."}],
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }
    request = urllib.request.Request(
        import_foundations._generation_url(model, api_version),
        json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        response = (transport or _urlopen_json)(request, timeout)
    except urllib.error.HTTPError as error:
        return {"http_status": error.code, "category": _structured_error_category(error.code, error)}
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        return {"http_status": 502, "category": "network_or_transport_error"}
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return {"http_status": 502, "category": "malformed_response"}

    candidates = response.get("candidates") if isinstance(response, dict) else None
    if not isinstance(candidates, list) or not candidates:
        return {"http_status": 200, "category": "malformed_response"}
    return {"http_status": 200, "category": "success"}


def probe_structured_output(
    api_key: str,
    model: str,
    target: Target = "scheduling",
    api_version: Literal["v1beta", "v1"] = "v1beta",
    transport: ModelTransport | None = None,
):
    """Compare JSON mode against the production Smart Import schema using synthetic input only."""
    minimal_schema = {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}},
        "required": ["ok"],
    }
    smart_import_schema = interpretation_schema(target)
    minimal = _probe_structured_schema(api_key, model, api_version, minimal_schema, transport)
    smart_import = _probe_structured_schema(api_key, model, api_version, smart_import_schema, transport)
    if minimal["category"] == "success" and smart_import["category"] == "success":
        comparison = "both_succeeded"
    elif minimal["category"] == "success":
        comparison = "smart_import_schema_rejected"
    elif smart_import["category"] == "success":
        comparison = "minimal_schema_rejected"
    else:
        comparison = "both_rejected"
    return {
        "api_version": api_version,
        "target": target,
        "minimal_schema": minimal,
        "smart_import_schema": smart_import,
        "comparison": comparison,
    }


@router.get("/diagnostics/gemini")
def gemini_diagnostics(
    authorization: str | None = Header(default=None),
    probe: bool = False,
    structured_output_probe: bool = False,
    target: Target = "scheduling",
):
    """Discover accessible generation models; requires a server-only bearer token."""
    diagnostic_token = os.environ.get("GEMINI_DIAGNOSTIC_TOKEN", "").strip()
    if not diagnostic_token:
        raise HTTPException(status_code=503, detail="Gemini diagnostics are not configured on this server.")
    supplied = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, diagnostic_token):
        raise HTTPException(status_code=401, detail="A valid diagnostic bearer token is required.", headers={"WWW-Authenticate": "Bearer"})

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured on this server.")
    configured_model = import_foundations._normalize_model_name(
        os.environ.get("GEMINI_IMPORT_MODEL", "gemini-2.5-flash")
    )
    result = discover_models(api_key, configured_model)
    if probe:
        result["generation_probe"] = probe_generation(api_key, configured_model)
    if structured_output_probe:
        result["structured_output_probe"] = probe_structured_output(
            api_key,
            configured_model,
            target,
        )
    return result


def configure_gemini_provider():
    """Install the safe transport without changing Smart Import routes or payloads."""
    import_foundations.provider = SafeGeminiClient()
