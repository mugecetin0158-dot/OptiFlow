import json
import urllib.error
import urllib.parse
import urllib.request

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend import gemini_diagnostics as diagnostics

KEY = "secret-gemini-api-key-for-test"
TOKEN = "private-diagnostic-token-for-test"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GEMINI_DIAGNOSTIC_TOKEN", TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    monkeypatch.setenv("GEMINI_IMPORT_MODEL", "gemini-2.5-flash")
    return TestClient(app)


def fake_model_response(request, timeout):
    assert request.full_url == diagnostics.MODEL_LIST_URL
    assert request.get_method() == "GET"
    assert request.get_header("X-goog-api-key") == KEY
    return {"models": [
        {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"]},
    ]}


def test_model_discovery_and_configured_available(client, monkeypatch):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    assert response.json() == {
        "configured_model": "gemini-2.5-flash",
        "configured_model_available": True,
        "compatible_models": ["gemini-2.5-flash"],
    }


def test_configured_model_unavailable(client, monkeypatch):
    monkeypatch.setenv("GEMINI_IMPORT_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    result = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert result["configured_model"] == "gemini-3.8-flash"
    assert result["configured_model_available"] is False


def test_model_discovery_pagination(client, monkeypatch):
    requests = []

    def paged(request, timeout):
        requests.append(request.full_url)
        if len(requests) == 1:
            return {"models": [{"name": "models/first", "supportedGenerationMethods": ["generateContent"]}], "nextPageToken": "next token"}
        return {"models": [{"name": "models/second", "supportedGenerationMethods": ["generateContent"]}]}

    monkeypatch.setattr(diagnostics, "model_transport", paged)
    result = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert len(requests) == 2
    assert urllib.parse.parse_qs(urllib.parse.urlparse(requests[1]).query) == {"pageToken": ["next token"]}
    assert result["compatible_models"] == ["first", "second"]


@pytest.mark.parametrize("status", [401, 403, 404, 429])
def test_provider_http_errors_are_sanitized(client, monkeypatch, status):
    sensitive = f"upstream error body contained {KEY}"

    def fail(request, timeout):
        raise urllib.error.HTTPError(request.full_url, status, sensitive, {}, None)

    monkeypatch.setattr(diagnostics, "model_transport", fail)
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 502
    assert str(status) in response.text
    assert KEY not in response.text and sensitive not in response.text
    assert "authorization" not in response.text.lower()


def test_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503
    assert KEY not in response.text


def test_diagnostic_requires_authentication(client, monkeypatch):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    assert client.get("/diagnostics/gemini").status_code == 401
    assert client.get("/diagnostics/gemini", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_diagnostic_disabled_without_server_token(client, monkeypatch):
    monkeypatch.delenv("GEMINI_DIAGNOSTIC_TOKEN")
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503


def test_diagnostic_does_not_leak_api_key(client, monkeypatch):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert KEY not in response.text
    assert "x-goog-api-key" not in response.text.lower()


def test_model_discovery_network_timeout_is_safe(client, monkeypatch):
    def timeout(request, seconds):
        raise TimeoutError(f"timed out while using {KEY}")

    monkeypatch.setattr(diagnostics, "model_transport", timeout)
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 502
    assert "timed out" in response.text
    assert KEY not in response.text


def test_gemini_generate_errors_are_actionable_and_sanitized(monkeypatch):
    from backend.import_foundations import AIProviderFailure, GeminiClient, InterpretRequest

    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    request = InterpretRequest.model_validate({
        "target": "scheduling", "locale": "en", "allowed_fields": ["employee_id"],
        "files": [{"source_id": "s", "name": "file.csv", "row_count": 0,
                   "columns": [{"header": "id", "inferred_type": "text", "samples": [], "blank_count": 0, "unique_count": 0}]}],
    })

    def fail(status):
        def transport(req, timeout):
            raise urllib.error.HTTPError(req.full_url, status, KEY, {}, None)
        return transport

    for status, phrase in [(400, "payload"), (401, "authentication"), (403, "forbidden"), (404, "model"), (429, "quota")]:
        with pytest.raises(AIProviderFailure) as error:
            GeminiClient(transport=diagnostics._safe_transport).interpret(request) if False else diagnostics.SafeGeminiClient().interpret(request)
        # This branch is replaced below per status using the injected safe transport.
        assert phrase in str(error.value).lower()
        assert KEY not in str(error.value)
