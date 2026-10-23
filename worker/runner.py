"""Restart-safe, single-process worker. Run: python3 -m worker.runner --once"""
import argparse
import fcntl
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .core import now, stable_id, parse_feed, fetch_feed, config_hash, quota_state, validate_result
from .codex import Codex, CodexFailure
from .cloud import Cloud

class Store:
    def __init__(self,path):
        self.db=sqlite3.connect(path)
        self.db.executescript("""
          pragma journal_mode=WAL;
          create table if not exists articles(id text primary key, data text not null, done integer not null default 0);
          create table if not exists jobs(id text primary key, snapshot text not null, articles text not null, stage text not null, payload text);
          create table if not exists state(key text primary key,value text not null);
        """)
    def get(self,key,default=None):
        r=self.db.execute('select value from state where key=?',(key,)).fetchone()
        return json.loads(r[0]) if r else default
    def set(self,key,value):
        self.db.execute('insert or replace into state values(?,?)',(key,json.dumps(value)));self.db.commit()
    def add(self,articles):
        self.db.executemany('insert or ignore into articles(id,data) values(?,?)',[(a['id'],json.dumps(a)) for a in articles]);self.db.commit()
    def pending(self,limit=40):
        return [json.loads(r[0]) for r in self.db.execute('select data from articles where done=0 order by rowid limit ?',(limit,))]
    def jobs(self):
        return [dict(zip(('id','snapshot','articles','stage','payload'),r)) for r in self.db.execute("select * from jobs where stage!='published' order by rowid")]
    def save_job(self,job):
        self.db.execute('insert or replace into jobs values(?,?,?,?,?)',tuple(job[k] for k in ('id','snapshot','articles','stage','payload')));self.db.commit()
    def complete(self,job):
        with self.db:
            self.db.executemany('update articles set done=1 where id=?',[(a['id'],) for a in json.loads(job['articles'])])
            self.db.execute("update jobs set stage='published' where id=?",(job['id'],))
    def counts(self):
        return dict(pending_articles=self.db.execute('select count(*) from articles where done=0').fetchone()[0],
                    pending_uploads=self.db.execute("select count(*) from jobs where stage='upload_pending'").fetchone()[0])

def build_payload(result,articles,config,job_id,owner,node,source_results):
    candidates=[];evaluations=[]
    # Normalized research question + purpose is a stable cross-day candidate identity.
    for c in result['candidates']:
        normalized=''.join(ch for ch in c['question'].casefold() if ch.isalnum())
        tid=stable_id(owner,c['purpose_id'],normalized)
        candidates.append({k:c[k] for k in ('purpose_id','title','question')}|{'id':tid})
        evaluations.append({k:c[k] for k in ('summary','evidence_ids','counter_evidence','next_question')}|{'track_id':tid,'change':'新候選'})
    evaluations.extend(result['evaluations'])
    unique={}
    for e in evaluations:unique[e['track_id']]=e
    evaluations=[e|{'id':stable_id(job_id,e['track_id'])} for e in unique.values()]
    return {'owner_id':owner,'run':{'id':job_id,'node_id':node,'status':'partial' if any(not s['ok'] for s in source_results) else 'complete',
            'started_at':config['_started_at'],'data_cutoff':max((a['collected_at'] for a in articles),default=now()),'report':result['report'],
            'config_snapshot':config,'source_results':source_results},
            'articles':articles,'analyses':[a|{'id':stable_id(job_id,a['article_id'])} for a in result['analyses']],
            'candidates':candidates,'evaluations':evaluations}

