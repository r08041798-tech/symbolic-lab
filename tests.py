"""Tests are intentionally separate from the application UI."""
import os
import tempfile
import unittest
from engine import KnowledgeEngine, run_evaluation

class SymbolicEngineTests(unittest.TestCase):
    def setUp(self):
        self.e = KnowledgeEngine()

    def tearDown(self):
        self.e.close()

    def test_reference_suite(self):
        evaluation = run_evaluation(self.e)
        self.assertEqual((evaluation['passed'], evaluation['total']), (28,28),
                         [c for c in evaluation['checks'] if not c['pass']])

    def test_can_infer_unseen_question_after_teaching(self):
        self.assertEqual(self.e.query('Is a robin an animal?')['status'],'unknown')
        self.assertTrue(self.e.teach('A robin is a bird')['ok'])
        result = self.e.query('Is a robin an animal?')
        self.assertEqual(result['status'],'yes')
        self.assertEqual(len(result['proof']),2)
        self.assertEqual(result['proof'][0]['source'],'user asserted')

    def test_no_answer_without_proof(self):
        self.assertEqual(self.e.query('Can a dragon fly?')['status'],'unknown')
        self.assertEqual(self.e.query('Is a whale a fruit?')['status'],'unknown')

    def test_explicit_negative_and_counterexample(self):
        self.assertEqual(self.e.query('Can a penguin fly?')['status'],'no')
        self.assertEqual(self.e.query('Are all birds penguins?')['status'],'no')

    def test_direct_contradiction_rejected(self):
        self.assertTrue(self.e.teach('A robin can fly')['ok'])
        result = self.e.teach('A robin cannot fly')
        self.assertFalse(result['ok'])
        self.assertEqual(self.e.query('Can a robin fly?')['status'],'yes')

    def test_duplicate_fact_does_not_grow_kb(self):
        old = self.e.count()
        r=self.e.teach('A whale is a mammal')
        self.assertTrue(r['ok'])
        self.assertFalse(r['added'])
        self.assertEqual(self.e.count(),old)

    def test_teach_alias(self):
        self.assertEqual(self.e.query('Can little bird fly?')['status'],'unknown')
        self.assertTrue(self.e.add_alias('little bird','sparrow')['ok'])
        self.assertEqual(self.e.query('Can little bird fly?')['status'],'yes')

    def test_unsupported_question(self):
        self.assertEqual(self.e.query('Where do penguins live?')['status'],'unsupported')

    def test_creative_templating_has_provenance(self):
        result=self.e.query('Write about rain and hope')
        self.assertEqual(result['status'],'creative')
        self.assertIn('rain',result['answer'].lower())
        self.assertIn('hope',result['answer'].lower())
        self.assertGreaterEqual(len(result['proof']),2)

    def test_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=os.path.join(tmp,'knowledge.sqlite3')
            e=KnowledgeEngine(p)
            self.assertTrue(e.teach('A turtle is a reptile')['ok'])
            e.close()
            e2=KnowledgeEngine(p)
            self.assertEqual(e2.query('Is a turtle a reptile?')['status'],'yes')
            e2.close()

    def test_reset(self):
        self.e.teach('A robin is a bird')
        self.e.add_alias('tiny bird','sparrow')
        self.assertEqual(self.e.count(),21)
        self.e.reset()
        self.assertEqual(self.e.count(),20)
        self.assertFalse(self.e.aliases())
        self.assertEqual(self.e.query('Is robin a bird?')['status'],'unknown')

if __name__=='__main__':
    unittest.main()
