"""OptiFlow's local OR-Tools CP-SAT scheduling API."""
import time
import os
from datetime import date
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from ortools.sat.python import cp_model

class Employee(BaseModel):
    id: str
    name: str = Field(min_length=1)
    wage: float = Field(ge=0, le=1000, allow_inf_nan=False)
    maxHours: float = Field(ge=0, le=168, allow_inf_nan=False)
    availability: list[bool] = Field(min_length=14, max_length=14)

    @model_validator(mode='after')
    def precision(self):
        if not self.name.strip(): raise ValueError('Employee name cannot be blank')
        if abs(self.wage*100-round(self.wage*100))>1e-6: raise ValueError('Use whole cents for wages')
        if abs(self.maxHours*60-round(self.maxHours*60))>1e-6: raise ValueError('Use whole minutes for weekly hours')
        return self

def minutes(t):
    h,m=map(int,t.split(':'))
    return h*60+m

class Shift(BaseModel):
    id: int
    day: int = Field(ge=0,le=6)
    period: str
    start: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    end: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    required: int = Field(ge=0,le=30)

    @model_validator(mode='after')
    def time_order(self):
        if minutes(self.end)<=minutes(self.start): raise ValueError('Shift end must be after start on the same day')
        return self

class Scenario(BaseModel):
    name: str
    startDate: date
    employees: list[Employee] = Field(min_length=1,max_length=30)
    shifts: list[Shift] = Field(min_length=14,max_length=14)

    @model_validator(mode='after')
    def unique(self):
        if len({e.id for e in self.employees})!=len(self.employees): raise ValueError('Employee IDs must be unique')
        if [s.day for s in self.shifts]!=[i//2 for i in range(14)]: raise ValueError('Provide two ordered shifts per day')
        return self

app=FastAPI(title='OptiFlow Scheduling API',version='0.1.0')
allowed_origins=['http://localhost:3000','http://127.0.0.1:3000']
configured_origins=os.environ.get('OPTIFLOW_CORS_ORIGINS',os.environ.get('OPTIFLOW_WEB_ORIGIN',''))
for origin in (value.strip() for value in configured_origins.split(',')):
    if not origin: continue
    if not (origin.startswith('https://') or origin.startswith('http://localhost:') or origin.startswith('http://127.0.0.1:')) or '/' in origin.split('://',1)[1]:
        raise RuntimeError('OPTIFLOW_CORS_ORIGINS must contain comma-separated origins without paths.')
    allowed_origins.append(origin)
app.add_middleware(CORSMiddleware,allow_origins=allowed_origins,allow_methods=['POST','GET'],allow_headers=['Content-Type','Authorization'])

@app.get('/health')
def health():
    return {'status':'ok','engine':'OR-Tools CP-SAT','smart_import_ai':'configured' if os.environ.get('GEMINI_API_KEY','').strip() else 'not_configured','model_storage':'development-memory'}

@app.post('/solve')
def solve(p:Scenario):
    start=time.perf_counter()
    model=cp_model.CpModel()
    x={(ei,si):model.new_bool_var(f'x_{ei}_{si}') for ei in range(len(p.employees)) for si in range(14)}
    durations=[minutes(s.end)-minutes(s.start) for s in p.shifts]
    messages=[]
    for si,s in enumerate(p.shifts):
        model.add(sum(x[ei,si] for ei in range(len(p.employees)))>=s.required)
        eligible=sum(e.availability[si] and e.maxHours*60>=durations[si] for e in p.employees)
        if eligible<s.required: messages.append(f'Day {s.day+1} {s.period}: needs {s.required}, but only {eligible} eligible employees are available.')
    for ei,e in enumerate(p.employees):
        model.add(sum(durations[si]*x[ei,si] for si in range(14))<=round(e.maxHours*60))
        for si,s in enumerate(p.shifts):
            if not e.availability[si]: model.add(x[ei,si]==0)
            for ti in range(si):
                t=p.shifts[ti]
                if s.day==t.day and minutes(s.start)<minutes(t.end) and minutes(t.start)<minutes(s.end):
                    model.add(x[ei,si]+x[ei,ti]<=1)
    model.minimize(sum(round(e.wage*100)*durations[si]*x[ei,si] for ei,e in enumerate(p.employees) for si in range(14)))
    solver=cp_model.CpSolver()
    solver.parameters.max_time_in_seconds=20
    solver.parameters.num_search_workers=4
    status=solver.solve(model)
    names={cp_model.OPTIMAL:'OPTIMAL',cp_model.FEASIBLE:'FEASIBLE',cp_model.INFEASIBLE:'INFEASIBLE'}
    status_name=names.get(status,'UNKNOWN')
    assignments=[[e.id for ei,e in enumerate(p.employees) if solver.value(x[ei,si])] for si in range(14)] if status in (cp_model.OPTIMAL,cp_model.FEASIBLE) else []
    if status_name=='INFEASIBLE' and not messages: messages=['Coverage, availability, overlaps, and weekly hour limits cannot all be satisfied together. Increase capacity or reduce demand.']
    if status_name=='FEASIBLE': messages=['Valid schedule found; optimality was not proven within the time limit.']
    if status_name=='UNKNOWN': messages=['No usable solution was found within the solver time limit.']
    return {'status':status_name,'assignments':assignments,'seconds':time.perf_counter()-start,'engine':'OR-Tools CP-SAT','messages':messages}

# Keep the existing Smart Import API unchanged. Set the documented default before
# its router is imported; GEMINI_IMPORT_MODEL remains an environment override.
os.environ.setdefault('GEMINI_IMPORT_MODEL', 'gemini-2.5-flash')
from backend.import_foundations import router as import_router
from backend.gemini_diagnostics import configure_gemini_provider, router as gemini_router

configure_gemini_provider()
app.include_router(import_router)
app.include_router(gemini_router)
