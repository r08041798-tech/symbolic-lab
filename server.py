"""Symbolic Lab: pure-Python HTTP app, zero ML/LLM/API dependencies.
Public mode uses isolated in-memory sessions so visitors cannot modify one another's data.
Browser backup (localStorage) is replayed after server cold starts; nothing is persisted on free Render disks.
"""
import json
import os
import secrets
import threading
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from collections import deque
from research import EvidenceStore, ResearchError
from urllib.parse import urlparse
from engine import KnowledgeEngine, run_evaluation

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8765'))
PUBLIC = HOST not in ('127.0.0.1', 'localhost')
LOCAL_ENGINE = KnowledgeEngine(str(ROOT / 'knowledge.sqlite3')) if not PUBLIC else None
SESSIONS = {}  # browser token -> (KnowledgeEngine, last_access). Ephemeral free hosting.
LOCK = threading.RLock()
MAX_SESSIONS = 300
MAX_FACTS = 250
RESEARCH_RATES = deque()  # global public API protection; max 7 imports / minute


class Handler(BaseHTTPRequestHandler):
    new_cookie = None

    def engine(self):
        if not PUBLIC:
            return LOCAL_ENGINE
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            sid = jar.get('symbolic_session').value if jar.get('symbolic_session') else None
        except cookies.CookieError:
            sid = None
        now = time.time()
        with LOCK:
            if sid not in SESSIONS:
                sid = secrets.token_urlsafe(30)
                self.new_cookie = sid
                if len(SESSIONS) >= MAX_SESSIONS:
                    oldest = min(SESSIONS, key=lambda k: SESSIONS[k][1])
                    SESSIONS.pop(oldest)[0].close()
                SESSIONS[sid] = (KnowledgeEngine(':memory:'), now)
            eng, _ = SESSIONS[sid]
            SESSIONS[sid] = (eng, now)
            return eng

    def check_origin(self):
        """Reject cross-site POSTs even if browsers include the session cookie."""
        origin = self.headers.get('Origin')
        if origin:
            expected_host = self.headers.get('X-Forwarded-Host') or self.headers.get('Host', '')
            if origin not in ('https://' + expected_host, 'http://' + expected_host):
                self.send_json(403, {'error':'Cross-origin requests are not accepted'})
                return False
        return True

    def headers_common(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        if self.new_cookie:
            secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
            self.send_header('Set-Cookie', 'symbolic_session=' + self.new_cookie + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800' + secure)

    def send_json(self, code, data):
        raw = json.dumps(data, ensure_ascii=False).encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.headers_common()
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            self.engine()  # issue isolated session cookie on first page visit
            raw = (ROOT / 'web' / 'index.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.headers_common()
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        elif path == '/api/health':
            self.send_json(200, {'ok': True, 'engine': 'symbolic', 'external_ai': False, 'public_sessions': PUBLIC})
        elif path in ('/api/knowledge', '/api/tests', '/api/research/topics', '/api/research/review'):
            with LOCK:
                eng = self.engine()
                store = EvidenceStore(eng.conn)
                if path == '/api/knowledge': result = eng.export_knowledge()
                elif path == '/api/tests': result = run_evaluation(eng)
                elif path == '/api/research/topics': result = {'ok':True,'topics':store.topics(),'sourced_claims':store.claim_count()}
                else: result = store.review()
                self.send_json(200, result)
        else:
            self.send_json(404, {'error': 'Not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ('/api/ask', '/api/teach', '/api/alias', '/api/reset', '/api/research/search', '/api/research/learn', '/api/research/reset'):
            return self.send_json(404, {'error': 'Not found'})
        if not self.check_origin(): return
        if not self.headers.get('Content-Type', '').lower().startswith('application/json'):
            return self.send_json(415, {'error': 'Expected application/json'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0: raise ValueError()
            if length > 4096: return self.send_json(413, {'error': 'Request too large'})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict): raise ValueError()
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'error': 'Expected a JSON object'})
        try:
            with LOCK:
                eng = self.engine()
                if path in ('/api/teach', '/api/alias') and eng.count() >= MAX_FACTS:
                    return self.send_json(429, {'error': 'Knowledge limit reached for this demo session'})
                store = EvidenceStore(eng.conn)
                if path.startswith('/api/research/'):
                    if path in ('/api/research/search', '/api/research/learn'):
                        now = time.monotonic()
                        while RESEARCH_RATES and RESEARCH_RATES[0] < now - 60:
                            RESEARCH_RATES.popleft()
                        if len(RESEARCH_RATES) >= 7:
                            return self.send_json(429, {'error':'Shared research rate limit reached; retry in one minute.'})
                        RESEARCH_RATES.append(now)
                    if path == '/api/research/search':
                        result = store.search(str(body.get('topic','')))
                    elif path == '/api/research/learn':
                        if len(store.topics()) >= 15 and str(body.get('qid','')) not in [t['qid'] for t in store.topics()]:
                            return self.send_json(429, {'error':'This demo allows 15 researched topics per session.'})
                        result = store.learn(str(body.get('qid','')))
                    else: result = store.reset()
                elif path == '/api/ask':
                    question=str(body.get('question', ''))
                    result = store.ask(question) or eng.query(question)
                    if body.get('auto_research') is True and result['status'] in ('unknown','unsupported'):
                        now = time.monotonic()
                        while RESEARCH_RATES and RESEARCH_RATES[0] < now - 60:
                            RESEARCH_RATES.popleft()
                        if len(RESEARCH_RATES) < 7:
                            RESEARCH_RATES.append(now)
                            try:
                                discovery = store.suggest_auto_research(question)
                                if discovery and discovery.get('learned'):
                                    result = store.ask(question) or result
                                    result['auto_researched'] = discovery
                                elif discovery:
                                    result['research_hint'] = 'Cannot safely resolve the entity. Use the Research tab to select the correct topic.'
                            except ResearchError as exc:
                                result['research_hint'] = str(exc)
                        else:
                            result['research_hint'] = 'Shared research rate limit; try again later.'
                    result['fact_count'] = eng.count() + store.claim_count()
                elif path == '/api/teach':
                    result = eng.teach(str(body.get('statement', '')))
                elif path == '/api/alias':
                    result = eng.add_alias(str(body.get('phrase', '')), str(body.get('target', '')))
                else:
                    result = eng.reset()
                self.send_json(200, result)
        except ResearchError as exc:
            self.send_json(422, {'error':str(exc)})
        except Exception as exc:
            print('Server error:', type(exc).__name__, str(exc))
            self.send_json(500, {'error': 'Internal error'})

    def log_message(self, fmt, *args):
        print('HTTP', fmt % args)


if __name__ == '__main__':
    print('Symbolic Lab listening on', HOST, PORT, 'public=', PUBLIC, flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
