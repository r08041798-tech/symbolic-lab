# v0.4
Short ambiguous messages and greetings are routed locally. Token budgets 48/112/192, 45-second generation cap, 180-second load cap, stop button, worker termination and repetition detection. Light uses SmolLM2 360M; Better uses Qwen2.5 0.5B Instruct ONNX q4 (786 MB weights). Both still experimental, no quality guarantee. No browser inference benchmark was performed. Original custom skills remain. Tests cover pure guards; browser worker cancellation and model inference require device testing.

## v0.4.1
Fixed unescaped apostrophe in the conversation system prompt which prevented the module from parsing. Added versioned module URL and service worker cache revision, plus regression import and greeting tests.

## v0.5 mobile performance
Worker stream batching at 250 ms, progress throttle, no smooth scroll or mobile autofocus, capped DOM history, reduced phone context and output budget, idle worker termination, release on model switch/hidden tab/new chat/cache clear, optional cancel on typing enabled on phones, 135M q8 fallback. These mitigate but cannot guarantee absence of OS-level resource contention. Actual phone benchmark pending.
