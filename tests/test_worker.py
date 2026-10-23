import copy
import tempfile
import unittest
from pathlib import Path
from worker.core import *
from worker.runner import Store,Runner
from worker.codex import CodexFailure

OWNER='00000000-0000-0000-0000-000000000001'
PURPOSE='00000000-0000-0000-0000-000000000002'
def feed(n=1):
 return ('<rss><channel>'+''.join(f'<item><title>Article {i}</title><link>https://example.com/{i}</link><description>Evidence {i}</description></item>' for i in range(n))+'</channel></rss>').encode()
class FakeCloud:
 owner=OWNER;node='test'
 def __init__(self):
  self.settings={'purposes':[{'id':PURPOSE,'name':'Research','description':'Evidence','version':1,'enabled':True}], 'sources':[{'id':'source','name':'News','url':'https://example.com/feed','enabled':True,'version':1}], 'tracks':[], 'track_notes':[]}
  self.published={};self.fail_upload=False;self.fail_config=False;self.states=[]
 def config(self):
  if self.fail_config:raise OSError('offline')
  return copy.deepcopy(self.settings)
 def history(self):return []
 def publish(self,p):
  if self.fail_upload:raise OSError('offline')
  self.published[p['run']['id']]=p
 def heartbeat(self,s):self.states.append(s)
class FakeCodex:
 def __init__(self):self.calls=0;self.quota_calls=0;self.blocked=False;self.fail_at=None;self.invalid=False
 def quota(self):
  self.quota_calls+=1
  return {'rateLimits':{'limitId':'codex','primary':{'usedPercent':100 if self.blocked else 10,'resetsAt':2000}}}
 def analyze(self,articles,config):
  self.calls+=1
  if self.calls==self.fail_at:
   self.blocked=True
   raise CodexFailure('quota','waiting_quota')
  rows=[{'article_id':a['id'],'summary':'summary','relevance':'relevant','purpose_ids':[PURPOSE]} for a in articles]
  return {'report':'Report','analyses':rows[:-1] if self.invalid else rows,'candidates':[],'evaluations':[]}

class WorkerTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'cache.db';self.store=Store(self.path)
  self.cloud=FakeCloud();self.codex=FakeCodex();self.clock=[1000]
  self.runner=Runner(self.store,self.cloud,self.codex,lambda _:feed(45),lambda:self.clock[0])
 def tearDown(self):self.store.db.close();self.tmp.cleanup()
 def test_second_batch_quota_preserves_first_and_restarts(self):
  self.codex.fail_at=2
  self.runner.cycle();self.assertEqual(len(self.cloud.published),1);self.assertEqual(len(self.store.pending()),5)
  self.runner.cycle();self.assertEqual(self.store.get('status')['status'],'waiting_quota')
  checks=self.codex.quota_calls
  self.runner.cycle();self.assertEqual(self.codex.calls,2);self.assertEqual(self.codex.quota_calls,checks)
  self.store.db.close();self.store=Store(self.path);self.runner.store=self.store
  self.clock[0]=2100;self.codex.blocked=False
  self.runner.cycle();self.assertEqual(len(self.cloud.published),2);self.assertEqual(self.store.pending(),[])
 def test_upload_retry_does_not_reanalyze(self):
  self.cloud.fail_upload=True;self.runner.cycle();self.assertEqual(self.codex.calls,1)
  self.runner.cycle();self.assertEqual(self.codex.calls,1)
  self.cloud.fail_upload=False
  self.runner.upload();self.runner.upload()
  self.assertEqual(self.codex.calls,1);self.assertEqual(len(self.cloud.published),1)
 def test_cloud_settings_unavailable_no_model(self):
  self.cloud.fail_config=True;self.runner.cycle();self.assertEqual(self.codex.calls,0)
 def test_reconfigure_unfinished_batch(self):
  self.codex.invalid=True;self.runner.cycle()
  old=self.store.jobs()[0]['id']
  self.cloud.settings['purposes'][0]['version']=2;self.clock[0]=5000;self.codex.invalid=False
  self.runner.cycle()
  self.assertNotIn(old,self.cloud.published)
  self.assertEqual(next(iter(self.cloud.published.values()))['run']['config_snapshot']['purposes'][0]['version'],2)
 def test_invalid_output_never_marks_articles_done(self):
  self.codex.invalid=True;self.runner.cycle()
  self.assertEqual(self.store.counts()['pending_articles'],45);self.assertFalse(self.cloud.published)
 def test_all_blocking_windows_wait_for_latest(self):
  q=quota_state({'rateLimitsByLimitId':{'codex':{'primary':{'usedPercent':100,'resetsAt':2000},'secondary':{'usedPercent':100,'resetsAt':3000}}}},timestamp=1000)
  self.assertEqual(q['next_retry_at'],3030)
 def test_unknown_reset_uses_bounded_backoff(self):
  q=quota_state({'rateLimits':{'primary':{'usedPercent':100}}},timestamp=1000,attempt=8)
  self.assertEqual(q['status'],'waiting_quota');self.assertEqual(q['next_retry_at'],4600)
 def test_missing_bucket_is_unknown(self):
  self.assertEqual(quota_state({},timestamp=1000)['status'],'quota_unknown')
 def test_dedup_and_atom(self):
  self.assertEqual(canonical_url('https://EXAMPLE.com/a?utm_source=x#b'),'https://example.com/a')
  self.store.add(parse_feed(feed(),{'name':'n'},OWNER));self.store.add(parse_feed(feed(),{'name':'n'},OWNER))
  self.assertEqual(len(self.store.pending()),1)
  atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Hi</title><link href="https://example.com/a"/><summary>Text</summary></entry></feed>'
  self.assertEqual(parse_feed(atom,{'name':'n'},OWNER)[0]['content'],'Text')
 def test_invalid_evidence_rejected(self):
  a=parse_feed(feed(),{'name':'n'},OWNER);r=self.codex.analyze(a,self.cloud.config())
  r['candidates']=[{'purpose_id':PURPOSE,'question':'Q','title':'T','evidence_ids':['invented']}]
  with self.assertRaises(ValueError):validate_result(r,a,self.cloud.config())
 def test_shared_process_lock_prevents_duplicate_work(self):
  import fcntl,subprocess,os,sys
  lockpath=Path(self.tmp.name)/'worker.lock'
  with lockpath.open('w') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   env={**os.environ,'WORKER_DATA_DIR':self.tmp.name,'SUPABASE_URL':'https://example.invalid','SUPABASE_SECRET_KEY':'test','OWNER_ID':OWNER}
   r=subprocess.run([sys.executable,'-m','worker.runner','--once'],env=env,capture_output=True,timeout=3)
   self.assertEqual(r.returncode,0);self.assertEqual(r.stdout,b'')
 def test_xml_entities_rejected(self):
  with self.assertRaises(ValueError):parse_feed(b'<!DOCTYPE rss [<!ENTITY e "bad">]><rss/>',{'name':'n'},OWNER)
 def test_auth_failure_is_not_quota(self):
  def fail():raise CodexFailure('login required','auth_required')
  self.codex.quota=fail;self.runner.cycle()
  self.assertEqual(self.store.get('status')['status'],'auth_required');self.assertEqual(self.codex.calls,0)
if __name__=='__main__':unittest.main()
