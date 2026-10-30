import json
from datetime import datetime, timezone, timedelta
import unittest
from unittest.mock import patch
from worker.search import discovered_articles, retrieve
from worker.codex import CodexFailure
import test_worker as fixtures
from test_worker import PURPOSE, OWNER, feed

URL='https://example.com/new-release'
CONFIG={'purposes':[{'id':PURPOSE,'enabled':True,'name':'AI'}],'_owner_id':OWNER}
def events():
 return [{'type':'item.completed','item':{'type':'web_search','action':{'type':'search'},'results':[{'type':'text_result','url':URL,'title':'New release','snippet':'A verified tool excerpt, not an invented summary.'}]}}]
def selection(url=URL):
 return {'articles':[{'url':url,'purpose_id':PURPOSE}],'coverage':[{'purpose_id':PURPOSE,'note':'Official release found; adoption not established.'}]}
class SearchEvidenceTests(unittest.TestCase):
 def test_invented_url_is_rejected(self):
  with self.assertRaises(CodexFailure):discovered_articles(selection('https://example.com/invented'),events(),CONFIG)
 def test_no_search_cannot_claim_discovery(self):
  with self.assertRaises(CodexFailure):discovered_articles(selection(),[],CONFIG)
 def test_missing_purpose_coverage_rejected(self):
  data=selection();data['coverage']=[]
  with self.assertRaises(CodexFailure):discovered_articles(data,events(),CONFIG)
 def test_failed_page_preserves_real_excerpt_and_marks_not_fulltext(self):
  with patch('worker.search.public_url',side_effect=lambda url:url),patch('worker.search.MIN_FRESH',0):
   articles,coverage=discovered_articles(selection(),events(),CONFIG,fetcher=lambda _:(_ for _ in ()).throw(OSError()))
  self.assertIn('verified tool excerpt',articles[0]['content'])
  self.assertIn('非全文',articles[0]['content']);self.assertIsNone(articles[0]['published_at'])
  self.assertEqual(coverage[0]['count'],1)
 def test_page_text_excludes_scripts(self):
  raw=('<html><title>Actual page title</title><script>secret-script</script><body>'+('Verified page evidence. '*15)+'</body></html>').encode()
  with patch('worker.search.public_url',side_effect=lambda url:url):
   a=retrieve(events()[0]['item']['results'][0],OWNER,lambda _:raw)
  self.assertEqual(a['title'],'Actual page title');self.assertNotIn('secret-script',a['content'])
 def test_main_article_is_preferred_to_navigation(self):
  raw=('<title>News</title><nav>'+('Navigation '*50)+'</nav><main>'+('Original evidence. '*15)+'</main>').encode()
  with patch('worker.search.public_url',side_effect=lambda url:url):
   a=retrieve(events()[0]['item']['results'][0],OWNER,lambda _:raw)
  self.assertIn('Original evidence',a['content']);self.assertNotIn('Navigation',a['content'])

class FreshnessGateTests(unittest.TestCase):
 def run_gate(self,dates,minimum=3):
  evs=[{'type':'item.completed','item':{'type':'web_search','action':{'type':'search'},'results':[
   {'type':'text_result','url':f'https://example.com/a{i}','title':'t','snippet':'s'*50} for i in range(len(dates))]}}]
  sel={'articles':[{'url':f'https://example.com/a{i}','purpose_id':PURPOSE} for i in range(len(dates))],
       'coverage':[{'purpose_id':PURPOSE,'note':'n'}]}
  def fetcher(url):
   d=dates[int(url[-1])]
   meta=f'<meta property="article:published_time" content="{d}">' if d else ''
   return ('<title>x</title>'+meta+'<main>'+'evidence text. '*20+'</main>').encode()
  with patch('worker.search.public_url',side_effect=lambda u:u),patch('worker.search.MIN_FRESH',minimum):
   return discovered_articles(sel,evs,CONFIG,fetcher=fetcher)
 def days(self,n):return (datetime.now(timezone.utc)-timedelta(days=n)).isoformat()
 def test_exactly_n_passes(self):
  a,c=self.run_gate([self.days(1)]*3);self.assertEqual(len(a),3);self.assertFalse(c[0]['insufficient'])
 def test_n_minus_one_blocked_with_reason(self):
  a,c=self.run_gate([self.days(1)]*2);self.assertEqual(a,[]);self.assertTrue(c[0]['insufficient']);self.assertIn('需要 3 篇',c[0]['error'])
 def test_all_null_dates_is_insufficient_not_zero_found(self):
  a,c=self.run_gate([None]*4);self.assertEqual(a,[]);self.assertEqual(c[0]['count'],4);self.assertEqual(c[0]['dated'],0)
 def test_future_and_stale_dates_not_fresh(self):
  a,c=self.run_gate([(datetime.now(timezone.utc)+timedelta(days=3)).isoformat(),self.days(30),self.days(1)]);self.assertEqual(c[0]['fresh'],1)
 def test_bad_date_keeps_body(self):
  a,c=self.run_gate(['not-a-date'],minimum=0);self.assertIn('evidence text',a[0]['content']);self.assertIsNone(a[0]['published_at'])

