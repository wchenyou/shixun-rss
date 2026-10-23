"""Opt-in live Supabase verification. Creates isolated test users and cleans up."""
import json,os,secrets,subprocess,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from worker.core import now,stable_id
from worker.cloud import Cloud
from worker.runner import build_payload

def main():
 env=dict(line.split('=',1) for line in Path('.env.worker').read_text().splitlines() if '=' in line)
 url=env['SUPABASE_URL'];key=env['SUPABASE_SECRET_KEY'];owners=[]
 def request(path,body=None,token=key,method=None):
  headers={'apikey':key,'Authorization':'Bearer '+token,'Content-Type':'application/json'}
  req=Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
  with urlopen(req,timeout=30) as r:
   raw=r.read();return json.loads(raw) if raw else None
 try:
  sessions=[]
  for i in range(2):
   email='shixun-test-'+str(uuid.uuid4())+'@example.com';password=secrets.token_urlsafe(30)
   user=request('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True})
   owners.append(user['id'])
   sessions.append(request('/auth/v1/token?grant_type=password',{'email':email,'password':password}))
  owner=owners[0];cloud=Cloud(url,key,owner,'test-'+owner)
  cloud.request('owners',{'id':owner})
  purpose=str(uuid.uuid4());track=str(uuid.uuid4())
  cloud.request('purposes',{'id':purpose,'owner_id':owner,'name':'技術研究測試','description':'追蹤有證據的能力進展'})
  cloud.request('tracks',{'id':track,'owner_id':owner,'purpose_id':purpose,'title':'技術能否落地？','question':'哪些限制已解除？','status':'active'})
  config=cloud.config()|{'_started_at':now()}
  a={'id':stable_id(owner,'article'),'title':'測試來源：新工具公布可驗證的更新','url':'https://example.com/test','source_name':'驗證資料','content':'這是測試資料，不是新聞。','published_at':now(),'collected_at':now()}
  result={'report':'這是端到端測試筆記。','analyses':[{'article_id':a['id'],'summary':'測試摘要，附上來源。','relevance':'與技術研究方向相關','purpose_ids':[purpose]}],'candidates':[],
          'evaluations':[{'track_id':track,'summary':'本輪新增測試證據','change':'持續觀察','evidence_ids':[a['id']],'counter_evidence':'尚需真實使用資料','next_question':'下一次觀察實際採用情況'}]}
  payload=build_payload(result,[a],config,str(uuid.uuid4()),owner,cloud.node,[])
  # Pause while analysis is running. Publishing must not reactivate.
  request('/rest/v1/tracks?id=eq.'+track,{'status':'paused'},sessions[0]['access_token'],'PATCH')
  cloud.publish(payload);cloud.publish(payload)
  assert len(cloud.rows('analyses'))==1
  assert len(cloud.rows('evaluations'))==1
  assert cloud.rows('tracks')[0]['status']=='paused'
  assert cloud.rows('evaluations')[0]['applicable'] is False
  assert request('/rest/v1/articles?select=id',token=sessions[1]['access_token'])==[]
  try:
   request('/rest/v1/analyses?id=eq.'+payload['analyses'][0]['id'],{'summary':'unauthorized'},sessions[0]['access_token'],'PATCH')
   raise AssertionError('Browser could edit AI analysis')
  except HTTPError as e:assert e.code in (401,403)
  # Atomic rollback: an invalid evidence reference must publish nothing.
  bad=build_payload(result,[a],config,str(uuid.uuid4()),owner,cloud.node,[])
  bad['evaluations'][0]['evidence_ids']=[str(uuid.uuid4())]
  try:cloud.publish(bad);raise AssertionError('Invalid batch accepted')
  except HTTPError:pass
  assert len(cloud.rows('runs'))==1
  cloud.heartbeat({'last_seen':now(),'status':'complete','pending_articles':0,'pending_uploads':0})
  session_path=Path('.data/test-session.json');session_path.parent.mkdir(exist_ok=True)
  session_path.write_text(json.dumps(sessions[0]));session_path.chmod(0o600)
  print('PASS: RLS isolation, AI write denial, idempotent publish, atomic rollback, paused-track preservation.')
  subprocess.run(['npx','playwright','test','tests/browser/live.spec.ts'],check=True)
 finally:
  for owner in owners:
   for table in ('article_states','track_notes','evaluations','analyses','articles','tracks','runs','sources','purposes','nodes'):
    try:request('/rest/v1/'+table+'?owner_id=eq.'+owner,method='DELETE')
    except Exception:pass
   try:request('/rest/v1/owners?id=eq.'+owner,method='DELETE')
   except Exception:pass
   request('/auth/v1/admin/users/'+owner,method='DELETE')
  Path('.data/test-session.json').unlink(missing_ok=True)
  print('Removed isolated integration-test users and data.')
if __name__=='__main__':main()
