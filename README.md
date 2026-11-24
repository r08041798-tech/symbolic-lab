# Modular AI v0.2

Run `npm start` and open http://localhost:8080. Prebuilt static assets in `dist/` are ready for HTTPS static hosting/CDN. `npm run train` trains the 12-hidden-unit neural intent model from 50 labeled examples; quantized int8 weights are serialized in JSON, not a binary int8 format. `npm run build` compiles TypeScript and regenerates hashes; `npm test` runs the automated suite. Node 22 recommended.

Chat supports arithmetic, conversions, extractive summaries, a small knowledge pack, user-taught facts, names, prior numeric results and one arithmetic-to-conversion chain. It is not an autoregressive LLM and cannot answer arbitrary questions. The neural fallback loads only for unclear routes. Browser workers isolate execution from the UI, but are not a security sandbox for arbitrary untrusted code. A trusted manifest pins SHA-256 hashes. Default CDN is the static site origin; optional alternative CDN needs HTTPS and CORS. Local memory persists on the browser. No external AI APIs. Clear chat resets memory.

Deployment: publish dist on any static HTTPS CDN. The build is dependency-free at runtime.
