"""Independent regression suite for structured evidence ingestion.
The remote Wikidata API is replaced with controlled sample data in these tests.
"""
import sqlite3
import unittest
from copy import deepcopy
from engine import KnowledgeEngine
from research import EvidenceStore, ResearchError


def item(qid, name, desc='', props=None):
    claims={}
    for p, values in (props or {}).items():
        claims[p]=[{'rank':'normal','id': f'{qid}${p}{i}', 'mainsnak':{
          'snaktype':'value','datavalue':{'value':{
            'entity-type':'item','id':v}}}} for i,v in enumerate(values)]
    return {'id':qid,'labels':{'en':{'value':name}}, 'descriptions':{'en':{'value':desc}}, 'claims':claims}

class StubClient:
    def __init__(self):
        self.data={
            'Q10':item('Q10','cheetah','a large cat',{'P171':['Q11']}),
            'Q11':item('Q11','Acinonyx','a genus',{'P171':['Q12']}),
            'Q12':item('Q12','felid','a family',{'P171':['Q13']}),
            'Q13':item('Q13','mammal','class of vertebrates',{'P279':['Q14']}),
            'Q14':item('Q14','animal','multicellular organisms'),
            'Q20':item('Q20','France','European country',{'P36':['Q21']}),
            'Q21':item('Q21','Paris','French city'),
            'Q22':item('Q22','Lyon','city'),
            'Q30':item('Q30','Mercury','planet'),
            'Q31':item('Q31','Mercury','chemical element'),
            'Q40':item('Q40','latte','coffee-based drink',{'P31':['Q41']}),
            'Q41':item('Q41','beverage','drink'),
        }
    def entities(self, ids):return {id:deepcopy(self.data[id]) for id in ids if id in self.data}
    def search(self, term):
        return [{'id':k,'label':v['labels']['en']['value'], 'description':v['descriptions']['en']['value']}
                for k,v in self.data.items() if term.lower() in v['labels']['en']['value'].lower()][:5]

class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.eng=KnowledgeEngine()
        self.client=StubClient()
        self.layer=EvidenceStore(self.eng.conn,self.client)
    def tearDown(self):self.eng.close()

    def test_opt_in_auto_research(self):
        detail=self.layer.suggest_auto_research('What is the capital of France?')
        self.assertTrue(detail['learned'])
        self.assertIn('Paris',self.layer.ask('What is the capital of France?')['answer'])

    def test_opt_in_auto_research_ambiguous(self):
        detail=self.layer.suggest_auto_research('What is Mercury?')
        self.assertFalse(detail['learned'])
        self.assertEqual(detail['reason'],'ambiguous')
        self.assertEqual(self.layer.claim_count(),0)

    def test_search_disambiguates(self):
        r=self.layer.search('Mercury')
        self.assertEqual(len(r['candidates']),2)

    def test_multi_hop_from_unseen_question(self):
        self.assertIsNone(self.layer.ask('Is a cheetah a mammal?'))
        r=self.layer.learn('Q10')
        self.assertGreaterEqual(r['claims_loaded'],4)
        answer=self.layer.ask('Is a cheetah a mammal?')
        self.assertEqual(answer['status'],'yes')
        self.assertEqual(len(answer['proof']),3)
        self.assertTrue(all(p['url'].startswith('https://www.wikidata.org/wiki/') for p in answer['proof']))

    def test_no_false_negative_if_no_path(self):
        self.layer.learn('Q10')
        r=self.layer.ask('Is a cheetah a planet?')
        self.assertEqual(r['status'],'unknown')

    def test_relation_answer(self):
        self.layer.learn('Q20')
        r=self.layer.ask('What is the capital of France?')
        self.assertEqual(r['status'],'yes')
        self.assertIn('Paris',r['answer'])
        self.assertEqual(r['proof'][0]['url'], 'https://www.wikidata.org/wiki/Q20#P36')

    def test_updated_evidence_invalidates_old_conclusion(self):
        self.layer.learn('Q20')
        self.client.data['Q20'] = item('Q20','France','European country', {'P36':['Q22']})
        self.layer.learn('Q20')
        r=self.layer.ask('What is the capital of France?')
        self.assertIn('Lyon', r['answer'])
        self.assertNotIn('Paris', r['answer'])

    def test_ambiguous_name_refuses_guess(self):
        self.layer.learn('Q30'); self.layer.learn('Q31')
        r=self.layer.ask('What is Mercury?')
        self.assertEqual(r['status'],'unknown')
        self.assertIn('Ambiguous', r['answer'])

    def test_source_not_called_verified(self):
        self.layer.learn('Q20')
        r=self.layer.ask('What is the capital of France?')
        self.assertEqual(r['evidence_quality'],'sourced_not_independently_verified')

    def test_direct_conflict_review(self):
        self.layer.learn('Q10')
        self.eng.teach('A cheetah is not an Acinonyx')
        issues=self.layer.review()['direct_conflicts']
        self.assertTrue(any(q['subject']=='cheetah' for q in issues) is False) # taxon_parent is not is_a
        # direct Wikidata is_a contradiction
        self.layer.learn('Q40')
        taught=self.eng.teach('A latte is not a beverage')
        self.assertTrue(taught['ok'])
        issues=self.layer.review()['direct_conflicts']
        self.assertEqual(len(issues),1)

    def test_reset_removes_derived_conclusions(self):
        self.layer.learn('Q10')
        self.assertEqual(self.layer.ask('Is a cheetah a mammal?')['status'],'yes')
        self.layer.reset()
        self.assertIsNone(self.layer.ask('Is a cheetah a mammal?'))

    def test_invalid_qid_cannot_control_url(self):
        with self.assertRaises(ResearchError):self.layer.learn('http://attacker.invalid')

    def test_no_search_as_truth(self):
        self.assertEqual(len(self.layer.search('Mercury')['candidates']),2)
        self.assertEqual(self.layer.claim_count(),0)

if __name__=='__main__': unittest.main()
