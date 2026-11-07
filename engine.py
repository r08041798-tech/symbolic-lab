"""Small, explainable symbolic language engine. No ML models or external APIs.

Supported knowledge is intentionally constrained: categorical IS_A, CAN, HAS,
NEEDS, CAUSES and their explicit negations. It uses open-world reasoning:
lack of proof is UNKNOWN, not FALSE.
"""
from __future__ import annotations

import re
import sqlite3
from collections import deque
from dataclasses import dataclass
from typing import Optional

SEED = [
    ("penguin", "is_a", "bird", 1),
    ("bird", "is_a", "animal", 1),
    ("animal", "is_a", "living thing", 1),
    ("penguin", "can", "fly", -1),
    ("sparrow", "is_a", "bird", 1),
    ("sparrow", "can", "fly", 1),
    ("sparrow", "is_a", "penguin", -1),
    ("mango", "is_a", "fruit", 1),
    ("fruit", "is_a", "plant product", 1),
    ("alphonso", "is_a", "mango", 1),
    ("plant", "needs", "water", 1),
    ("plant", "needs", "sunlight", 1),
    ("rain", "causes", "soil to become wet", 1),
    ("rain", "helps", "plants grow", 1),
    ("hope", "helps", "people persevere", 1),
    ("whale", "is_a", "mammal", 1),
    ("mammal", "is_a", "animal", 1),
    ("whale", "can", "breathe underwater", -1),
    ("dolphin", "is_a", "mammal", 1),
    ("fish", "is_a", "animal", 1),
]

STOP = {"a", "an", "the"}
REL_DISPLAY = {"is_a": "is a", "can": "can", "has": "has", "needs": "needs", "causes": "causes", "helps": "helps"}


def canonical(text: str) -> str:
    text = re.sub(r"[^\w\s'-]", " ", text.lower()).strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"^(?:a|an|the)\s+", "", text)
    # Conservative singularisation of very common simple plurals; not universal NLP.
    words = text.split(" ")
    if len(words) == 1 and text.endswith("s") and not text.endswith(("ss", "us", "is")) and len(text) > 3:
        return text[:-1]
    return text


def nice(text: str) -> str:
    return text[:1].upper() + text[1:]


def article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


@dataclass(frozen=True)
class Fact:
    id: int
    subject: str
    relation: str
    obj: str
    polarity: int
    source: str

    def sentence(self) -> str:
        if self.relation == "is_a":
            return f"{nice(self.subject)} is {article(self.obj)} {self.obj}." if self.polarity > 0 else f"{nice(self.subject)} is not {article(self.obj)} {self.obj}."
        verb = REL_DISPLAY[self.relation]
        neg_verb = {"can": "cannot", "has": "does not have", "needs": "does not need", "causes": "does not cause", "helps": "does not help"}
        return f"{nice(self.subject)} {verb} {self.obj}." if self.polarity > 0 else f"{nice(self.subject)} {neg_verb[self.relation]} {self.obj}."


