# Deploy Symbolic Lab on Render free tier

1. Upload `engine.py`, `server.py`, `tests.py`, `requirements.txt`, `render.yaml`, and the `web/index.html` file to a GitHub repository. Do not upload `knowledge.sqlite3`, any secrets, or `__pycache__`.
2. Connect your repository in Render and create a free Python web service (or Blueprint using render.yaml).
3. Run it with `HOST=0.0.0.0 python server.py`, use the Render-provided `PORT`.
4. Visit `/api/health` after deploy, then open the homepage. Do not consider deployment verified until both succeed.

Each visitor gets an isolated in-memory knowledge session. The frontend replays previously taught lessons from browser localStorage following an app restart; clearing browser data removes that backup. SQLite persistence is for local use, not free Render deployments. Do not enter sensitive data. No paid dependencies or external AI APIs.
