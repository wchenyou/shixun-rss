import copy
import json
import unittest
import test_worker as fixtures
from worker.reports import validate_report
from worker.codex import CodexFailure

def report(purpose,articles):
 refs=[a['id'] for a in articles]
 return {'purpose_id':purpose['id'],'title':'方向整合分析','overview':'先說本輪結論。','sections':[{'heading':'證據與脈絡','paragraphs':['根據取得的來源解釋變化。'],'bullets':[],'tables':[{'headers':['事實','判斷'],'rows':[['有來源','仍待驗證']]}],'evidence_ids':refs}],'conclusion':'保持觀察。','next_steps':['下輪檢查是否有新證據。'],'limitations':['不是即時行情。'],'evidence_ids':refs}

class ReportValidationTests(unittest.TestCase):
 def setUp(self):
  self.purpose={'id':fixtures.PURPOSE};self.articles=[{'id':'source-1'}]
 def test_source_ids_are_validated(self):
  r=report(self.purpose,self.articles);r['sections'][0]['evidence_ids']=['invented']
  with self.assertRaises(ValueError):validate_report(r,self.purpose,self.articles)
 def test_another_direction_cannot_be_published(self):
  r=report(self.purpose,self.articles);r['purpose_id']='wrong'
  with self.assertRaises(ValueError):validate_report(r,self.purpose,self.articles)
 def test_malformed_table_is_rejected(self):
  r=report(self.purpose,self.articles);r['sections'][0]['tables'][0]['rows']=[['only-one-cell']]
  with self.assertRaises(ValueError):validate_report(r,self.purpose,self.articles)
 def test_available_evidence_cannot_be_ignored(self):
  r=report(self.purpose,[])
  with self.assertRaises(ValueError):validate_report(r,self.purpose,self.articles)
 def test_no_evidence_can_report_a_coverage_gap(self):
  r=report(self.purpose,[]);self.assertEqual(validate_report(r,self.purpose,[]),r)

class ReportPublicationTests(unittest.TestCase):
 def setUp(self):
  fixtures.WorkerTests.setUp(self);self.runner.detailed_reports=True
  self.calls=[]
  def generate(purpose,articles,config):
   self.calls.append(purpose['id']);return report(purpose,articles)
  self.codex.report=generate
 def tearDown(self):fixtures.WorkerTests.tearDown(self)
 def test_reports_are_in_the_same_atomic_publication_snapshot(self):
  self.runner.cycle();payload=next(iter(self.cloud.published.values()))
  self.assertEqual(len(payload['run']['config_snapshot']['purpose_reports']),1)
  self.assertEqual(self.calls,[fixtures.PURPOSE])
 def test_completed_reports_survive_restart_without_reanalysis(self):
  second=copy.deepcopy(self.cloud.settings['purposes'][0]);second['id']='second-purpose';self.cloud.settings['purposes'].append(second)
  original=self.codex.analyze
  def relevant_to_both(articles,config):
   value=original(articles,config)
   for item in value['analyses']:item['purpose_ids'].append('second-purpose')
   return value
  self.codex.analyze=relevant_to_both
  def fail_second(purpose,articles,config):
   self.calls.append(purpose['id'])
   if purpose['id']=='second-purpose':raise CodexFailure('interrupted')
   return report(purpose,articles)
  self.codex.report=fail_second;self.runner.cycle()
  self.assertFalse(self.cloud.published);self.assertEqual(self.store.jobs()[0]['stage'],'reporting')
  completed=json.loads(self.store.jobs()[0]['payload'])['purpose_reports'];self.assertEqual(len(completed),1)
  self.store.db.close();self.store=fixtures.Store(self.path);self.runner.store=self.store
  self.clock[0]=5000
  self.codex.report=lambda p,a,c: report(p,a)
  self.runner.cycle();self.assertEqual(self.codex.calls,1)
  self.assertEqual(len(next(iter(self.cloud.published.values()))['run']['config_snapshot']['purpose_reports']),2)
 def test_invalid_report_blocks_publication_and_preserves_work(self):
  def invalid(purpose,articles,config):
   r=report(purpose,articles);r['evidence_ids']=['invented'];return r
  self.codex.report=invalid;self.runner.cycle()
  self.assertFalse(self.cloud.published);self.assertEqual(self.store.counts()['pending_articles'],45)
