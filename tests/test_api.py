import io
import json
import logging
import urllib.error
import urllib.request
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.main import Scenario,minutes,solve
from backend.import_foundations import ParsedUploadRequest, InterpretRequest, AnswerRequest, PreviewRequest, validate_parsed_upload, interpret, answer_questions, preview_model, save_model

fixtures=json.loads(Path('tests/fixtures/scenarios.json').read_text())

def test_presets_match_glpk_optimal_costs():
    assert len(fixtures)==3
    for f in fixtures:
        r=solve(Scenario.model_validate(f['p']))
        assert r['status']=='OPTIMAL'
        p=f['p']; cost=0; hours={e['id']:0 for e in p['employees']}
        for si,ids in enumerate(r['assignments']):
            s=p['shifts'][si]
            assert len(ids)>=s['required']
            assert len(set(ids))==len(ids)
            for id in ids:
                e=next(e for e in p['employees'] if e['id']==id)
                assert e['availability'][si]
                h=(minutes(s['end'])-minutes(s['start']))/60
                cost+=e['wage']*h;hours[id]+=h
                for ti in range(si):
                    t=p['shifts'][ti]
                    if id in r['assignments'][ti] and s['day']==t['day']:
                        assert minutes(s['start'])>=minutes(t['end']) or minutes(t['start'])>=minutes(s['end'])
        assert abs(cost-f['cost'])<1e-6
        assert all(hours[e['id']]<=e['maxHours'] for e in p['employees'])

def test_infeasible_and_invalid_inputs():
    p=json.loads(json.dumps(fixtures[0]['p']))
    for e in p['employees']: e['availability'][0]=False
    r=solve(Scenario.model_validate(p))
    assert r['status']=='INFEASIBLE' and not r['assignments'] and r['messages']
    p['employees']=[]
    try: Scenario.model_validate(p); assert False
    except ValidationError: pass

def test_overlap_and_unequal_duration():
    p=json.loads(json.dumps(fixtures[0]['p']))
    p['employees']=p['employees'][:2]
    for e in p['employees']:
        e['availability']=[True]*14;e['maxHours']=40
    for s in p['shifts']: s['required']=0
    p['shifts'][0].update(start='09:15',end='12:45',required=1)
    p['shifts'][1].update(start='11:00',end='13:00',required=1)
    r=solve(Scenario.model_validate(p))
    assert r['status']=='OPTIMAL'
    assert set(r['assignments'][0]).isdisjoint(r['assignments'][1])
    p['employees']=p['employees'][:1]
    assert solve(Scenario.model_validate(p))['status']=='INFEASIBLE'

def import_request():
    return {'target':'scheduling','locale':'en','allowed_fields':['employee_id','date','start_time','end_time','status'],'files':[{
        'source_id':'sheet-1','name':'availability.xlsx / Sheet1','row_count':2,'columns':[
            {'header':'Badge','inferred_type':'text','samples':['<redacted:text:4>'],'blank_count':0,'unique_count':2},
            {'header':'Day','inferred_type':'date','samples':['2026-11-16'],'blank_count':0,'unique_count':2},
            {'header':'Window','inferred_type':'time_range','samples':['09:00-17:00'],'blank_count':0,'unique_count':2},
            {'header':'Can Work','inferred_type':'boolean','samples':['YES','NO'],'blank_count':0,'unique_count':2},
        ]}]}

def ai_fixture():
    return {'files':[{'source_id':'sheet-1','datasets':['availability'],'destination_note':'','columns':[
        {'column':'Badge','field':'employee_id','transform':'direct','confidence':.99,'reason':'Identifier'},
        {'column':'Day','field':'date','transform':'date','confidence':.99,'reason':'Date'},
        {'column':'Window','field':'start_time','transform':'time_range','confidence':.95,'reason':'Time range'},
        {'column':'Can Work','field':'status','transform':'status','confidence':.99,'reason':'Availability'},
    ],'corrections':[]}], 'model':{'objective':{'kind':'unknown','description':'No objective is present.','source_fields':[],'confidence':1},'decision_variables':[],'constraints':[],'relationships':[]},'questions':[]}

