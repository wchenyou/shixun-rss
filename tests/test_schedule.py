import unittest
from datetime import datetime, timezone
from worker.schedule import DailySchedule
import test_worker as fixtures
from test_fallback import FakeFallback

class ScheduleTests(unittest.TestCase):
 def setUp(self):
  fixtures.WorkerTests.setUp(self)
  self.cloud.settings['purposes'][0]['daily_time']='09:00:00'
  self.cloud.settings['sources'][0]['daily_time']='10:00:00'
 def tearDown(self):fixtures.WorkerTests.tearDown(self)
 def at(self,hour,minute=0):return datetime(2026,10,24,hour,minute,tzinfo=timezone.utc)
 def test_taipei_time_and_individual_source_times(self):
  before=DailySchedule(self.store,self.cloud,self.at(0,59));self.assertFalse(before.due)
  direction=DailySchedule(self.store,self.cloud,self.at(1));self.assertEqual(direction.preview()['due_directions'],1);self.assertEqual(direction.source_ids,[])
  both=DailySchedule(self.store,self.cloud,self.at(2));self.assertEqual(len(both.source_ids),1)
 def test_success_is_once_per_day_and_new_day_runs_again(self):
  job=DailySchedule(self.store,self.cloud,self.at(2));self.store.set('status',{'status':'complete'});self.store.set('source_results',[{'source_id':'source','ok':True}]);job.finish()
  self.assertFalse(DailySchedule(self.store,self.cloud,self.at(3)).due)
  tomorrow=datetime(2026,10,25,2,tzinfo=timezone.utc)
  self.assertTrue(DailySchedule(self.store,self.cloud,tomorrow).due)
 def test_failure_does_not_mark_schedule_done(self):
  job=DailySchedule(self.store,self.cloud,self.at(2));self.store.set('status',{'status':'fallback_model_failed'});job.finish()
  self.assertTrue(DailySchedule(self.store,self.cloud,self.at(3)).due)
 def test_disabled_source_is_not_due(self):
  self.cloud.settings['sources'][0]['enabled']=False
  self.assertEqual(DailySchedule(self.store,self.cloud,self.at(2)).source_ids,[])
 def test_time_edit_rearms_schedule(self):
  job=DailySchedule(self.store,self.cloud,self.at(2));self.store.set('status',{'status':'no_new'});self.store.set('source_results',[{'source_id':'source','ok':True}]);job.finish()
  self.cloud.settings['sources'][0]['daily_time']='10:30:00'
  self.assertFalse(DailySchedule(self.store,self.cloud,self.at(2,15)).due)
  self.assertEqual(len(DailySchedule(self.store,self.cloud,self.at(2,30)).source_ids),1)
 def test_claude_primary_skips_codex_quota_and_uses_claude_search(self):
  primary=FakeFallback();primary.quota=lambda: self.fail('Claude primary must not query Codex quota')
  self.runner.codex=primary;self.runner.active=primary;self.runner.web_search=True;self.runner.rss=False
  self.runner.cycle()
  self.assertEqual(primary.discovery_calls,1);self.assertEqual(primary.calls,1)
  payload=next(iter(self.cloud.published.values()))
  self.assertEqual(payload['run']['config_snapshot']['_execution']['provider'],'claude')

 def test_failed_source_remains_due_after_partial_publication(self):
  job=DailySchedule(self.store,self.cloud,self.at(2));self.store.set('status',{'status':'partial'})
  self.store.set('source_results',[{'source_id':'source','ok':False}]);job.finish()
  remaining=DailySchedule(self.store,self.cloud,self.at(3))
  self.assertEqual(remaining.purpose_ids,[]);self.assertEqual(remaining.source_ids,['source'])
