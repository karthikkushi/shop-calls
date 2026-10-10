"""GitHub-hosted daily worker. All durable research state is saved in Supabase."""
import asyncio
import json
import os
import uuid
from datetime import datetime,timedelta,timezone
from . import shop_ops as ops, shop_cloud as cloud, daily_research as research

async def main():
    for key in ('FIELDWORK_OWNER_CODE','FIELDWORK_CALLER_CODE','FIELDWORK_CLOUD_API'):
        if not os.getenv(key):raise RuntimeError('Cloud worker credentials are incomplete.')
    os.environ['FIELDWORK_CLOUD_WORKER']='1'
    ops.init_db()
    identifier=str(uuid.uuid4())
    claim=cloud.request('/research/claim/'+identifier,'POST',{'daily':os.getenv('FIELDWORK_DAILY','yes')!='no'})
    if claim.get('skip'):
        print('Skipped:',claim['reason'],flush=True);return
    try:
        state=cloud.request('/research/state')
        os.environ['FIELDWORK_CITY_RUN_COUNT']=str(max(0,state['run_count']-1))
        # Rehydrate source metadata; caller notes and bookings remain cloud-owned.
        ops.upsert_leads(cloud.request('/leads')['leads'])
        cutoff=datetime.now(timezone.utc)-timedelta(days=14)
        with ops.connect() as c:
            for signal in state['signals']:
                stamp=research.parse_date(signal.get('published_at'))
                if stamp and stamp>=cutoff:c.execute('INSERT OR REPLACE INTO signals VALUES(?,?)',(signal['id'],json.dumps(signal)))
            for run in state['runs']:
                c.execute('INSERT OR REPLACE INTO runs VALUES(?,?,?,?,?,?)',(run['id'],run['status'],run['scheduled_for'],run['started'],run['finished'],json.dumps(run['result'])))
        await research.collect_run(identifier)
        cloud.sync()
        with ops.connect() as c:
            run=c.execute('SELECT * FROM runs WHERE id=?',(identifier,)).fetchone()
            signals=[json.loads(r[0]) for r in c.execute('SELECT payload FROM signals')]
        signals=[s for s in signals if research.parse_date(s.get('published_at')) and research.parse_date(s['published_at'])>=cutoff]
        cloud.request('/research/finish/'+identifier,'POST',{'status':run['status'],'result':json.loads(run['result']),'signals':signals})
        result=json.loads(run['result'])
        print('Cloud research',run['status'],'new contacts:',result['new_leads'],'dated mentions:',result['signals'],'model:',result.get('model',{}).get('status'),flush=True)
        if run['status']=='failed':raise RuntimeError('Cloud research failed; inspect dashboard source errors.')
    except Exception:
        try:cloud.request('/research/finish/'+identifier,'POST',{'status':'failed','result':{'phase':'Cloud worker failed','errors':['Cloud run did not complete; see the workflow job status.']}})
        except Exception:pass
        raise

if __name__=='__main__':asyncio.run(main())