def allocation_request():
    return {'target':'allocation','locale':'en','allowed_fields':['resource_id','capacity'],'files':[{
        'source_id':'resource-sheet','name':'resources.csv','row_count':1,'columns':[
            {'header':'Resource ID','inferred_type':'text','samples':['R1'],'blank_count':0,'unique_count':1},
            {'header':'Capacity','inferred_type':'integer','samples':['10'],'blank_count':0,'unique_count':1},
        ]}]}

def allocation_ai_fixture():
    return {'files':[{'source_id':'resource-sheet','datasets':['resources'],'destination_note':'','columns':[
        {'column':'Resource ID','field':'resource_id','transform':'direct','confidence':.99,'reason':'Resource identifier'},
        {'column':'Capacity','field':'capacity','transform':'direct','confidence':.99,'reason':'Available capacity'},
    ],'corrections':[]}], 'model':{'objective':{'kind':'unknown','description':'No objective is present.','source_fields':[],'confidence':1},'decision_variables':[],'constraints':[],'relationships':[]},'questions':[]}

def test_parse_validation_and_missing_credentials(monkeypatch):
    parsed=validate_parsed_upload(ParsedUploadRequest.model_validate({'sheets':[{'source_id':'s','file':'a.csv','worksheet':'CSV','headers':['A','B'],'rows':[['1','2']],'line_numbers':[2]}]}))
    assert parsed['valid']
    monkeypatch.delenv('GEMINI_API_KEY',raising=False)
    from fastapi import HTTPException
    try: interpret(InterpretRequest.model_validate(import_request())); assert False
    except HTTPException as error: assert error.status_code==503 and 'not configured' in error.detail

def test_gemini_structured_interpretation_questions_preview_and_save(monkeypatch):
    from backend import import_foundations as foundations
    class FixtureProvider:
        def interpret(self, request): return foundations.AIInterpretation.model_validate(ai_fixture())
    monkeypatch.setattr(foundations,'provider',FixtureProvider())
    body=interpret(InterpretRequest.model_validate(import_request()))
    assert body['provider']=='gemini' and body['requires_verification']
    question=next(q for q in body['questions'] if q['id']=='model:objective')
    session=body['session_id']
    answered=answer_questions(session,AnswerRequest.model_validate({'answers':[{'question_id':question['id'],'value':'minimize_cost'}]}))
    assert answered['accepted']==1
    model={'employees':[],'availability':[{'employee_id':'W001','date':'2026-11-16','start_time':'09:00','end_time':'17:00','status':'available'}],'shifts':[]}
    preview=preview_model(session,PreviewRequest(model=model))
    assert preview['ready']
    saved=save_model(session)
    assert saved['saved']

def test_malformed_gemini_response_is_safe(monkeypatch):
    from backend.import_foundations import GeminiClient, InterpretRequest, AIProviderFailure
    monkeypatch.setenv('GEMINI_API_KEY','test-only')
    client_impl=GeminiClient(lambda request,timeout:{'candidates':[{'content':{'parts':[{'text':'{"files":[]}' }]}}]})
    try:
        client_impl.interpret(InterpretRequest.model_validate(import_request()))
        assert False
    except AIProviderFailure as error:
        assert 'malformed structured response' in str(error)

def test_compact_schema_does_not_bypass_strict_pydantic_output_limits(monkeypatch):
    from backend.import_foundations import GeminiClient, InterpretRequest, AIProviderFailure
    monkeypatch.setenv('GEMINI_API_KEY', 'test-only')
    invalid = ai_fixture()
    invalid['model']['constraints'] = [{
        'kind': 'capacity',
        'description': 'A source-supported capacity limit.',
        'source_fields': [],
        'hard': True,
        'confidence': .9,
    }] * 61
    client_impl = GeminiClient(lambda request, timeout: {
        'candidates': [{'content': {'parts': [{'text': json.dumps(invalid)}]}}],
    })
    try:
        client_impl.interpret(InterpretRequest.model_validate(import_request()))
        assert False
    except AIProviderFailure as error:
        assert 'malformed structured response' in str(error)

