import io
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


def test_generation_probe_is_opt_in_and_sends_only_synthetic_prompt(client, monkeypatch):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    generation_requests = []

    def fake_generation(request, timeout):
        generation_requests.append(request)
        return {"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}

    monkeypatch.setattr(diagnostics, "_urlopen_json", fake_generation)
    response = client.get("/diagnostics/gemini", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    assert "generation_probe" not in response.json()
    assert generation_requests == []

    response = client.get(
        "/diagnostics/gemini?probe=true",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 200
    assert [request.full_url for request in generation_requests] == [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",
    ]
    for request in generation_requests:
        assert request.get_method() == "POST"
        assert request.get_header("X-goog-api-key") == KEY
        body = json.loads(request.data)
        assert body["contents"] == [{"role": "user", "parts": [{"text": "Reply with exactly: OK"}]}]
    assert KEY not in response.text and "OK" not in response.text
    assert response.json()["generation_probe"] == {
        "v1beta": {"http_status": 200, "provider_status": None, "category": "success"},
        "v1": {"http_status": 200, "provider_status": None, "category": "success"},
    }


def test_generation_probe_compares_versions_and_sanitizes_provider_errors(client, monkeypatch):
    monkeypatch.setenv("GEMINI_IMPORT_MODEL", "models/gemini-2.5-flash")
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    sensitive = f"upstream response contained {KEY} and spreadsheet data"
    seen = []

    def fail_generation(request, timeout):
        seen.append(request.full_url)
        status = 404 if "/v1beta/" in request.full_url else 403
        raise urllib.error.HTTPError(request.full_url, status, sensitive, {}, None)

    monkeypatch.setattr(diagnostics, "_urlopen_json", fail_generation)
    response = client.get(
        "/diagnostics/gemini?probe=true",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 200
    assert seen == [
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-flash:generateContent",
        "https://generativelanguage.googleapis.com/v1/models/"
        "gemini-2.5-flash:generateContent",
    ]
    assert response.json()["configured_model"] == "gemini-2.5-flash"
    assert response.json()["generation_probe"] == {
        "v1beta": {
            "http_status": 502,
            "provider_status": 404,
            "category": "model_or_method_not_found",
        },
        "v1": {
            "http_status": 502,
            "provider_status": 403,
            "category": "authorization",
        },
    }
    assert KEY not in response.text
    assert "spreadsheet data" not in response.text and sensitive not in response.text


def test_structured_output_probe_is_protected_synthetic_and_uses_same_request_context(client, monkeypatch):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    requests = []

    def fake_generation(request, timeout):
        requests.append(request)
        return {"candidates": [{"content": {"parts": [{"text": '{"ok":true}'}]}}]}

    monkeypatch.setattr(diagnostics, "_urlopen_json", fake_generation)
    unauthorized = client.get("/diagnostics/gemini?structured_output_probe=true")
    assert unauthorized.status_code == 401
    assert requests == []

    response = client.get(
        "/diagnostics/gemini?structured_output_probe=true&target=allocation",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 200
    assert len(requests) == 2
    assert requests[0].full_url == requests[1].full_url == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    )
    assert all(request.get_method() == "POST" for request in requests)
    assert all(request.get_header("X-goog-api-key") == KEY for request in requests)
    bodies = [json.loads(request.data) for request in requests]
    assert bodies[0]["generationConfig"]["responseJsonSchema"] == {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}},
        "required": ["ok"],
    }
    assert bodies[1]["generationConfig"]["responseJsonSchema"] == (
        diagnostics.import_foundations.interpretation_schema("allocation")
    )
    for body in bodies:
        assert body["systemInstruction"] == bodies[0]["systemInstruction"]
        assert body["contents"] == bodies[0]["contents"]
        assert "synthetic" in body["contents"][0]["parts"][0]["text"]
        assert "spreadsheet" not in body["contents"][0]["parts"][0]["text"].lower()
        assert KEY not in json.dumps(body)
    assert {
        key: value
        for key, value in bodies[0]["generationConfig"].items()
        if key != "responseJsonSchema"
    } == {
        key: value
        for key, value in bodies[1]["generationConfig"].items()
        if key != "responseJsonSchema"
    }

    result = response.json()["structured_output_probe"]
    assert result["api_version"] == "v1beta"
    assert result["target"] == "allocation"
    assert result["comparison"] == "both_succeeded"
    assert result["minimal_schema"] == {"http_status": 200, "category": "success"}
    assert result["smart_import_schema"] == {"http_status": 200, "category": "success"}
    assert KEY not in response.text and '{"ok":true}' not in response.text


@pytest.mark.parametrize(
    ("provider_message", "category"),
    [
        ("Structured response schema exceeds the state complexity limit.", "schema_complexity"),
        ("Invalid JSON payload. Unknown name 'providerSecret' at schema.properties.", "unsupported_schema_property"),
        ("Invalid generation parameter: temperature value.", "request_parameter"),
    ],
)
def test_structured_output_probe_returns_only_sanitized_error_categories(
    client, monkeypatch, caplog, provider_message, category
):
    monkeypatch.setattr(diagnostics, "model_transport", fake_model_response)
    calls = []
    sensitive_response = json.dumps({
        "error": {
            "message": provider_message,
            "details": [{"debug": f"{KEY} private spreadsheet contents"}],
        }
    })

    def fail_smart_import_schema(request, timeout):
        calls.append(request)
        body = json.loads(request.data)
        if body["generationConfig"]["responseJsonSchema"].get("required") == ["ok"]:
            return {"candidates": [{"content": {"parts": [{"text": '{"ok":true}'}]}}]}
        raise urllib.error.HTTPError(
            request.full_url,
            400,
            "Bad Request",
            {},
            io.BytesIO(sensitive_response.encode()),
        )

    monkeypatch.setattr(diagnostics, "_urlopen_json", fail_smart_import_schema)
    with caplog.at_level("WARNING", logger="optiflow.gemini"):
        response = client.get(
            "/diagnostics/gemini?structured_output_probe=true",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 200
    result = response.json()["structured_output_probe"]
    assert result["comparison"] == "smart_import_schema_rejected"
    assert result["minimal_schema"] == {"http_status": 200, "category": "success"}
    assert result["smart_import_schema"] == {"http_status": 400, "category": category}
    assert len(calls) == 2
    assert KEY not in response.text
    assert "private spreadsheet contents" not in response.text
    assert provider_message not in response.text
    assert KEY not in caplog.text
    assert "private spreadsheet contents" not in caplog.text
    assert sensitive_response not in caplog.text


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
    from backend.import_foundations import AIProviderFailure, InterpretRequest

    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    request = InterpretRequest.model_validate({
        "target": "scheduling", "locale": "en", "allowed_fields": ["employee_id"],
        "files": [{"source_id": "s", "name": "file.csv", "row_count": 0,
                   "columns": [{"header": "id", "inferred_type": "text", "samples": [], "blank_count": 0, "unique_count": 0}]}],
    })

    monkeypatch.setenv("GEMINI_MAX_RETRIES", "0")
    for status, phrase in [(400, "payload"), (401, "authentication"), (403, "forbidden"), (404, "model"), (429, "quota")]:
        def fail(request, timeout):
            raise urllib.error.HTTPError(request.full_url, status, KEY, {}, None)

        monkeypatch.setattr(diagnostics, "_urlopen_json", fail)
        with pytest.raises(AIProviderFailure) as error:
            diagnostics.SafeGeminiClient().interpret(request)
        assert phrase in str(error.value).lower()
        assert KEY not in str(error.value)
