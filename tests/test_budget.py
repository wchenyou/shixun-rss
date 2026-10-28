import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from worker.budget import Budget, BudgetStop, claude_usage, codex_usage
from worker.cloud import clean_transport
from worker.core import config_hash, validate_result
from worker.runner import Runner, Store
from worker.search import retrieve
from tests.test_worker import FakeCloud, FakeCodex, feed


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'cache.db')
        self.clock = [datetime(2026, 10, 28, 23, 50, tzinfo=ZoneInfo('Asia/Taipei')).timestamp()]
        self.budget = Budget(self.store, {}, lambda: self.clock[0])

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def test_unknown_usage_keeps_reservation_across_restart(self):
        token = self.budget.reserve('analyze', ([], {}))
        charge = self.budget.rows()[0]['charged']
        restarted = Budget(self.store, {}, lambda: self.clock[0])
        self.assertEqual(restarted.rows()[0]['status'], 'interrupted')
        self.assertEqual(restarted.rows()[0]['charged'], charge)
        with self.assertRaises(BudgetStop):
            restarted.reserve('analyze', ([], {}))
        self.assertEqual(token, 0)

    def test_actual_usage_replaces_estimate_and_midnight_resets(self):
        token = self.budget.reserve('analyze', ([], {}))
        self.budget.finish(token, 321, True)
        self.assertEqual(self.budget.summary()['accounted_tokens'], 321)
        tomorrow = self.budget.tomorrow()
        self.clock[0] = tomorrow
        self.assertEqual(self.budget.day(), '2026-10-29')
        self.assertEqual(self.budget.summary()['calls'], 0)

    def test_call_limit_and_two_failed_calls_stop_retries(self):
        self.budget.cfg['daily_calls'] = 1
        token = self.budget.reserve('analyze', ([], {}))
        self.budget.finish(token, 1, True)
        with self.assertRaises(BudgetStop):
            self.budget.reserve('analyze', ([], {}))
        self.budget.cfg['daily_calls'] = 4
        self.store.set('ai_usage', [])
        self.clock[0] -= 43200
        for _ in range(2):
            token = self.budget.reserve('analyze', ([], {}))
            self.budget.finish(token, 1, False)
            self.clock[0] += 3601
        with self.assertRaises(BudgetStop):
            self.budget.reserve('analyze', ([], {}))

    def test_keywords_are_reversible_and_exclusion_wins(self):
        articles = [{'id': '1', 'title': 'AI research', 'content': ''},
                    {'id': '2', 'title': 'AI hiring', 'content': ''}]
        self.store.add(articles)
        self.budget.cfg.update(include_terms='AI', exclude_terms='hiring')
        self.assertEqual([a['id'] for a in self.budget.screen(articles)], ['1'])
        self.assertEqual(self.store.counts()['pending_articles'], 2)
        self.budget.cfg['exclude_terms'] = ''
        self.assertEqual(len(self.budget.screen(self.store.pending())), 2)

    def test_batch_fit_does_not_remove_queue_and_hash_ignores_budget(self):
        config = FakeCloud().config()
        articles = [{'id': str(i), 'title': 'AI', 'content': '文' * 10000} for i in range(30)]
        self.store.add(articles)
        selected = self.budget.fit_batch(articles, config)
        self.assertGreater(len(selected), 0)
        self.assertLessEqual(len(selected), 20)
        self.assertEqual(self.store.counts()['pending_articles'], 30)
        changed = copy.deepcopy(config)
        changed['reader_settings'] = [{'daily_budget': 100000}]
        self.assertEqual(config_hash(config), config_hash(changed))

    def test_codex_and_claude_usage_do_not_double_count(self):
        stream = '\n'.join(['[]', 'not-json', json.dumps({'type': 'turn.completed', 'usage': {
            'input_tokens': 100, 'output_tokens': 20, 'reasoning_output_tokens': 10,
            'cached_input_tokens': 50}})])
        self.assertEqual(codex_usage(stream), 120)
        self.assertEqual(claude_usage({'usage': {'input_tokens': 10, 'output_tokens': 20,
            'cache_read_input_tokens': 30, 'cache_creation_input_tokens': 40}}), 100)
        self.assertIsNone(codex_usage(''))
        self.assertIsNone(claude_usage({}))

    def test_pdf_and_binary_html_keep_only_real_search_excerpt(self):
        result = {'url': 'https://example.com/evidence', 'title': 'Source', 'snippet': 'Verified evidence ' * 20}
        for binary in (b'%PDF-1.7\x00garbage', b'<article>text\x00binary</article>'):
            article = retrieve(result, 'owner', lambda _: binary)
            self.assertIn('原頁全文未取得', article['content'])
            self.assertIn('Verified evidence', article['content'])
            self.assertNotIn('\x00', article['content'])
            self.assertNotIn('%PDF-', article['content'])

    def test_transport_removes_actual_nuls_but_preserves_literal_escape(self):
        self.assertEqual(clean_transport({'x': ['a\x00b', r'\u0000']}), {'x': ['ab', r'\u0000']})

    def test_runner_budget_wait_keeps_pending_without_analyzing(self):
        cloud, model = FakeCloud(), FakeCodex()
        cloud.settings['reader_settings'] = [{'daily_budget': 10000}]
        runner = Runner(self.store, cloud, model, lambda _: feed(2), lambda: self.clock[0])
        runner.cycle()
        self.assertEqual(model.calls, 0)
        self.assertEqual(self.store.counts()['pending_articles'], 2)
        self.assertEqual(self.store.get('status')['status'], 'budget_wait')

    def test_manual_only_rejects_even_evidenced_ai_candidates(self):
        cloud, model = FakeCloud(), FakeCodex()
        articles = [{'id': 'article', 'title': 'AI', 'content': 'evidence'}]
        result = model.analyze(articles, cloud.config())
        result['candidates'] = [{'purpose_id': cloud.settings['purposes'][0]['id'],
            'title': 'AI', 'question': 'Follow?', 'evidence_ids': ['article']}]
        with self.assertRaises(ValueError):
            validate_result(result, articles, cloud.config())
