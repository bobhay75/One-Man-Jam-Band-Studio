# ACE-Step 1.5 neural renderer

One-Man Jam Band Studio keeps its local procedural band as the default. This optional adapter connects to an ACE-Step 1.5 REST API for higher-fidelity generated stems.

## Why ACE-Step 1.5

The official ACE-Step 1.5 base model supports track-aware `lego`, `extract`, and `complete` tasks. The studio uses **Lego** one stem at a time so generated drums, bass, and lead guitar remain separately controllable.

## Server requirements

ACE-Step 1.5 currently documents Python 3.11–3.12 and supports CUDA, MPS, ROCm, Intel XPU, and CPU. Track-aware tasks require a **base** model, not Turbo/SFT.

Official quick-start pattern:

```bash
git clone https://github.com/ACE-Step/ACE-Step-1.5.git
cd ACE-Step-1.5
uv sync

# Lego/Complete require the base model.
export ACESTEP_CONFIG_PATH=acestep-v15-base

# Strongly recommended if the API is reachable beyond localhost.
export ACESTEP_API_KEY='replace-with-a-long-random-secret'

uv run acestep-api
```

The default API port is `8001`.

## Security rules in this studio

- API keys are entered at runtime and are **not** written to project JSON or Git.
- Plain HTTP endpoints are accepted only for `localhost` / `127.0.0.1`.
- Remote endpoints must use HTTPS.
- Generated audio URLs are accepted only when they resolve under the configured ACE-Step base URL.
- The source recording is sent to the configured neural server only after an explicit neural-generation action.

## Chromebook note

The Chromebook/browser remains the studio front end. ACE-Step inference is separate compute. A low-memory Chromebook is not the expected machine for the base model; use another GPU machine or an owner-controlled HTTPS GPU service for neural rendering.

## CORS

If the browser cannot call ACE-Step because of CORS, do **not** disable browser security. Put the API behind an HTTPS reverse proxy that permits only the studio origin and forwards the Authorization header.