def test_gemini_request_uses_supported_default_model_and_v1beta_body(monkeypatch):
    from backend.import_foundations import GeminiClient, InterpretRequest
    monkeypatch.setenv('GEMINI_API_KEY', 'test-only-key')
    monkeypatch.delenv('GEMINI_IMPORT_MODEL', raising=False)
    seen = {}
    def transport(request, timeout):
        seen['url'] = request.full_url
        seen['headers'] = {key.lower(): value for key, value in request.header_items()}
        seen['body'] = json.loads(request.data)
        return {'candidates': [{'content': {'parts': [{'text': json.dumps(ai_fixture())}]}}]}
    GeminiClient(transport).interpret(InterpretRequest.model_validate(import_request()))
    assert seen['url'] == 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    assert seen['headers']['x-goog-api-key'] == 'test-only-key'
    assert seen['body']['systemInstruction']['parts'][0]['text']
    assert seen['body']['contents'][0]['role'] == 'user'
    assert seen['body']['generationConfig']['responseMimeType'] == 'application/json'
    instruction = seen['body']['systemInstruction']['parts'][0]['text']
    assert "The selected import destination is 'scheduling'" in instruction
    assert 'destination_note' in instruction
    schema = seen['body']['generationConfig']['responseJsonSchema']
    assert set(schema['properties']['files']['items']['properties']['datasets']['items']['enum']) == {'employees','availability','shifts'}
    assert 'destination_note' in schema['properties']['files']['items']['required']

def test_allocation_destination_is_enforced_by_gemini_schema_and_validation(monkeypatch):
    from backend import import_foundations as foundations
    from backend.import_foundations import GeminiClient, InterpretRequest
    monkeypatch.setenv('GEMINI_API_KEY', 'test-only-key')
    seen = {}
    def transport(request, timeout):
        seen['body'] = json.loads(request.data)
        return {'candidates': [{'content': {'parts': [{'text': json.dumps(allocation_ai_fixture())}]}}]}
    request = InterpretRequest.model_validate(allocation_request())
    valid = GeminiClient(transport).interpret(request)
    foundations.validate_interpretation(request, valid)
    schema = seen['body']['generationConfig']['responseJsonSchema']
    allowed = schema['properties']['files']['items']['properties']['datasets']['items']['enum']
    assert set(allowed) == {'resources','projects','demands','links'}
    instruction = seen['body']['systemInstruction']['parts'][0]['text']
    assert "selected import destination is 'allocation'" in instruction
    assert 'destination_note' in instruction
    invalid = foundations.AIInterpretation.model_validate({
        **allocation_ai_fixture(),
        'files': [{**allocation_ai_fixture()['files'][0], 'datasets':['availability']}],
    })
    from fastapi import HTTPException
    try:
        foundations.validate_interpretation(request, invalid)
        assert False
    except HTTPException as error:
        assert error.status_code == 502
        assert 'matching destination' in error.detail

