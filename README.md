# Kavach — live scam-call shield

Put a call on speakerphone and open Kavach. It listens live, understands Hindi, English and code-mixed speech,
and the moment the call looks like a "digital arrest", fake KYC or "CBI officer" scam, it warns the user
out loud in their own language: *"अम्मा, यह फ्रॉड कॉल है। OTP मत बताना।"* A live meter shows how likely it is a scam.

## How it works

```
Browser mic (16 kHz PCM, every 100 ms)
  → FastAPI WebSocket /ws
    → Sarvam Saaras v4 realtime STT (auto language, code-mix)
    → Sarvam-105B (conversations): scam probability + type, as strict JSON
    → when ≥ 70: Sarvam Translate + Bulbul v3 speak the warning in the user's language
  → browser: live transcript, scam meter, spoken warning
```

| Task | Sarvam API |
|---|---|
| Live transcription of the call | Speech-to-Text realtime streaming, `saaras:v4`, `mode=codemix` |
| Is this a scam? | Chat completions, `sarvam-105b-conversations`, JSON schema output |
| Warning in the user's language | Text translate + Text-to-Speech `bulbul:v3` |

The browser ↔ server protocol is in [CONTRACT.md](CONTRACT.md).

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then paste your Sarvam key into .env
.venv/bin/uvicorn app.main:app --reload
```

Open http://localhost:8000 and allow the microphone.

### Test without a second person

```bash
.venv/bin/python scripts/stream_test.py     # streams scripts/test_call.wav live into the server
```

`scripts/make_test_call.py` regenerates that fake Hinglish scam call with Bulbul.

## Deploy (Render)

New → Blueprint → pick this repo (uses `render.yaml`), then set `SARVAM_API_KEY` in the dashboard.
Render supports WebSockets; Vercel serverless does not, so use Render for this app.

API keys live only in `.env` (git-ignored) or the host's env vars — never in the repo.
