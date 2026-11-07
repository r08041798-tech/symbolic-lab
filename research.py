"""Evidence-backed symbolic research over a small, explicit Wikidata property schema.

NO trained models and NO AI APIs. All externally retrieved information is
community-maintained *source evidence*, not independently verified truth.
The module intentionally does not scrape arbitrary pages or interpret prose.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from engine import canonical

API = 'https://www.wikidata.org/w/api.php'
USER_AGENT = 'SymbolicLab/0.2 (https://github.com/r08041798-tech/symbolic-lab) Python-urllib'
QID_PATTERN = re.compile(r'^Q[1-9]\d{0,11}$')
# Domain-specific mapping: not arbitrary natural-language web extraction.
PROPERTIES = {
    'P31': ('is_a', 'instance of'),
    'P279': ('is_a', 'subclass of'),
    'P171': ('taxon_parent', 'parent taxon'),
    'P17': ('country', 'country'),
    'P131': ('located_in', 'located in'),
    'P36': ('capital', 'capital'),
    'P30': ('continent', 'continent'),
    'P361': ('part_of', 'part of'),
    'P287': ('designer', 'designed by'),
    'P170': ('creator', 'created by'),
    'P112': ('founder', 'founded by'),
    'P178': ('developer', 'developed by'),
    'P176': ('manufacturer', 'manufactured by'),
    'P106': ('occupation', 'occupation'),
    'P37': ('official_language', 'official language'),
    'P495': ('origin', 'country of origin'),
    'P105': ('taxon_rank', 'taxon rank'),
    'P159': ('headquarters', 'headquarters'),
    'P19': ('birthplace', 'place of birth'),
    'P569': ('born_on', 'date of birth'),
    'P571': ('inception', 'inception'),
}
HIERARCHY = {'is_a', 'taxon_parent'}

class ResearchError(Exception):
    pass


class WikidataClient:
    """Small authenticated-free public API client with bounded requests, timeouts and no URL injection."""

    def _request(self, params: dict) -> dict:
        args = dict(action=params.pop('action'), format='json', formatversion=2, **params)
        url = API + '?' + urlencode(args)
        req = Request(url, headers={
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
        })
        try:
            with urlopen(req, timeout=7) as response:
                if int(response.headers.get('Content-Length', '0')) > 3_000_000:
                    raise ResearchError('Knowledge response too large.')
                raw = response.read(3_000_001)
                if len(raw) > 3_000_000:
                    raise ResearchError('Knowledge response exceeded safe size.')
                data = json.loads(raw)
                if 'error' in data:
                    raise ResearchError('Knowledge provider declined the request.')
                return data
        except HTTPError as exc:
            if exc.code == 429:
                raise ResearchError('Wikidata rate limit reached. Please try again later.') from exc
            raise ResearchError(f'Knowledge provider returned HTTP {exc.code}.') from exc
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            raise ResearchError('Could not reach Wikidata or parse its response.') from exc

    def search(self, term: str) -> list[dict]:
        data = self._request({'action':'wbsearchentities', 'search':term, 'language':'en', 'limit':5, 'type':'item'})
        return [dict(id=r.get('id'), label=r.get('label', ''), description=r.get('description', ''))
                for r in data.get('search', []) if QID_PATTERN.fullmatch(r.get('id', ''))]

    def entities(self, qids: list[str]) -> dict:
        if not qids or len(qids) > 30 or any(not QID_PATTERN.fullmatch(q) for q in qids):
            raise ResearchError('Invalid entity selection.')
        data = self._request({'action':'wbgetentities', 'ids':'|'.join(qids), 'props':'labels|descriptions|claims', 'languages':'en', 'languagefallback':1})
        return {q: v for q, v in data.get('entities', {}).items() if QID_PATTERN.fullmatch(q) and not v.get('missing')}


def _extract_claims(entity: dict, subject_qid: str):
    """Extract ONLY explicitly mapped structured entity values (no inferred prose)."""
    for prop, statements in entity.get('claims', {}).items():
        if prop not in PROPERTIES:
            continue
        relation = PROPERTIES[prop][0]
        for entry in statements[:6]:
            if entry.get('rank') == 'deprecated':
                continue
            snak = entry.get('mainsnak', {})
            if snak.get('snaktype') != 'value':
                continue
            val = snak.get('datavalue', {}).get('value')
            if isinstance(val, dict) and val.get('entity-type') == 'item':
                obj = val.get('id') or ('Q' + str(val.get('numeric-id', '')))
                if QID_PATTERN.fullmatch(obj):
                    yield (subject_qid, prop, relation, obj, None, str(entry.get('id', f'{subject_qid}${prop}:{obj}'))[:200])
            elif prop in ('P569', 'P571') and isinstance(val, dict) and isinstance(val.get('time'), str):
                # Keep the provided date prefix, without treating time precision as certain.
                date = val['time'].lstrip('+').split('T')[0]
                if re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                    yield (subject_qid, prop, relation, None, date, str(entry.get('id', f'{subject_qid}${prop}:{date}'))[:200])


def _display_name(entity: dict, qid: str):
    return entity.get('labels', {}).get('en', {}).get('value', qid)[:160]


def _display_description(entity: dict):
    return entity.get('descriptions', {}).get('en', {}).get('value', '')[:400]


class EvidenceStore:
    """Session-scoped structured evidence. Derived answers are NOT persisted or memorised."""

    def __init__(self, connection: sqlite3.Connection, client=None):
        self.conn = connection
        self.client = client if client is not None else WikidataClient()
        self.conn.executescript('''
          CREATE TABLE IF NOT EXISTS research_entities(
            qid TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL,
            fetched_at TEXT NOT NULL, researched INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS research_claims(
            statement_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, property TEXT NOT NULL,
            relation TEXT NOT NULL, target_id TEXT, literal TEXT,
            source_url TEXT NOT NULL, fetched_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS research_claims_from ON research_claims(subject_id, relation);
        ''')
        self.conn.commit()

    def search(self, query: str) -> dict:
        query = query.strip()
        if not (2 <= len(query) <= 90) or any(c in query for c in '\n\r\t'):
            raise ResearchError('Enter a topic between 2 and 90 characters.')
        results = self.client.search(query)
        return {'ok':True, 'candidates':results, 'message':'Choose the matching Wikidata entity. Similar names can refer to very different things.'}

    def learn(self, qid: str, *, levels=4, max_entities=45) -> dict:
        """Fetch a selected QID and bounded upward category/taxon edges.

        Existing statements from re-fetched entities are REPLACED, so later
        questions can stop using changed claims (truth-maintenance by recomputation).
        """
        if not isinstance(qid, str) or not QID_PATTERN.fullmatch(qid):
            raise ResearchError('Select a valid QID from the search results.')
        visited = set()
        pending = [qid]
        fetched = {}
        for level in range(levels + 1):
            batch = [x for x in pending if x not in visited][:20]
            if not batch or len(visited) + len(batch) > max_entities:
                break
            visited.update(batch)
            current = self.client.entities(batch)
            fetched.update(current)
            next_ids = []
            if level < levels:
                for eid, entity in current.items():
                    for src, prop, rel, obj, literal, sid in _extract_claims(entity, eid):
                        if rel in HIERARCHY and obj and obj not in visited and obj not in next_ids:
                            next_ids.append(obj)
            pending = next_ids
        if qid not in fetched:
            raise ResearchError('Selected entity is not available in Wikidata.')

        edges = []
        targets = set()
        for eid, entity in fetched.items():
            for src, prop, rel, obj, literal, sid in _extract_claims(entity, eid):
                # non-hierarchy properties are collected only for the user's topic;
                # hierarchy claims are gathered for all traversed ancestors.
                if rel not in HIERARCHY and eid != qid:
                    continue
                edges.append((src, prop, rel, obj, literal, sid))
                if obj and obj not in fetched:
                    targets.add(obj)
        # Pull labels for otherwise unexpanded property values, within strict cap.
        additional = list(sorted(targets))[:30]
        labels_only = self.client.entities(additional) if additional else {}
        all_entities = dict(labels_only, **fetched)
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with self.conn:
            for eid, entity in all_entities.items():
                self.conn.execute('''INSERT INTO research_entities(qid,label,description,fetched_at,researched)
                    VALUES(?,?,?,?,?) ON CONFLICT(qid) DO UPDATE SET
                    label=excluded.label, description=excluded.description,
                    fetched_at=excluded.fetched_at,
                    researched=MAX(research_entities.researched,excluded.researched)''',
                    (eid, _display_name(entity,eid), _display_description(entity), now, int(eid==qid)))
            for eid in fetched:
                # Don't erase claims belonging to other previously researched topics.
                self.conn.execute('DELETE FROM research_claims WHERE subject_id=?', (eid,))
            for src, prop, rel, obj, literal, sid in edges:
                self.conn.execute('''INSERT OR REPLACE INTO research_claims
                    (statement_id,subject_id,property,relation,target_id,literal,source_url,fetched_at)
                    VALUES(?,?,?,?,?,?,?,?)''',
                    (sid, src, prop, rel, obj, literal,
                     f'https://www.wikidata.org/wiki/{src}#{prop}', now))
        e=self.conn.execute('SELECT label,description FROM research_entities WHERE qid=?',(qid,)).fetchone()
        return {'ok':True,'qid':qid,'label':e['label'],'description':e['description'],
                'entities_loaded':len(all_entities),'claims_loaded':len(edges),
                'total_claims':self.claim_count(),'fetched_at':now,
                'message':'Imported structured Wikidata claims with provenance. Sourced does not mean independently verified.'}

    def claim_count(self):
        return self.conn.execute('SELECT COUNT(*) FROM research_claims').fetchone()[0]

    def topics(self):
        return [dict(r) for r in self.conn.execute(
            'SELECT qid,label,description,fetched_at FROM research_entities WHERE researched=1 ORDER BY fetched_at DESC, label LIMIT 30')]

    def review(self) -> dict:
        """Explicitly test negative local assertions against positive sourced edges.
        Note: this is a limited conflict detector, not general fact checking.
        """
        rows = list(self.conn.execute('''SELECT a.label subject, c.relation relation,
            b.label object, c.source_url, c.fetched_at
            FROM research_claims c JOIN research_entities a ON a.qid=c.subject_id
            JOIN research_entities b ON b.qid=c.target_id WHERE c.relation='is_a' '''))
        conflicts=[]
        for r in rows:
            l=self.conn.execute('''SELECT source FROM facts WHERE subject=? AND relation='is_a'
                        AND object=? AND polarity=-1''',(canonical(r['subject']),canonical(r['object']))).fetchone()
            if l:
                conflicts.append({'subject':r['subject'],'object':r['object'], 'source_url':r['source_url'],
                                  'reason':'A user-provided negative claim opposes this Wikidata assertion.'})
        return {'sourced_claims':self.claim_count(), 'researched_topics':len(self.topics()),
                'direct_conflicts':conflicts[:20],
                'caution':'This only identifies direct conflicts. It cannot independently certify truth or check every indirect contradiction.'}

    def reset(self):
        with self.conn:
            self.conn.execute('DELETE FROM research_claims')
            self.conn.execute('DELETE FROM research_entities')
        return {'ok':True, 'message':'Research knowledge erased for this session.'}

    def _matches(self, term: str):
        term=canonical(term.strip())
        return [dict(r) for r in self.conn.execute('SELECT qid,label,description FROM research_entities')
                if canonical(r['label']) == term]

    def _node(self, qid):
        r=self.conn.execute('SELECT qid,label,description FROM research_entities WHERE qid=?',(qid,)).fetchone()
        return dict(r) if r else {'qid':qid,'label':qid,'description':''}

    def _proof(self, row):
        subject=self._node(row['subject_id'])['label']
        obj=self._node(row['target_id'])['label'] if row['target_id'] else row['literal']
        verb=PROPERTIES.get(row['property'],(row['relation'], row['relation']))[1]
        return {'fact':f'{subject} — {verb} → {obj}', 'source':'Wikidata, community-edited (not independently verified)',
                'url':row['source_url'], 'retrieved_at':row['fetched_at']}

    def _result(self,status,answer,proof=None, intent='research'):
        return {'status':status, 'answer':answer,'proof':proof or [],'fact_count':self.claim_count(),
                'intent':intent, 'evidence_quality':'sourced_not_independently_verified'}

    def _get_rel(self, qid: str, relation: str):
        return list(self.conn.execute('SELECT * FROM research_claims WHERE subject_id=? AND relation=?', (qid, relation)))

    def _hierarchy_path(self, start: str, goal: str):
        if start==goal: return []
        paths=deque([(start,[])])
        seen={start}
        while paths:
            node, trail=paths.popleft()
            if len(trail)>=12: continue
            for row in self.conn.execute('SELECT * FROM research_claims WHERE subject_id=? AND relation IN (\'is_a\',\'taxon_parent\')', (node,)):
                target=row['target_id']
                if not target or target in seen: continue
                updated=trail+[row]
                if target==goal: return updated
                seen.add(target);paths.append((target,updated))
        return None

    def _subject(self, term: str):
        found=self._matches(term)
        if len(found)>1:
            return None, f'Ambiguous entity: {term}. Research the specific entity and use its QID to distinguish meanings.'
        if not found:
            return None, f'I have not researched “{term}”. Use the Research tab and choose the correct entity first.'
        return found[0], None

    def suggest_auto_research(self, question: str):
        """Optional exact-name research only. Never silently select ambiguous names.

        Returns a dictionary describing the action, or None for unsupported
        question forms or already-known topics. A UI consent flag gates use.
        """
        raw = re.sub(r'[?!.]+$', '', question.strip().lower())
        raw = re.sub(r'\s+', ' ', raw)
        patterns = [
            (r'^what is the (?:capital|country|continent|official language|occupation|manufacturer|country of origin) of (.+)$',1),
            (r'^what is the capital city of (.+)$',1),
            (r'^what country is (.+) in$',1),
            (r'^where is (.+) located$',1),
            (r'^who (?:created|designed|founded|developed|manufactured) (.+)$',1),
            (r'^when was (.+) (?:founded|established|created)$',1),
            (r'^is (.+?) (?:an?|the) (.+)$',1),
            (r'^what is (.+)$',1),
            (r'^tell me about (.+)$',1),
        ]
        term = None
        for pattern,group in patterns:
            match=re.fullmatch(pattern,raw)
            if match:term=match.group(group);break
        if not term or len(term)>90 or len(term)<2:
            return None
        if self._matches(term):
            return None
        found=self.search(term)['candidates']
        exact=[c for c in found if canonical(c['label']) == canonical(term)]
        if len(exact) != 1:
            return {'learned':False,'reason':'ambiguous' if len(exact)>1 else 'no_exact_match',
                    'candidates':found,'topic':term}
        learned=self.learn(exact[0]['id'])
        return {'learned':True,'topic':term,'entity':learned['label'],'qid':exact[0]['id']}

    def ask(self, question: str):
        """Return None if this is a legacy-only question; never send a prompt to an AI API."""
        s=re.sub(r'[?!.]+$','',question.strip().lower())
        s=re.sub(r'\s+',' ',s)
        if not s or len(s)>500: return None
        relation=None; subject=None; object_term=None; kind='property'
        patterns=[
            (r'^what is the (capital|country|continent|official language|occupation|manufacturer|country of origin) of (.+)$',None),
            (r'^what is the capital city of (.+)$','capital'),
            (r'^what country is (.+) in$','country'),
            (r'^where is (.+) located$','located_in'),
            (r'^who (?:created|designed|founded|developed|manufactured) (.+)$', 'who'),
            (r'^when was (.+) (?:founded|established|created)$','inception'),
            (r'^is (.+?) (?:an?|the) (.+)$','is_a'),
            (r'^what is (.+)$','description'),
            (r'^tell me about (.+)$','description'),
        ]
        for pattern, key in patterns:
            m=re.fullmatch(pattern,s)
            if not m:continue
            if key is None:
                term, subject=m.groups()
                relation={'official language':'official_language','country of origin':'origin'}.get(term,term.replace(' ','_'))
            elif key == 'who':
                subject=m.group(1)
                verb=m.group(0).split()[1]
                relation={'created':'creator','designed':'designer','founded':'founder','developed':'developer','manufactured':'manufacturer'}[verb]
            elif key=='is_a':
                subject,object_term=m.groups()
                kind='classification'
            elif key=='description':
                subject=m.group(1);kind='description'
            else:
                subject=m.group(1);relation=key
            break
        if not subject: return None
        sub, err=self._subject(subject)
        if err:
            # For legacy seeded facts, leave simple descriptions and classifications to the old engine.
            if kind in ('description','classification') and not self._matches(subject):
                return None
            return self._result('unknown',err)
        qid=sub['qid']
        if kind=='classification':
            obj,oe=self._subject(object_term)
            if oe: return self._result('unknown',oe)
            chain=self._hierarchy_path(qid,obj['qid'])
            if chain is None:
                return self._result('unknown', f'No sourced hierarchy path currently establishes whether {sub["label"]} is a {obj["label"]}. This is not evidence that it is false.')
            proof=[self._proof(row) for row in chain]
            return self._result('yes',f'According to the imported structured evidence, {sub["label"]} is within the {obj["label"]} hierarchy ({len(chain)} step(s)).',proof)
        if kind=='description':
            details=[]
            for r in self.conn.execute('SELECT * FROM research_claims WHERE subject_id=? LIMIT 6',(qid,)):
                details.append(self._proof(r))
            content=sub['description'] or 'No English Wikidata description is stored.'
            return self._result('yes',f'{sub["label"]}: {content} (Wikidata description, not independently fact checked.)',details)
        rows=self._get_rel(qid,relation)
        # Prefer direct country; if only located_in exists, do not infer country without explicit chain.
        if not rows:
            return self._result('unknown',f'No imported Wikidata claim establishes {relation.replace("_"," ")} for {sub["label"]}.')
        objs=[self._node(r['target_id'])['label'] if r['target_id'] else r['literal'] for r in rows]
        proof=[self._proof(row) for row in rows[:6]]
        return self._result('yes',f'According to Wikidata, {sub["label"]} — {relation.replace("_"," ")}: {", ".join(objs[:6])}.',proof)