class KnowledgeEngine:
    def __init__(self, db_path: str = ":memory:", seed: bool = True):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("""CREATE TABLE IF NOT EXISTS facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL, relation TEXT NOT NULL,
            object TEXT NOT NULL, polarity INTEGER NOT NULL CHECK (polarity IN (-1, 1)),
            source TEXT NOT NULL,
            UNIQUE(subject, relation, object, polarity)
        )""")
        self.conn.execute("""CREATE TABLE IF NOT EXISTS aliases (
            phrase TEXT PRIMARY KEY, canonical_phrase TEXT NOT NULL
        )""")
        self.conn.commit()
        if seed and self.count() == 0:
            for sub, rel, obj, pol in SEED:
                self.add_fact(sub, rel, obj, pol, "curated sample")

    def close(self):
        self.conn.close()

    def count(self):
        return self.conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]

    def facts(self) -> list[Fact]:
        return [Fact(r['id'], r['subject'], r['relation'], r['object'], r['polarity'], r['source']) for r in self.conn.execute("SELECT * FROM facts ORDER BY id")]

    def aliases(self):
        return {r['phrase']: r['canonical_phrase'] for r in self.conn.execute("SELECT * FROM aliases ORDER BY phrase")}

    def normalize(self, term: str) -> str:
        term = canonical(term)
        aliases = self.aliases()
        visited = set()
        while term in aliases and term not in visited:
            visited.add(term)
            term = aliases[term]
        return term

    def add_alias(self, phrase: str, target: str) -> dict:
        phrase, target = canonical(phrase), self.normalize(target)
        if not phrase or not target or phrase == target:
            return {"ok": False, "message": "Provide two different nonempty phrases."}
        if len(phrase) > 100 or len(target) > 100:
            return {"ok": False, "message": "Phrase too long."}
        self.conn.execute("INSERT INTO aliases (phrase, canonical_phrase) VALUES (?, ?) ON CONFLICT(phrase) DO UPDATE SET canonical_phrase=excluded.canonical_phrase", (phrase, target))
        self.conn.commit()
        return {"ok": True, "message": f"Learned that '{phrase}' refers to '{target}'. This alias is user-provided, not independently validated."}

    def add_fact(self, sub: str, rel: str, obj: str, polarity: int = 1, source: str = "user asserted") -> dict:
        sub, obj = self.normalize(sub), self.normalize(obj)
        if rel not in REL_DISPLAY or not sub or not obj or len(sub) > 160 or len(obj) > 160:
            return {"ok": False, "message": "Invalid fact."}
        if sub == obj and rel == "is_a" and polarity < 0:
            return {"ok": False, "message": "A concept cannot be explicitly not itself."}
        opposite = self.conn.execute("SELECT id FROM facts WHERE subject=? AND relation=? AND object=? AND polarity=?", (sub, rel, obj, -polarity)).fetchone()
        if opposite:
            return {"ok": False, "message": "Conflict: the opposite claim already exists. Nothing was overwritten."}
        cur = self.conn.execute("INSERT OR IGNORE INTO facts (subject, relation, object, polarity, source) VALUES (?, ?, ?, ?, ?)", (sub, rel, obj, polarity, source))
        self.conn.commit()
        return {"ok": True, "added": cur.rowcount > 0, "message": "New claim stored (user asserted; not independently verified)." if cur.rowcount > 0 else "Already known."}

    def parse_fact(self, text: str) -> Optional[tuple[str, str, str, int]]:
        s = re.sub(r"[.!?]+$", "", text.strip().lower())
        s = re.sub(r"\s+", " ", s)
        # A/B singular, and basic quantified categories: all birds are animals.
        for pattern, relation, polarity in [
            (r"^(?:all\s+)?(.+?)\s+(?:is|are)\s+not\s+(?:a|an|the)?\s*(.+)$", "is_a", -1),
            (r"^(?:all\s+)?(.+?)\s+(?:is|are)\s+(?:a|an|the)?\s*(.+)$", "is_a", 1),
            (r"^(.+?)\s+cannot\s+(.+)$", "can", -1),
            (r"^(.+?)\s+can\s+(.+)$", "can", 1),
            (r"^(.+?)\s+(?:does\s+not\s+have)\s+(.+)$", "has", -1),
            (r"^(.+?)\s+(?:has|have)\s+(.+)$", "has", 1),
            (r"^(.+?)\s+(?:does\s+not\s+need)\s+(.+)$", "needs", -1),
            (r"^(.+?)\s+(?:needs|need)\s+(.+)$", "needs", 1),
            (r"^(.+?)\s+(?:causes|cause)\s+(.+)$", "causes", 1),
            (r"^(.+?)\s+(?:helps|help)\s+(.+)$", "helps", 1),
        ]:
            m = re.match(pattern, s)
            if m:
                a, b = m.groups()
                # Reject likely malformed claims / nested language.
                if len(a) > 160 or len(b) > 160 or not a.strip() or not b.strip():
                    return None
                return self.normalize(a), relation, self.normalize(b), polarity
        return None

    def teach(self, statement: str) -> dict:
        if not statement.strip() or len(statement) > 400:
            return {"ok": False, "message": "Write one short factual statement (up to 400 characters)."}
        parsed = self.parse_fact(statement)
        if not parsed:
            return {"ok": False, "message": "I couldn't parse that claim. Try 'A robin is a bird', 'A robin can fly', or 'All mammals are animals'."}
        sub, rel, obj, pol = parsed
        response = self.add_fact(sub, rel, obj, pol)
        response["parsed"] = {"subject": sub, "relation": rel, "object": obj, "polarity": pol}
        return response

    def _path(self, start: str, goal: str, positive: bool = True):
        """Returns shortest IS_A chain (proof edges) or None."""
        if start == goal and positive:
            return []
        edges: dict[str, list[Fact]] = {}
        for fact in self.facts():
            if fact.relation == "is_a" and fact.polarity == 1:
                edges.setdefault(fact.subject, []).append(fact)
        queue = deque([(start, [])])
        seen = {start}
        while queue:
            node, trail = queue.popleft()
            for f in edges.get(node, []):
                if f.obj == goal:
                    return trail + [f]
                if f.obj not in seen:
                    seen.add(f.obj)
                    queue.append((f.obj, trail + [f]))
        return None

    def _ancestors(self, start: str):
        """Includes self with its proof path."""
        paths = {start: []}
        q = deque([start])
        edges: dict[str, list[Fact]] = {}
        for f in self.facts():
            if f.relation == "is_a" and f.polarity == 1:
                edges.setdefault(f.subject, []).append(f)
        while q:
            n = q.popleft()
            for f in edges.get(n, []):
                if f.obj not in paths:
                    paths[f.obj] = paths[n] + [f]
                    q.append(f.obj)
        return paths

    def prove(self, sub: str, rel: str, obj: str):
        sub, obj = self.normalize(sub), self.normalize(obj)
        facts = self.facts()
        paths = self._ancestors(sub)
        positives, negatives = [], []
        if rel == "is_a":
            chain = self._path(sub, obj)
            if chain is not None:
                positives.append(chain)
            # Negative category inheritance: if a superclass explicitly is not B,
            # its subclasses are not B either.
            for ancestor, chain in paths.items():
                for f in facts:
                    if f.subject == ancestor and f.relation == "is_a" and f.obj == obj and f.polarity < 0:
                        negatives.append(chain + [f])
        else:
            for ancestor, chain in paths.items():
                for f in facts:
                    if f.subject == ancestor and f.relation == rel and f.obj == obj:
                        (positives if f.polarity > 0 else negatives).append(chain + [f])
        if positives and negatives:
            return "conflict", min(positives, key=len) + min(negatives, key=len)
        if positives:
            return "yes", min(positives, key=len)
        if negatives:
            return "no", min(negatives, key=len)
        return "unknown", []

    def result(self, status: str, answer: str, trace: list[Fact] | None = None, intent="query") -> dict:
        trace = trace or []
        return {"status": status, "answer": answer, "intent": intent,
                "proof": [{"id": f.id, "fact": f.sentence(), "source": f.source} for f in trace],
                "fact_count": self.count()}

    def _split_subject_action(self, text: str) -> tuple[str, str]:
        """Split 'little bird fly' using known entities/aliases, not shortest regex."""
        text = re.sub(r"^(?:a|an|the)\s+", "", text.strip())
        words = text.split()
        known = {f.subject for f in self.facts()} | {f.obj for f in self.facts()} | set(self.aliases())
        for cut in range(len(words) - 1, 0, -1):
            left, right = ' '.join(words[:cut]), ' '.join(words[cut:])
            if self.normalize(left) in known or canonical(left) in known:
                return self.normalize(left), self.normalize(right)
        return (self.normalize(words[0]), self.normalize(' '.join(words[1:]))) if len(words) > 1 else (self.normalize(text), '')

    def query(self, prompt: str) -> dict:
        if not prompt.strip():
            return self.result("unknown", "Ask a question to get started.")
        if len(prompt) > 500:
            return self.result("unsupported", "Please keep questions under 500 characters.")
        s = re.sub(r"[?!.]+$", "", prompt.strip().lower())
        s = re.sub(r"\s+", " ", s)
        if re.match(r"^(?:write|create|compose)\b", s):
            return self._creative(s)
        # Compound or unsupported inputs must not receive a guessed answer.
        if " and " in s and s.startswith(("is ", "are ", "can ", "does ", "do ")):
            return self.result("unsupported", "I can currently reason about one claim at a time. Please split the question.")
        m = re.match(r"^(?:is|are)\s+(?:all\s+)?(.+?)\s+(?:a|an|the)\s+(.+)$", s)
        if not m:
            m = re.match(r"^(?:are)\s+all\s+(.+?)\s+(.+)$", s)
        if m:
            sub, obj = (self.normalize(x) for x in m.groups())
            # Universal means proving category edge or explicitly known counterexample.
            universal = s.startswith("are all ") or s.startswith("is all ")
            status, proof = self.prove(sub, "is_a", obj)
            if universal:
                for f in self.facts():
                    if f.relation == "is_a" and f.polarity == -1 and self._path(f.subject, sub) is not None and f.obj == obj:
                        counterexample = self._path(f.subject, sub) + [f]
                        if status == "yes":
                            status, proof = "conflict", proof + counterexample
                        elif status == "unknown":
                            status, proof = "no", counterexample
                        break
            return self._yes_no(sub, "is_a", obj, status, proof, universal)
        m = re.match(r"^can\s+(.+)$", s)
        if m:
            sub, obj = self._split_subject_action(m.group(1))
            if not obj:
                return self.result("unsupported", "Please name an action, such as 'Can penguins fly?'")
            status, proof = self.prove(sub, "can", obj)
            return self._yes_no(sub, "can", obj, status, proof)
        m = re.match(r"^(?:does|do)\s+(.+?)\s+(?:have|need|cause|help)\s+(.+)$", s)
        if m:
            sub, obj = (self.normalize(x) for x in m.groups())
            verb = re.search(r"\s+(have|need|cause|help)\s+", s).group(1)
            rel = {"have": "has", "need": "needs", "cause": "causes", "help": "helps"}[verb]
            status, proof = self.prove(sub, rel, obj)
            return self._yes_no(sub, rel, obj, status, proof)
        m = re.match(r"^(?:what\s+(?:is|are)|tell me about)\s+(.+)$", s)
        if m:
            sub = self.normalize(m.group(1))
            return self._describe(sub)
        m = re.match(r"^why\s+(?:is|are)\s+(.+?)\s+(?:a|an)\s+(.+)$", s)
        if m:
            sub, obj = (self.normalize(x) for x in m.groups())
            status, proof = self.prove(sub, "is_a", obj)
            return self._yes_no(sub, "is_a", obj, status, proof)
        m = re.match(r"^what\s+(?:does|do)\s+(.+?)\s+(?:need|have|cause|help)\s*$", s)
        if m:
            sub = self.normalize(m.group(1))
            verb = re.search(r"\s+(need|have|cause|help)\s*$", s).group(1)
            rel = {"need": "needs", "have": "has", "cause": "causes", "help": "helps"}[verb]
            return self._list_rel(sub, rel)
        return self.result("unsupported", "I can't reliably interpret that sentence yet. Try 'Is Alphonso a fruit?', 'Can penguins fly?', 'What is a whale?', or teach me a fact.")

    def _yes_no(self, sub, rel, obj, status, proof, universal=False):
        suffix = f"all {sub}s are {obj}s" if universal else (f"{sub} is {article(obj)} {obj}" if rel == "is_a" else f"{sub} {REL_DISPLAY[rel]} {obj}")
        if status == "yes":
            ans = f"Yes. I can establish that {suffix} from the stored claims."
        elif status == "no":
            ans = f"No. I have an explicit counterclaim or counterexample to '{suffix}'."
        elif status == "conflict":
            ans = "Conflicting stored claims support both sides. I won't choose one without verification."
        else:
            ans = f"Unknown. My current knowledge doesn't establish whether {suffix}. Not knowing is different from 'no'."
        return self.result(status, ans, proof)

    def _describe(self, subject):
        paths = self._ancestors(subject)
        if len(paths) == 1 and not any(f.subject == subject for f in self.facts()):
            return self.result("unknown", f"I don't have verified knowledge about {subject}.")
        direct = [f for f in self.facts() if f.subject == subject]
        inherited = [f for f in self.facts() if f.subject in paths and f.subject != subject and f.relation != "is_a" and f.polarity > 0]
        facts = direct + inherited
        facts = facts[:8]
        descriptions = [f.sentence() for f in facts]
        if len(paths) > 1 and not any(f.relation == 'is_a' and f.polarity > 0 for f in facts):
            nearest = min((p for n,p in paths.items() if p), key=len, default=[])
            descriptions = [f.sentence() for f in nearest] + descriptions
            facts = nearest + facts
        return self.result("yes", " ".join(descriptions) or f"{nice(subject)} is known, but I have no descriptive claims.", facts)

    def _list_rel(self, subject, rel):
        paths = self._ancestors(subject)
        hits = []
        for ancestor, chain in paths.items():
            for f in self.facts():
                if f.subject == ancestor and f.relation == rel and f.polarity > 0:
                    hits.append((f.obj, chain + [f]))
        if not hits:
            return self.result("unknown", f"I don't know what {subject} {rel}.")
        seen = {}
        for obj, chain in hits:
            seen.setdefault(obj, chain)
        choices = ', '.join(seen)
        trace = [f for path in seen.values() for f in path]
        return self.result("yes", f"Based on stored claims, {subject} {rel}: {choices}.", trace)

    def _creative(self, prompt):
        # A real procedural composition over knowledge relationships, not a model.
        concepts = []
        all_facts = self.facts()
        subjects = sorted({f.subject for f in all_facts}, key=len, reverse=True)
        for s in subjects:
            if re.search(r"\b" + re.escape(s) + r"\b", prompt):
                concepts.append(s)
        concepts = concepts[:2]
        if not concepts:
            return self.result("unknown", "I can only compose from concepts in my knowledge graph. Try 'Write about rain and hope'.", intent="creative")
        elements = []
        proof = []
        for c in concepts:
            candidates = [f for f in all_facts if f.subject == c and f.polarity > 0 and f.relation != 'is_a']
            if not candidates:
                continue
            f = candidates[0]
            elements.append(f)
            proof.append(f)
        if not elements:
            return self.result("unknown", "I know these concepts, but not enough about their properties to compose a meaningful sentence.", intent="creative")
        if len(elements) > 1:
            a, b = elements[:2]
            output = f"{nice(a.subject)} {a.relation} {a.obj}; {b.subject} {b.relation} {b.obj}. Different forms of change can share a quiet beginning."
        else:
            a = elements[0]
            output = f"{nice(a.subject)} {a.relation} {a.obj}. A small truth, carried into a new day, may become the start of a larger story."
        # Use grammatically inflected templates: avoid writing raw relation codes.
        for f in elements:
            output = output.replace(f"{f.subject} {f.relation} ", f"{f.subject} {REL_DISPLAY[f.relation]} ")
            output = output.replace(f"{nice(f.subject)} {f.relation} ", f"{nice(f.subject)} {REL_DISPLAY[f.relation]} ")
        return self.result("creative", output, proof, intent="creative")

    def reset(self):
        """Restore the original demo knowledge and erase taught facts/aliases."""
        with self.conn:
            self.conn.execute("DELETE FROM facts")
            self.conn.execute("DELETE FROM aliases")
        for sub, rel, obj, pol in SEED:
            self.add_fact(sub, rel, obj, pol, "curated sample")
        return {"ok": True, "message": "Demo reset to its original curated sample knowledge."}

    def export_knowledge(self):
        return {"count": self.count(), "facts": [{"id": f.id, "text": f.sentence(), "subject": f.subject, "relation": f.relation, "object": f.obj, "polarity": f.polarity, "source": f.source} for f in self.facts()], "aliases": self.aliases()}


