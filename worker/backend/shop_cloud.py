"""Cloud shop data; no privileged Supabase key is kept on the Mac or in the browser."""
import json
import os
from pathlib import Path
import httpx
from fastapi import HTTPException

ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/'data'/'shop-cloud.json'

def config():
    if os.getenv('FIELDWORK_CLOUD_API'):
        return {'api_url':os.environ['FIELDWORK_CLOUD_API'],'caller_url':'https://karthikkushi.github.io/shop-calls/caller/','cloud_research':True}
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else None

def request(path,method='GET',body=None):
    from .shop_ops import credentials
    cfg=config()
    if not cfg: raise HTTPException(503,'Cloud shop connection is not configured.')
    try:
        r=httpx.request(method,cfg['api_url']+path,headers={'Authorization':'Bearer '+credentials()['admin']},json=body,timeout=25)
        data=r.json()
    except (httpx.HTTPError,ValueError): raise HTTPException(503,'Cannot reach cloud shop data. Check your internet connection.')
    if not r.is_success: raise HTTPException(r.status_code,data.get('detail','Cloud shop request failed.'))
    return data

def sync():
    from . import shop_ops as ops
    if config() and config().get('cloud_research') and not os.getenv('FIELDWORK_CLOUD_WORKER'):
        return {'synced':False,'reason':'Cloud worker owns research metadata.'}
    # Upload research metadata only. Existing cloud responses always win.
    with ops.connect() as c:
        leads=[ops.lead_record(r) for r in c.execute('SELECT * FROM leads')]
        topics=[json.loads(r[0]) for r in c.execute('SELECT payload FROM topics')]
    if config() and config().get('cloud_research') and not os.getenv('FIELDWORK_CLOUD_WORKER'): topics=[]
    return send(leads,topics)

# The cloud function refuses bodies over 1.8 MB (413) and more than 3000 leads per call; /sync only upserts,
# so the upload is split into calls that stay under both.
LIMIT=1_500_000

def batches(items,limit=None,most=3000):
    limit=limit or LIMIT
    part,size=[],0
    for item in items:
        n=len(json.dumps(item))+2  # ', ' between items
        if part and (size+n>limit or len(part)>=most):
            yield part
            part,size=[],0
        part.append(item);size+=n
    if part: yield part

def send(leads,topics):
    result={'synced':True}
    for part in batches(leads): result=request('/sync','POST',{'leads':part,'topics':[]})
    for part in batches(topics): result=request('/sync','POST',{'leads':[],'topics':part})
    return result

async def sync_loop():
    import asyncio
    import logging
    while True:
        if config():
            try: await asyncio.to_thread(sync)
            except Exception: logging.getLogger(__name__).warning('Cloud lead upload failed; will retry in five minutes.')
        await asyncio.sleep(300)
