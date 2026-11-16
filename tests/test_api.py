import io
import json
import logging
import urllib.error
import urllib.request
from pathlib import Path
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
    return {'files':[{'source_id':'sheet-1','datasets':['availability'],'columns':[
        {'column':'Badge','field':'employee_id','transform':'direct','confidence':.99,'reason':'Identifier'},
        {'column':'Day','field':'date','transform':'date','confidence':.99,'reason':'Date'},
        {'column':'Window','field':'start_time','transform':'time_range','confidence':.95,'reason':'Time range'},
        {'column':'Can Work','field':'status','transform':'status','confidence':.99,'reason':'Availability'},
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

def test_gemini_http_failure_logs_only_safe_diagnostics(monkeypatch, caplog):
    from backend.import_foundations import GeminiClient, InterpretRequest, AIProviderFailure
    monkeypatch.setenv('GEMINI_API_KEY', 'private-api-key')
    monkeypatch.setenv('GEMINI_IMPORT_MODEL', 'gemini-2.5-flash')
    request_data = urllib.request.Request('https://example.test/generate')
    provider_body = b'{"error":"private spreadsheet value and private-api-key"}'
    http_error = urllib.error.HTTPError(request_data.full_url, 404, 'Not Found', {}, io.BytesIO(provider_body))
    client_impl = GeminiClient(lambda request, timeout: (_ for _ in ()).throw(http_error))
    with caplog.at_level(logging.WARNING, logger='optiflow.gemini'):
        try:
            client_impl.interpret(InterpretRequest.model_validate(import_request()))
            assert False
        except AIProviderFailure as error:
            assert 'HTTP 404' in str(error)
    assert 'model=gemini-2.5-flash' in caplog.text
    assert 'status=404' in caplog.text
    assert 'category=model_or_method_not_found' in caplog.text
    assert 'private-api-key' not in caplog.text
    assert 'private spreadsheet value' not in caplog.text

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