def test_gemini_response_schema_is_compact_without_losing_import_contract():
    from backend import import_foundations as foundations
    from pydantic import ValidationError

    original_size = len(json.dumps(foundations.AIInterpretation.model_json_schema(), separators=(',', ':')))
    for target, expected_datasets in [
        ('scheduling', {'employees', 'availability', 'shifts'}),
        ('allocation', {'resources', 'projects', 'demands', 'links'}),
    ]:
        schema = foundations.interpretation_schema(target)
        assert len(json.dumps(schema, separators=(',', ':'))) < original_size * .6
        assert not any(key in json.dumps(schema) for key in ('$defs', '$ref'))

        def property_names(node):
            names = set()
            if isinstance(node, dict):
                names.update(node)
                for value in node.values():
                    names.update(property_names(value))
            elif isinstance(node, list):
                for value in node:
                    names.update(property_names(value))
            return names

        assert not property_names(schema).intersection({
            'title', 'default', 'minLength', 'maxLength', 'minItems', 'maxItems',
        })
        assert set(schema['properties']['files']['items']['properties']['datasets']['items']['enum']) == expected_datasets
        file_properties = schema['properties']['files']['items']['properties']
        assert {'source_id', 'datasets', 'destination_note', 'columns', 'corrections'} <= set(file_properties)
        assert {'column', 'field', 'transform', 'confidence', 'reason'} <= set(
            file_properties['columns']['items']['properties']
        )
        assert {'column', 'source_value', 'proposed_value', 'reason', 'substantive'} <= set(
            file_properties['corrections']['items']['properties']
        )
        model_properties = schema['properties']['model']['properties']
        assert {'objective', 'decision_variables', 'constraints', 'relationships'} <= set(model_properties)
        assert {'kind', 'description', 'source_fields', 'confidence'} <= set(
            model_properties['objective']['properties']
        )
        assert {'name', 'meaning', 'unit', 'source_fields', 'confidence'} <= set(
            model_properties['decision_variables']['items']['properties']
        )
        assert {'kind', 'description', 'source_fields', 'hard', 'confidence'} <= set(
            model_properties['constraints']['items']['properties']
        )
        assert {'from_dataset', 'from_field', 'to_dataset', 'to_field', 'kind', 'confidence'} <= set(
            model_properties['relationships']['items']['properties']
        )
        assert {'id', 'prompt', 'answer_type', 'options', 'target', 'required'} <= set(
            schema['properties']['questions']['items']['properties']
        )
        confidence = model_properties['objective']['properties']['confidence']
        assert confidence['minimum'] == 0 and confidence['maximum'] == 1

    question = {
        'id': 'missing:sheet-1:employees:name',
        'prompt': 'Which supplied column contains the employee name?',
        'target': 'employees.name',
    }
    with pytest.raises(ValidationError):
        foundations.AIInterpretation.model_validate({
            **ai_fixture(),
            'questions': [question] * 41,
        })

def test_unmatched_destination_requires_actionable_note_and_no_mapping():
    from backend import import_foundations as foundations
    from backend.import_foundations import InterpretRequest
    from fastapi import HTTPException
    request = InterpretRequest.model_validate(import_request())
    unmatched = foundations.AIInterpretation.model_validate({
        **ai_fixture(),
        'files': [{
            'source_id':'sheet-1','datasets':[],'destination_note':'This looks like resource planning data. Choose Resource Allocation or upload a scheduling spreadsheet.',
            'columns':[{'column':'Badge','field':'','transform':'direct','confidence':.99,'reason':'Not a Scheduling field'}],
            'corrections':[],
        }],
    })
    assert foundations.validate_interpretation(request, unmatched).files[0].destination_note.startswith('This looks like')
    invalid = unmatched.model_copy(deep=True)
    invalid.files[0].destination_note = ''
    try:
        foundations.validate_interpretation(request, invalid)
        assert False
    except HTTPException as error:
        assert 'Choose a compatible destination' in error.detail

def test_destination_note_cannot_contradict_dataset_classification():
    from backend import import_foundations as foundations
    from backend.import_foundations import InterpretRequest
    from fastapi import HTTPException
    cases = [
        (import_request(), ai_fixture(), 'scheduling'),
        (allocation_request(), allocation_ai_fixture(), 'allocation'),
    ]
    for request_data, fixture, target in cases:
        request = InterpretRequest.model_validate(request_data)
        contradictory = foundations.AIInterpretation.model_validate({
            **fixture,
            'files': [{
                **fixture['files'][0],
                'destination_note': 'This file belongs to another import destination.',
            }],
        })
        try:
            foundations.validate_interpretation(request, contradictory)
            assert False
        except HTTPException as error:
            assert error.status_code == 502
            assert f'selected {target} destination' in error.detail
            assert 'select the matching destination' in error.detail