EVAL_CASES = [
    ("Is Alphonso a fruit?", "yes"),
    ("Is Alphonso a plant product?", "yes"),
    ("Is a mango a fruit?", "yes"),
    ("Is a penguin an animal?", "yes"),
    ("Is a whale an animal?", "yes"),
    ("Is a dolphin an animal?", "yes"),
    ("Can penguins fly?", "no"),
    ("Can sparrows fly?", "yes"),
    ("Can whales fly?", "unknown"),
    ("Can unicorns fly?", "unknown"),
    ("Is a penguin a fruit?", "unknown"),
    ("Is a sparrow a penguin?", "no"),
    ("Are all birds animals?", "yes"),
    ("Are all birds penguins?", "no"),
    ("What is a whale?", "yes"),
    ("What is an imaginary pineapple?", "unknown"),
    ("What does a plant need?", "yes"),
    ("Do plants need water?", "yes"),
    ("Does rain cause soil to become wet?", "yes"),
    ("Does hope help people persevere?", "yes"),
    ("Can dolphins breathe underwater?", "unknown"),
    ("Is a whale a mammal?", "yes"),
    ("Does a plant need moonlight?", "unknown"),
    ("Is a fish an animal?", "yes"),
    ("Write about rain and hope", "creative"),
    ("Where do penguins live?", "unsupported"),
    ("What is the capital of France?", "unknown"),
    ("Is Alphonso a fruit and a bird?", "unsupported"),
]


def run_evaluation(engine: KnowledgeEngine) -> dict:
    # Fixed test questions represent reference expectations, not independent fact-checking.
    checks = []
    for q, expected in EVAL_CASES:
        actual = engine.query(q)
        passed = actual['status'] == expected
        checks.append({"question": q, "expected": expected, "actual": actual['status'], "pass": passed, "answer": actual['answer']})
    return {"passed": sum(x['pass'] for x in checks), "total": len(checks), "checks": checks,
            "caveat": "Tests are fixed reference cases. They check engine behavior against an authored answer key, not real-world truth or open-ended language competence."}
