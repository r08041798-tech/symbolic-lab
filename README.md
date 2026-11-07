# Symbolic Lab v2 — Research without an LLM

An experimental Python knowledge engine and mobile-friendly single-page UI. No neural networks, pretrained models, embeddings or AI inference services. **The Internet is a source of claims, not a truth oracle.**

## What's new in v2

- **Research tab:** Search public Wikidata entities by name. Select the exact item (QID), which avoids silently choosing the wrong "Mercury", "Python", etc.
- **Structured knowledge acquisition:** Import an explicit whitelist of about 20 Wikidata properties, plus up to four hops of category and taxonomic parent relationships. Each claim retains a source URL, property and retrieval time.
- **Opt-in automatic research:** The Ask page can try an exact Wikidata match for an unknown subject. Ambiguous or non-matching names are not silently selected.
- **Answer construction:** Ask constrained natural-language queries about capital cities, countries, creators, descriptions, and taxonomic or subclass membership. An answer includes the relevant stored source claims and any multi-step proof chain.
- **Correction:** Refresh a QID to replace claims retrieved for that entity; subsequent inferences are recomputed and do not reuse old conclusions.
- **Contradiction detection:** A small review checks for **direct** conflicts between user-provided negative category assertions and imported Wikidata statements. This is not general fact-checking.
- **Separate visitor memory:** The hosted demo uses per-browser temporary SQLite databases. Browser localStorage remembers up to four topic IDs and attempts to re-import them if Render restarts.
- **Honest unknowns:** Missing evidence produces "unknown", not a guessed answer. Unsupported language stays unsupported.

## How to run locally

Requires Python 3.10+ and no third-party Python packages.

```bash
python server.py
```

Open http://127.0.0.1:8765. For a production-like session:

```bash
HOST=0.0.0.0 PORT=8765 python server.py
```

Open http://localhost:8765. Be aware this is a **prototype**; do not expose it to untrusted users in sensitive settings.

## How to try it

1. In **Research internet**, search `France`, select the matching Wikidata entry, and press Learn.
2. Go to Ask and ask `What is the capital of France?`. The response shows a source link to the relevant Wikidata assertion.
3. Search and import `cheetah`, then ask `Is a cheetah a mammal?`. The system will only say yes if an imported structured hierarchy actually establishes the chain; otherwise it says unknown. Property chains and labels vary by source.
4. Refresh a topic and see that claims are replaced; the system recomputes conclusions instead of memorizing the previous answer.
5. Use Evaluate for the original 28 fixed legacy tests; run independent new questions to assess generalization.

**Important:** The Wikidata connection requires an internet connection on the server. Our automated testing of the research engine uses an injected test provider, not live Wikidata access. The live external API must be verified after deployment.

## Deployment: updates to existing Render service

The existing Render service at https://symbolic-lab-demo.onrender.com automatically deploys new commits on the GitHub repository. Its current build command is:

```
mkdir -p web && cp index.html web/index.html
```

The repository's `index.html` must be the latest frontend. In the *root* of the GitHub repository `r08041798-tech/symbolic-lab`, replace `server.py` and `index.html` and add `research.py` and `test_research.py`. All are in the small `symbolic_lab_v2_update.zip` archive. Commit changes and let Render auto-deploy. (The existing `engine.py` stays unchanged.)

## API additions

- `POST /api/research/search` `{ "topic": "France" }`: returns up to five search choices.
- `POST /api/research/learn` `{ "qid": "Q142" }`: downloads bounded related claims for a specific item.
- `GET /api/research/topics`: learned topics and source claim count.
- `GET /api/research/review`: limited direct contradiction review.
- `POST /api/research/reset` `{}`: clears the research evidence for the current browser session.

The original Ask, Teach, Evaluate and Knowledge APIs remain available.

## Safety and limitations

- An item appearing on Wikidata **does not certify its truth**. The engine does not yet corroborate statements against independent primary evidence or verify citations. Source-based correctness and world truth are not the same.
- Only a tiny typed subset of entities and properties is supported; no reliable unrestricted natural-language understanding or reasoning from arbitrary webpages.
- A classification chain combines Wikidata `instance of`, `subclass of`, and `parent taxon` links as a limited symbolic inference. It can be semantically too broad when source modeling is incomplete.
- The engine cannot disambiguate all entities using free-text questions. Search and learn an exact Wikidata QID first.
- Real-world status can change. Research shows fetch timestamps and may be stale until refreshed.
- Automated tests cover deterministic behavior using synthetic data. They are not measurements of open-world factual accuracy or general intelligence.
- The Render free plan sleeps during inactivity and has ephemeral storage. Browser backup is limited and not guaranteed. Avoid entering sensitive information.
- Wikimedia imposes API limits and requires identification via User-Agent. The app rate limits external searches/imports and uses timeouts.

## Tests

```bash
python -m unittest discover -v
```

24 tests currently: 11 original reasoning tests and 13 new research tests, including multi-hop evidence, refusal of unsupported conclusions, ambiguity, provenance, stale-claim replacement, direct contradiction review, and malformed QID rejection. All 24 passed locally before packaging.