def test_gemini_generation_normalizes_discovery_model_name(monkeypatch):
    from backend.import_foundations import GeminiClient, InterpretRequest
    monkeypatch.setenv('GEMINI_API_KEY', 'test-only-key')
    monkeypatch.setenv('GEMINI_IMPORT_MODEL', 'models/gemini-2.5-flash')
    seen = {}
    def transport(request, timeout):
        seen['url'] = request.full_url
        return {'candidates': [{'content': {'parts': [{'text': json.dumps(ai_fixture())}]}}]}
    GeminiClient(transport).interpret(InterpretRequest.model_validate(import_request()))
    assert seen['url'] == 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

def test_gemini_http_failure_logs_only_safe_diagnostics(monkeypatch, caplog):
    from fastapi.testclient import TestClient
    from backend import gemini_diagnostics as diagnostics
    from backend import import_foundations as foundations
    from backend.main import app
    monkeypatch.setattr(foundations, 'provider', foundations.provider)
    monkeypatch.setenv('GEMINI_API_KEY', 'private-api-key')
    monkeypatch.setenv('GEMINI_IMPORT_MODEL', 'gemini-2.5-flash')
    monkeypatch.setenv('GEMINI_MAX_RETRIES', '0')
    def fail_request(request, timeout):
        body = b'{"error":"private spreadsheet value and private-api-key"}'
        raise urllib.error.HTTPError(request.full_url, 404, 'Not Found', {}, io.BytesIO(body))
    monkeypatch.setattr(diagnostics, '_urlopen_json', fail_request)
    diagnostics.configure_gemini_provider()
    request = import_request()
    request['files'][0]['name'] = 'Private Person.xlsx'
    with caplog.at_level(logging.WARNING, logger='optiflow.gemini'):
        response = TestClient(app).post('/import/interpret', json=request)
    assert response.status_code == 502
    assert 'model=gemini-2.5-flash' in caplog.text
    assert 'http_status=502' in caplog.text
    assert 'provider_status=404' in caplog.text
    assert 'category=model_or_method_not_found' in caplog.text
    assert 'private-api-key' not in caplog.text
    assert 'private spreadsheet value' not in caplog.text
    assert 'Private Person.xlsx' not in caplog.text
    assert 'private-api-key' not in response.text
    assert 'private spreadsheet value' not in response.text

def test_invalid_gemini_interpretation_502_is_logged_safely(monkeypatch, caplog):
    from fastapi.testclient import TestClient
    from backend import import_foundations as foundations
    from backend.main import app
    monkeypatch.setenv('GEMINI_IMPORT_MODEL', 'gemini-2.5-flash')
    invalid = ai_fixture()
    invalid['files'][0]['source_id'] = 'not-the-requested-source'
    class FixtureProvider:
        def interpret(self, request):
            return foundations.AIInterpretation.model_validate(invalid)
    monkeypatch.setattr(foundations, 'provider', FixtureProvider())
    with caplog.at_level(logging.WARNING, logger='optiflow.gemini'):
        response = TestClient(app).post('/import/interpret', json=import_request())
    assert response.status_code == 502
    assert 'http_status=502 provider_status=none category=invalid_interpretation' in caplog.text

def test_spanish_locale_reaches_gemini_and_questions(monkeypatch):
    from backend import import_foundations as foundations
    from pydantic import ValidationError
    request = import_request()
    request['locale'] = 'es'
    seen = []
    class FixtureProvider:
        def interpret(self, value):
            seen.append(value.locale)
            return foundations.AIInterpretation.model_validate(ai_fixture())
    monkeypatch.setattr(foundations, 'provider', FixtureProvider())
    result = interpret(InterpretRequest.model_validate(request))
    assert seen == ['es']
    assert any('¿Qué debe optimizar' in q['prompt'] for q in result['questions'])
    request['locale'] = 'de'
    try: InterpretRequest.model_validate(request); assert False
    except ValidationError: pass
