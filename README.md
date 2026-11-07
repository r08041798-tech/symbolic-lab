# Symbolic Lab: an explainable Python reasoning experiment

**No LLM, neural network, pretrained NLP model, paid API, or external API calls.** This is a deliberately limited symbolic knowledge engine, not a general conversational AI.

## Instant HTML preview (no Python required)

Open `instant_preview.html` directly in any browser to try a lightweight **JavaScript adaptation** of the Python rules. It has a question input, a teach-fact input, reasoning traces and reset. It only keeps changes while the page remains open. **The real persistent implementation is Python and requires the Python server below.**

## Start the app

Requires **Python 3.10+**. No `pip install` needed.

```bash
python server.py
```

Open **http://127.0.0.1:8765** in your browser. The app has four tabs:

- **Ask & reason** — questions and transparent proof steps.
- **Teach the engine** — add facts such as `A robin is a bird`, or aliases such as `little bird → sparrow`.
- **Evaluate** — execute 28 reference checks, with detailed pass/fail outcomes.
- **Knowledge graph** — search stored claims, see sources, and reset the demo.

All knowledge is saved in `knowledge.sqlite3`, created automatically next to `server.py`. Delete that database while the app is stopped to start fresh, or use the Reset demo button.

## What to test first

1. Ask `Is a robin an animal?` → **UNKNOWN**.
2. Teach `A robin is a bird` → the engine stores this user-provided claim.
3. Ask `Is a robin an animal?` again → **YES**, with proof `robin → bird → animal`.
4. Ask `Can robins fly?` → **UNKNOWN**. This is not automatically derivable from being a bird.
5. Teach `A robin can fly` and ask again → **YES**.
6. Teach `A robin cannot fly` → the system should **reject the direct contradiction**.
7. Ask `Are all birds penguins?` → **NO**, using an explicit sparrow counterexample.
8. Try `Write about rain and hope` → a *limited template-based* creative output.

## Design

- `engine.py` — parses a small subset of English into `(subject, relation, object, polarity)`, maintains a directed graph of `is_a` relationships, performs breadth-first proof search, inherits non-category properties, and generates natural-language explanations.
- `server.py` — Python standard-library local HTTP server with JSON API.
- `web/index.html` — single-page frontend with input, output, proof inspection, teaching, and evaluation.
- `tests.py` — independent Python unit tests.

### API

- `POST /api/ask` `{"question":"Is Alphonso a fruit?"}`
- `POST /api/teach` `{"statement":"A robin is a bird"}`
- `POST /api/alias` `{"phrase":"little bird","target":"sparrow"}`
- `GET /api/knowledge`
- `GET /api/tests`
- `POST /api/reset` `{}` (erases taught knowledge)
- `GET /api/health`

## Limitations and accuracy honesty

- This does **not** understand unrestricted English. It supports a small subset of question and statement forms; unsupported input is rejected.
- A yes/no answer is justified by a *stored knowledge path*, not independent real-world fact checking.
- User-submitted facts are source-labelled `user asserted`; they are not externally verified. Direct contradictory triples are rejected, but more complex inconsistencies can remain undetected.
- The reasoning engine assumes subclass inheritance in its knowledge graph. Some properties are not naturally inheritable; use domain modelling carefully.
- The creative composer is procedural, with restricted vocabulary, associations, and templates; it is nowhere near LLM-level writing.
- Aliases are exact lexical aliases, not semantic similarity or neural embeddings.
- The built-in evaluation uses fixed reference expectations. It demonstrates correctness for a constrained suite and is not proof of general intelligence. Test with **new, independently labelled questions** and track coverage and false certainty.
- This server binds to `127.0.0.1` for personal local use only. It has no authentication and should not be exposed on a public network.

## Run Python tests

```bash
python -m unittest -v
```

## How this can improve

Learning here is deterministic: the knowledge graph and alias table grow from explicit human-provided statements. It can solve *new* questions by combining those statements, without memorising every question-answer pair. Future research steps include source validation, provenance audits, a grammar parser, typed relations, rule mining, confidence calibration, novelty tests, contradiction handling, and test-set contamination controls. These are meaningful engineering challenges — not automatically solved by adding data.

## Deploying read-only on Render Free

This project includes `render.yaml`. To deploy, push the source folder to a Git repository accessible to Render, then create a Blueprint from that repository or a free Python web service with start command `HOST=0.0.0.0 python server.py` and health endpoint `/api/health`. It will listen on Render's `PORT`.

**Security:** When `HOST` is not `127.0.0.1`, teaching, aliases and reset are disabled unless the `SYMBOLIC_ADMIN_TOKEN` environment variable is set and an Authorization: Bearer token is supplied. Never put that token in public frontend code. The public deployment is intentionally read-only by default. Free-tier SQLite files on ephemeral storage are *not* persistent across redeploys/restarts. For genuine persistent multi-user teaching, add login and persistent database storage first. Local use still allows teaching and keeps knowledge in SQLite.