class Runner:
    def __init__(self,store,cloud,codex,fetcher=fetch_feed,clock=time.time,buckets=('codex',),web_search=False,rss=True,search_interval=21600,fallback=None,detailed_reports=False):
        self.store=store;self.cloud=cloud;self.codex=codex;self.fetcher=fetcher;self.clock=clock;self.buckets=buckets
        self.web_search=web_search;self.rss=rss;self.search_interval=search_interval
        self.fallback=fallback;self.active=codex;self.detailed_reports=detailed_reports
    def activate_fallback(self):
        if not self.fallback:raise CodexFailure('Codex quota unavailable','waiting_quota')
        self.fallback.ensure_ready()
        self.active=self.fallback

    def remember_limit(self):
        try:q=quota_state(self.codex.quota(),self.buckets,self.store.get('attempt',0),self.clock())
        except Exception:q={'status':'waiting_quota','next_retry_at':self.clock()+900,'reason':'Codex returned a structured quota failure'}
        if q['status']!='waiting_quota':
            q={'status':'waiting_quota','next_retry_at':self.clock()+900,'reason':'Codex returned a structured quota failure'}
        self.store.set('codex_wait',q)
        return q

    def invoke(self,method,*args):
        try:return getattr(self.active,method)(*args)
        except CodexFailure as e:
            if e.code!='waiting_quota' or self.active is not self.codex or not self.fallback:raise
            self.remember_limit();self.activate_fallback()
            self.status('fallback_searching' if method=='discover' else 'fallback_running')
            return getattr(self.active,method)(*args)

    def execution(self,stamp):
        search=(stamp.get('provider') or {'provider':'codex','model':'unknown'}) if self.web_search else None
        return {'collector':search.get('provider','codex')+' CLI live web search' if search else 'local Python RSS',
                'provider':getattr(self.active,'provider','codex'),'model':getattr(self.active,'model','unknown'),
                'reasoning_effort':getattr(self.active,'reasoning_effort','unknown'),
                'web_search':self.web_search,'rss':self.rss,'search_execution':search,
                'fallback_reason':'codex_quota_exhausted' if self.active is self.fallback else None}

    def status(self,status,error=None,next_retry=None):
        record={'status':status,'error':error,'last_seen':now(),'next_retry_at':datetime.fromtimestamp(next_retry,timezone.utc).isoformat() if next_retry else None,
                'last_check_at':self.store.get('last_check_at'),**self.store.counts()}
        self.store.set('status',record)
        try:self.cloud.heartbeat(record)
        except Exception:self.store.set('heartbeat_pending',record)
    def upload(self):
        for job in self.store.jobs():
            if job['stage']=='upload_pending':
                try:self.cloud.publish(json.loads(job['payload']));self.store.complete(job)
                except Exception as e:
                    self.status('upload_pending','Cloud upload failed; validated result retained');return False
        return True
    def cycle(self):
        # Retry already-validated output before any model execution.
        if not self.upload():return
        try:config=self.cloud.config()
        except Exception:
            self.status('failed','Cannot read cloud settings; no analysis started');return
        source_results=[]
        for source in (config['sources'] if self.rss else []):
            if not source['enabled']:continue
            try:
                articles=parse_feed(self.fetcher(source['url']),source,self.cloud.owner)
                self.store.add(articles[:10] if self.web_search else articles)
                source_results.append({'name':source['name'],'ok':True,'count':len(articles)})
            except Exception as e:source_results.append({'name':source['name'],'ok':False,'count':0,'error':type(e).__name__})
        self.store.set('source_results',source_results)
        if not any(p['enabled'] for p in config['purposes']):
            self.status('idle','Configure at least one enabled purpose');return
        if not self.store.pending() and not self.web_search:
            self.status('failed' if any(not s['ok'] for s in source_results) else 'no_new',
                        'One or more RSS sources failed' if any(not s['ok'] for s in source_results) else None);return
        retry=self.store.get('next_retry',0)
        primary_reset=self.store.get('codex_wait',{}).get('next_retry_at')
        may_recheck=bool(primary_reset and self.clock()>=primary_reset)
        if retry and self.clock()<retry and not (self.fallback and (self.store.get('wait_status')=='waiting_quota' or may_recheck)):
            self.status(self.store.get('wait_status','waiting_quota'),self.store.get('wait_reason'),retry);return
        cached=self.store.get('codex_wait',{})
        try:
            if cached.get('next_retry_at',0) and self.clock()<cached['next_retry_at']:
                q=cached
            else:
                q=quota_state(self.codex.quota(),self.buckets,self.store.get('attempt',0),self.clock())
                self.store.set('last_check_at',now())
                self.store.set('codex_wait',q if q['status']=='waiting_quota' else {})
        except CodexFailure as e:q={'status':e.code,'next_retry_at':self.clock()+3600,'reason':str(e)}
        except Exception:q={'status':'quota_unknown','next_retry_at':self.clock()+3600,'reason':'Quota query failed'}
        self.active=self.codex
        if q['status']=='waiting_quota' and self.fallback:
            try:self.activate_fallback()
            except CodexFailure as e:
                self.wait({'status':e.code,'next_retry_at':self.clock()+900,'reason':str(e)});return
        elif q['status']!='available':
            self.wait(q);return
        self.store.set('attempt',0);self.store.set('next_retry',0)
        stamp={}
        if self.web_search:
            stamp=self.store.get('web_search_cache',{})
            digest=config_hash(config)
            if stamp.get('config_hash')!=digest or self.clock()-stamp.get('at',0)>=self.search_interval:
                self.status('fallback_searching' if self.active is self.fallback else 'searching')
                try:
                    discovered,coverage=self.invoke('discover',{**config,'_owner_id':self.cloud.owner})
                    self.store.add(discovered)
                    stamp={'config_hash':digest,'at':self.clock(),'coverage':coverage,
                           'provider':{'provider':getattr(self.active,'provider','codex'),'model':getattr(self.active,'model','unknown')}}
                    self.store.set('web_search_cache',stamp)
                except CodexFailure as e:
                    self.wait({'status':e.code,'next_retry_at':self.clock()+900,'reason':str(e)});return
                except Exception:
                    self.wait({'status':'search_failed','next_retry_at':self.clock()+900,'reason':'Live discovery failed; no fabricated results published'});return
            source_results=stamp.get('coverage',[])+source_results
            self.store.set('source_results',source_results)
        if not self.store.pending():
            self.status('no_new');return
        # Resume persisted unfinished work; replan if any cloud settings/notes changed.
        unfinished=[j for j in self.store.jobs() if j['stage'] in ('analyzing','reporting')]
        if unfinished:
            job=unfinished[0]
            previous=json.loads(job['snapshot'])
            if previous['_config_hash']!=config_hash(config):
                self.store.db.execute('delete from jobs where id=?',(job['id'],));self.store.db.commit();unfinished=[]
        if not unfinished:
            batch=self.store.pending()
            snapshot={**config,'_config_hash':config_hash(config),'_started_at':now(),'_execution':self.execution(stamp)}
            snapshot['history']=self.cloud.history()
            # Keep all candidate identities, cap active context explicitly.
            snapshot['_active_track_total']=sum(t['status']=='active' for t in snapshot['tracks'])
            active=[t for t in snapshot['tracks'] if t['status']=='active'][:40]
            snapshot['tracks']=active+[t for t in snapshot['tracks'] if t['status']!='active']
            job={'id':str(uuid.uuid4()),'snapshot':json.dumps(snapshot),'articles':json.dumps(batch),'stage':'analyzing','payload':None}
            self.store.save_job(job)
        snapshot=json.loads(job['snapshot']);batch=json.loads(job['articles'])
        self.status('fallback_running' if self.active is self.fallback else 'running')
        try:
            if job['stage']=='reporting':
                result=json.loads(job['payload'])
            else:
                result=validate_result(self.invoke('analyze',batch,snapshot),batch,snapshot)
                if self.detailed_reports:
                    result['purpose_reports']=[]
                    job['stage']='reporting';job['payload']=json.dumps(result);self.store.save_job(job)
            if self.detailed_reports:
                from .reports import validate_report
                completed={r['purpose_id'] for r in result['purpose_reports']}
                for purpose in snapshot['purposes']:
                    if not purpose['enabled'] or purpose['id'] in completed:continue
                    relevant={a['article_id'] for a in result['analyses'] if purpose['id'] in a['purpose_ids']}
                    evidence=[a for a in batch if a['id'] in relevant]
                    context={**snapshot,'_source_results':source_results}
                    report=validate_report(self.invoke('report',purpose,evidence,context),purpose,evidence)
                    report['_execution']={'provider':getattr(self.active,'provider','codex'),'model':getattr(self.active,'model','unknown')}
                    result['purpose_reports'].append(report)
                    job['payload']=json.dumps(result);self.store.save_job(job)
                snapshot['purpose_reports']=result['purpose_reports']
            snapshot['_execution']=self.execution(stamp)
            job['snapshot']=json.dumps(snapshot)
            payload=build_payload(result,batch,snapshot,job['id'],self.cloud.owner,self.cloud.node,source_results)
            job['payload']=json.dumps(payload);job['stage']='upload_pending';self.store.save_job(job)
        except CodexFailure as e:
            if e.code=='waiting_quota':
                try:q=quota_state(self.codex.quota(),self.buckets,self.store.get('attempt',0),self.clock())
                except Exception:q={'status':'waiting_quota','next_retry_at':self.clock()+900,'reason':str(e)}
                if q['status']=='available':q={'status':'waiting_quota','next_retry_at':self.clock()+900,'reason':str(e)}
                self.wait(q)
            else:
                delay=900 if e.code.startswith('fallback_') else 3600
                self.store.set('next_retry',self.clock()+delay);self.store.set('wait_status',e.code);self.store.set('wait_reason',str(e))
                self.status(e.code,str(e),self.clock()+delay)
            return
        except Exception as e:
            self.store.set('next_retry',self.clock()+3600);self.store.set('wait_status','failed');self.store.set('wait_reason','Invalid or incomplete model output')
            self.status('failed','Invalid or incomplete model output',self.clock()+3600);return
        if self.upload():self.status(payload['run']['status'])
    def wait(self,q):
        retry=q['next_retry_at'] or self.clock()+3600
        self.store.set('next_retry',retry);self.store.set('wait_status',q['status']);self.store.set('wait_reason',q['reason'])
        self.store.set('attempt',self.store.get('attempt',0)+1)
        self.status(q['status'],q['reason'],retry)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--collection',choices=('web','hybrid','rss'),default=None,help='Default: web; hybrid also reads RSS')
    parser.add_argument('--refresh-reports',action='store_true',help='Rebuild detailed reports using the latest local evidence')
    parser.add_argument('--once',action='store_true',help='Run one collection/analysis batch')
    parser.add_argument('--monitor',action='store_true',help='Run due recovery only; no regular schedule')
    args=parser.parse_args()
    if not args.once and not args.monitor:parser.error('Choose --once or --monitor')
    env_file=Path(__file__).resolve().parent.parent/'.env.worker'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);os.environ.setdefault(key.strip(),value.strip())
    required=('SUPABASE_URL','SUPABASE_SECRET_KEY','OWNER_ID')
    missing=[k for k in required if not os.environ.get(k)]
    if missing:parser.error('Missing environment variables: '+', '.join(missing))
    directory=Path(os.environ.get('WORKER_DATA_DIR','.data'));directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    with open(directory/'worker.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        store=Store(directory/'worker.sqlite3')
        if args.refresh_reports:
            store.db.execute('update articles set done=0 where id in (select id from articles order by rowid desc limit 40)');store.db.commit()
        if args.monitor and not store.jobs() and not store.get('next_retry',0):return
        cloud=Cloud(os.environ['SUPABASE_URL'],os.environ['SUPABASE_SECRET_KEY'],os.environ['OWNER_ID'],os.environ.get('NODE_ID','home-mac-mini'))
        mode=args.collection or os.environ.get('COLLECTION_MODE','web')
        if mode not in ('web','hybrid','rss'):parser.error('Invalid COLLECTION_MODE')
        from .claude import Claude
        fallback=Claude() if os.environ.get('CLAUDE_FALLBACK_ENABLED','0')=='1' else None
        runner=Runner(store,cloud,Codex(),fallback=fallback,detailed_reports=True,buckets=tuple(os.environ.get('CODEX_LIMIT_IDS','codex').split(',')),
                      web_search=mode!='rss',rss=mode!='web',search_interval=int(os.environ.get('WEB_SEARCH_INTERVAL_SECONDS','21600')))
        try:runner.cycle()
        except Exception as e:runner.status('failed','Worker failure: '+type(e).__name__)
        print(json.dumps(store.get('status'),ensure_ascii=False))
        store.db.close()
if __name__=='__main__':main()
