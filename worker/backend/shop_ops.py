"""Shared shop pipeline for the owner dashboard and a separate caller app."""
import csv
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import phonenumbers
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'data' / 'shop_ops.sqlite3'
ACCESS = ROOT / 'data' / 'shop-access.json'
router = APIRouter(prefix='/api/ops', tags=['shop pipeline'])
STATES = ('new', 'no_answer', 'callback', 'interested', 'not_interested', 'booking_requested', 'do_not_contact')


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with connect() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS leads(
            id TEXT PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '', caller TEXT NOT NULL DEFAULT '',
            followup TEXT, version INTEGER NOT NULL DEFAULT 0,
            created TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS calls(request_id TEXT PRIMARY KEY, lead_id TEXT NOT NULL,
            payload TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, lead_id TEXT NOT NULL,
            payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'needs_quote', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, status TEXT NOT NULL,
            scheduled_for TEXT, started TEXT NOT NULL, finished TEXT, result TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1);
        INSERT OR IGNORE INTO settings(id,enabled) VALUES(1,1);
        ''')


def credentials():
    if os.getenv('FIELDWORK_OWNER_CODE'):
        if not os.getenv('FIELDWORK_CALLER_CODE'): raise RuntimeError('Cloud caller credential is missing.')
        return {'admin':os.environ['FIELDWORK_OWNER_CODE'],'caller':os.environ['FIELDWORK_CALLER_CODE']}
    ACCESS.parent.mkdir(parents=True, exist_ok=True)
    if not ACCESS.exists():
        data = {'admin': secrets.token_urlsafe(24), 'caller': secrets.token_urlsafe(24)}
        # Exclusive create prevents two processes generating different pairing codes.
        try:
            with ACCESS.open('x') as f:
                ACCESS.chmod(0o600)
                json.dump(data, f)
            guide = ACCESS.with_name('Shop app access.txt')
            guide.write_text('Fieldwork access codes — keep private\n\nOwner dashboard code:\n'+data['admin']+
                             '\n\nPhone caller code:\n'+data['caller']+'\n')
            guide.chmod(0o600)
        except FileExistsError:
            pass
    return json.loads(ACCESS.read_text())


def role(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Enter your access code.')
    token = authorization[7:]
    if len(token) > 200: raise HTTPException(401, 'Invalid access code.')
    for name, code in credentials().items():
        if hmac.compare_digest(token.encode(), code.encode()): return name
    raise HTTPException(401, 'Invalid access code.')


def owner(access=Depends(role)):
    if access != 'admin': raise HTTPException(403, 'Owner access required.')
    return access


class Session(BaseModel):
    code: str = Field(min_length=1, max_length=200)


@router.post('/session')
def session(request: Session):
    return {'role': role('Bearer ' + request.code.strip())}


def safe_url(value):
    if not isinstance(value, str): return ''
    try:
        u = urlsplit(value)
        return value if u.scheme in ('https', 'http') and u.hostname and not u.username and not u.password else ''
    except ValueError:
        return ''


def phone_number(raw, country):
    if not raw: return ''
    try:
        p = phonenumbers.parse(str(raw).split(';')[0], country)
        return phonenumbers.format_number(p, phonenumbers.PhoneNumberFormat.E164) if phonenumbers.is_valid_number(p) else ''
    except phonenumbers.NumberParseException:
        return ''


def upsert_leads(rows):
    added = 0
    with connect() as c:
        for raw in rows:
            lead = dict(raw)
            if not lead.get('id') or not lead.get('name') or not safe_url(lead.get('source_url')): continue
            lead['website'] = safe_url(lead.get('website'))
            lead['phone'] = phone_number(lead.get('phone'), lead.get('country'))
            key = '|'.join([lead.get('country', ''), ''.join(x for x in lead['name'].casefold() if x.isalnum()),
                            lead['phone'] or lead['website'] or lead['source_url']])
            old = c.execute('SELECT id FROM leads WHERE id=? OR dedupe=?', (lead['id'],key)).fetchone()
            stamp = now_iso()
            if old:
                lead['id'] = old['id']
                # Preserve caller fields and version. Research refreshes only source metadata.
                c.execute('UPDATE leads SET payload=? WHERE id=?', (json.dumps(lead),old['id']))
            else:
                c.execute('INSERT INTO leads(id,dedupe,payload,created,updated) VALUES(?,?,?,?,?)',
                          (lead['id'],key,json.dumps(lead),stamp,stamp))
                added += 1
    return added


def import_seed():
    path = ROOT.parent / 'research' / 'shop-leads.csv'
    if not path.exists(): return
    countries = {'UK':'GB','USA':'US','Canada':'CA','Australia':'AU','New Zealand':'NZ',
                 'South Africa':'ZA','Singapore':'SG','Sweden':'SE','Finland':'FI'}
    with path.open(encoding='utf-8-sig', newline='') as f:
        rows = [dict(id='seed-'+r['lead_id'], name=r['business'], country=countries.get(r['country'],r['country']),
                city='', category='desk', phone=r['phone'], email=r['email'], website=r['source_url'],
                source_url=r['source_url'], source_kind='official_site', source_id=r['lead_id'],
                contact_status=r['route_status'], note=r['research_note'], timezone=r['timezone'],
                checked_at=r['checked_on']) for r in csv.DictReader(f)]
    upsert_leads(rows)


def lead_record(row):
    d = {**json.loads(row['payload']), **{k: row[k] for k in ('status','notes','caller','followup','version','created','updated')}}
    d['callable'] = bool(d.get('phone')) and d['status'] != 'do_not_contact'
    return d


def get_leads(country=None, status=None, category=None):
    with connect() as c:
        rows = c.execute('SELECT * FROM leads ORDER BY created DESC, id LIMIT 3000').fetchall()
    leads = [lead_record(r) for r in rows]
    if country: leads = [r for r in leads if r.get('country') == country]
    if status: leads = [r for r in leads if r['status'] == status]
    if category: leads = [r for r in leads if r.get('category') == category]
    return {'leads': leads, 'attribution':'Map leads: © OpenStreetMap contributors / Overture Maps; contact accuracy and buying intent unconfirmed.'}


@router.get('/leads')
def list_leads(country: str | None = None, status: str | None = None, category: str | None = None, access=Depends(role)):
    from . import shop_cloud
    if shop_cloud.config():
        leads=shop_cloud.request('/leads')['leads']
        return {'leads':[l for l in leads if (not country or l.get('country')==country) and (not status or l['status']==status) and (not category or l.get('category')==category)]}
    return get_leads(country, status, category)


class CallOutcome(BaseModel):
    status: Literal['no_answer','callback','interested','not_interested','booking_requested','do_not_contact']
    request_id: str = Field(min_length=1, max_length=100)
    expected_version: int | None = Field(default=None, ge=0)
    caller: str = Field(default='', max_length=100)
    notes: str = Field(default='', max_length=2500)
    followup: datetime | None = None
    product: str = Field(default='', max_length=200)
    product_id: str | None = Field(default=None, max_length=100)
    quantity: int | None = Field(default=None, gt=0, le=1000000)
    target_unit_price: float | None = Field(default=None, ge=0, le=10000000, allow_inf_nan=False)
    currency: Literal['USD','GBP','EUR','CAD','AUD','NZD','SGD','ZAR','INR'] = 'USD'

    @model_validator(mode='after')
    def validate_booking(self):
        if self.status == 'booking_requested' and (not self.product.strip() or not self.quantity):
            raise ValueError('Booking requests need a product and quantity.')
        if self.status == 'callback' and not self.followup:
            raise ValueError('Set a follow-up time for a callback.')
        if self.followup and self.followup.tzinfo is None:
            raise ValueError('Follow-up time must include a timezone.')
        return self


def save_outcome(identifier, request):
    payload = json.dumps(request.model_dump(mode='json'), sort_keys=True)
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        prior = c.execute('SELECT lead_id,payload FROM calls WHERE request_id=?',(request.request_id,)).fetchone()
        if prior:
            if prior['lead_id'] != identifier or prior['payload'] != payload:
                raise HTTPException(409, 'This submission ID was already used for different data.')
            return {'saved':True, 'duplicate':True}
        lead = c.execute('SELECT * FROM leads WHERE id=?',(identifier,)).fetchone()
        if not lead: raise HTTPException(404,'Shop not found.')
        if lead['status'] == 'do_not_contact': raise HTTPException(409,'This shop asked not to be contacted.')
        if request.expected_version is not None and request.expected_version != lead['version']:
            raise HTTPException(409,'This shop was updated on another device. Refresh before saving.')
        stamp = now_iso()
        c.execute('INSERT INTO calls VALUES(?,?,?,?)',(request.request_id,identifier,payload,stamp))
        c.execute('UPDATE leads SET status=?,notes=?,caller=?,followup=?,version=version+1,updated=? WHERE id=?',
                  (request.status,request.notes,request.caller,request.followup.isoformat() if request.followup else None,stamp,identifier))
        if request.status == 'booking_requested':
            booking = {**request.model_dump(mode='json'), 'shop_name':json.loads(lead['payload'])['name'],
                       'payment_status':'not_collected', 'fulfilment_status':'not_ordered'}
            c.execute('INSERT INTO bookings(id,lead_id,payload,created) VALUES(?,?,?,?)',
                      ('booking-'+request.request_id,identifier,json.dumps(booking),stamp))
    return {'saved':True,'duplicate':False}


@router.post('/leads/{identifier}/outcome')
def outcome(identifier: str, request: CallOutcome, access=Depends(role)):
    from . import shop_cloud
    if shop_cloud.config(): return shop_cloud.request('/leads/'+identifier+'/outcome','POST',request.model_dump(mode='json'))
    return save_outcome(identifier,request)


def get_bookings():
    with connect() as c:
        rows=c.execute('SELECT * FROM bookings ORDER BY created DESC').fetchall()
    return {'bookings':[{**json.loads(r['payload']), 'id':r['id'], 'lead_id':r['lead_id'],
                         'status':r['status'], 'created':r['created']} for r in rows]}


@router.get('/bookings')
def bookings(access=Depends(owner)):
    from . import shop_cloud
    return shop_cloud.request('/bookings') if shop_cloud.config() else get_bookings()


@router.get('/topics')
def topic_list(access=Depends(role)):
    with connect() as c:
        return {'topics':[json.loads(r[0]) for r in c.execute('SELECT payload FROM topics')]}


class BookingDecision(BaseModel):
    status: Literal['needs_quote','quoting','proposal_sent','cancelled']


@router.patch('/bookings/{identifier}')
def booking_decision(identifier: str, request: BookingDecision, access=Depends(owner)):
    from . import shop_cloud
    if shop_cloud.config():
        shop_cloud.request('/bookings/'+identifier,'PATCH',request.model_dump())
        return shop_cloud.request('/bookings')
    with connect() as c:
        if not c.execute('UPDATE bookings SET status=? WHERE id=?',(request.status,identifier)).rowcount:
            raise HTTPException(404,'Booking request not found.')
    return get_bookings()


@router.get('/summary')
def summary(access=Depends(owner)):
    from . import shop_cloud
    if shop_cloud.config() and shop_cloud.config().get('cloud_research'):
        return shop_cloud.request('/summary')
    from . import shop_cloud
    cloud=shop_cloud.config()
    leads = shop_cloud.request('/leads')['leads'] if cloud else get_leads()['leads']
    cloud_bookings=shop_cloud.request('/bookings')['bookings'] if cloud else get_bookings()['bookings']
    with connect() as c:
        topics = [json.loads(r[0]) for r in c.execute('SELECT payload FROM topics')]
        runs = [dict(r) for r in c.execute('SELECT * FROM runs ORDER BY started DESC LIMIT 10')]
        enabled = bool(c.execute('SELECT enabled FROM settings WHERE id=1').fetchone()[0])
    for run in runs: run['result'] = json.loads(run['result'])
    topics.sort(key=lambda x: (-x.get('last_week',0),x['name']))
    return {'counts':{s:sum(r['status']==s for r in leads) for s in STATES}, 'total_leads':len(leads),
            'callable':sum(r['callable'] for r in leads), 'countries':sorted({r['country'] for r in leads}),
            'topics':topics, 'runs':runs, 'bookings':cloud_bookings,
            'schedule':{'enabled':enabled,'time':'09:00','timezone':'Asia/Kolkata','requires':'Mac awake and backend running'},
            'caller_code':credentials()['caller'], 'caller_path':'/caller/', 'caller_url':cloud.get('caller_url') if cloud else None, 'storage':'supabase' if cloud else 'local'}


class Schedule(BaseModel):
    enabled: bool


@router.patch('/schedule')
def schedule(request: Schedule, access=Depends(owner)):
    from . import shop_cloud
    if shop_cloud.config() and shop_cloud.config().get('cloud_research'):
        return shop_cloud.request('/schedule','PATCH',request.model_dump())
    with connect() as c: c.execute('UPDATE settings SET enabled=? WHERE id=1',(int(request.enabled),))
    return {'enabled':request.enabled}


@router.post('/run',status_code=202)
async def run(access=Depends(owner)):
    from . import shop_cloud
    if shop_cloud.config() and shop_cloud.config().get('cloud_research'):
        import asyncio
        return await asyncio.to_thread(shop_cloud.request,'/run','POST',{})
    from .daily_research import start_run
    return await start_run()


@router.get('/quotes')
def quote_workbench_list(access=Depends(owner)):
    from .shop_cloud import request
    return request('/quotes')

@router.post('/quotes')
def quote_workbench_save(body: dict, access=Depends(owner)):
    from .shop_cloud import request
    return request('/quotes','POST',body)