class WebRunnerTests(unittest.TestCase):
 def tearDown(self):fixtures.WorkerTests.tearDown(self)
 def setUp(self):
  fixtures.WorkerTests.setUp(self)
  self.discovery_calls=0
  def discover(config):
   self.discovery_calls+=1
   from worker.core import parse_feed
   return parse_feed(feed(2),{'name':'全網搜尋 · example.com'},OWNER),[{'name':'全網搜尋 · AI','ok':True,'count':2}]
  self.codex.discover=discover
  self.runner.web_search=True;self.runner.rss=False
 def test_web_mode_runs_without_any_rss_sources_and_caches_search(self):
  self.cloud.settings['sources']=[]
  self.runner.cycle();self.runner.cycle()
  self.assertEqual(self.discovery_calls,1);self.assertEqual(len(self.cloud.published),1)
  payload=next(iter(self.cloud.published.values()))
  self.assertTrue(payload['run']['config_snapshot']['_execution']['web_search'])
  self.assertIn('全網搜尋',payload['articles'][0]['source_name'])
 def test_quota_stops_discovery(self):
  self.codex.blocked=True;self.runner.cycle()
  self.assertEqual(self.discovery_calls,0);self.assertFalse(self.cloud.published)
 def test_discovery_failure_is_visible_and_retry_is_throttled(self):
  def fail(config):
   self.discovery_calls+=1
   raise CodexFailure('No real search results','search_failed')
  self.codex.discover=fail
  self.runner.cycle();self.runner.cycle()
  self.assertEqual(self.discovery_calls,1);self.assertFalse(self.cloud.published)
  self.assertEqual(self.store.get('status')['status'],'search_failed')

class AllInsufficientTests(WebRunnerTests):
 def test_all_directions_insufficient_is_visible_and_schedule_closes(self):
  from datetime import datetime, timezone
  from worker.schedule import DailySchedule
  cov=[{'name':'全網搜尋 · AI','ok':False,'count':2,'fresh':0,'dated':0,'required':3,'insufficient':True,'error':'資料不足：找到 2 篇、0 篇可確認日期、0 篇在 7 天內，需要 3 篇'}]
  self.codex.discover=lambda config:([],cov)
  self.cloud.settings['sources']=[]
  at=datetime(2026,10,24,3,tzinfo=timezone.utc)
  sched=DailySchedule(self.store,self.cloud,at);self.assertTrue(sched.due)
  self.runner.cycle()
  st=self.store.get('status');self.assertEqual(st['status'],'insufficient');self.assertIn('需要 3 篇',st['error'])
  self.assertFalse(self.cloud.published)
  sched.finish();self.assertFalse(DailySchedule(self.store,self.cloud,at).due)
 test_web_mode_runs_without_any_rss_sources_and_caches_search=None
 test_quota_stops_discovery=None
 test_discovery_failure_is_visible_and_retry_is_throttled=None

class RssPartialTests(unittest.TestCase):
 def setUp(self):fixtures.WorkerTests.setUp(self)
 def tearDown(self):fixtures.WorkerTests.tearDown(self)
 def test_failed_rss_source_reports_rss_partial_not_failed(self):
  self.runner.fetcher=lambda url:(_ for _ in ()).throw(OSError())
  self.runner.cycle()
  self.assertEqual(self.store.get('status')['status'],'rss_partial')
