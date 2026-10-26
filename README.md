# 🛡 Kavach: live scam-call shield

Every day, elderly Indians lose their savings to "digital arrest", fake KYC and "CBI officer" calls, while the call is still going on.
**Kavach listens to the call live**, understands Hindi, English, Tamil and code-mixed speech, and the moment the call turns into a scam
it **warns the user out loud, in their own language**: *"अम्मा, यह फ्रॉड कॉल है। OTP मत बताना।"*

## Features

- **Live transcription** of a speakerphone call, any Indian language or a mix (Saaras v4 realtime, code-mix mode)
- **Live scam meter** (0–100%) that updates mid-sentence, with the scam type and red-flag chips
- **Scam-script tracker** that follows the caller through *contact → fake identity → threats → isolation → OTP/money demand*
- **Spoken warning** in 11 languages, with a full-screen alarm and vibration
- **"Say this to the caller"**: a calm, safe reply in the user's language, read aloud on tap
- **English subtitles** under every line, so family and judges can follow
- **Family live view**: share a 5-letter code or QR, and family see the transcript, meter and alarm on their own phone in real time
- **Post-call report**, spoken in the user's language: verdict, what happened, next steps, the 1930 helpline, a downloadable report for a police complaint, and WhatsApp sharing
- **Risk timeline** marking the moment Kavach warned
- **Built-in demo calls** (Hinglish digital arrest, Tamil fake KYC, English customs parcel, and a safe call from a grandson) that run through the same live pipeline
- **Offline mock mode** (`?mock=1`), with no mic, network or key needed
- Call history on the device

## Sarvam APIs used

| Task | Sarvam API |
|---|---|
| Live call transcription | Speech-to-Text realtime streaming: `saaras:v4`, `mode=codemix`, auto language, scam keyterms |
| Is it a scam? Which stage? What to reply? | Chat completions: `sarvam-105b-conversations`, strict JSON schema |
| Post-call report | Chat completions: `sarvam-105b-conversations` |
| English subtitles, and warnings in 11 languages | Text translate (`auto` → `en-IN`, `en-IN` → user's language) |
| Spoken warning, report and safe reply | Text-to-Speech: `bulbul:v3` |
| Demo calls | Text-to-Speech: `bulbul:v3` (`scripts/make_demo_calls.py`) |

## How it works

```
Phone call on speaker ─► Browser mic ─► AudioWorklet (16 kHz PCM, 100 ms) ─► WebSocket /ws
                                                                               │
          ┌────────────────────────────────────────────────────────────────────┘
          ▼
  Saaras v4 realtime STT ─► partial / final text ─► Sarvam-105B scam scorer (JSON)
          │                       │                        │ ≥ 70%
          │                       └► Translate → English    └► Bulbul warning in the user's language
          ▼
  Browser: live transcript · meter · stage tracker · alarm ──► mirrored to family on /watch
  On stop: Sarvam-105B report + Bulbul audio
```

The protocol is in [CONTRACT.md](CONTRACT.md).

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env              # paste your Sarvam API key into .env
.venv/bin/uvicorn app.main:app --reload
```

Open http://localhost:8000.

- **Live:** choose *Live call (mic)*, press **Start listening**, and put a phone call on speaker next to the laptop.
- **Demo:** choose *Demo call*, pick a scenario and press Start. One-click link: `/?source=demo&demo=digital_arrest_hinglish&autostart`
- **Family view:** tap the *Family code* badge and scan the QR on another phone (works once deployed over HTTPS).
- **Offline:** `/?mock=1&autostart`

Command-line check: `.venv/bin/python scripts/stream_test.py` streams a demo call into the server and prints every event.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render, go to **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. Set `SARVAM_API_KEY` when asked, then deploy.
4. Open the `https://…onrender.com` URL on a phone. The mic needs HTTPS, which Render provides.

Use Render rather than Vercel: Kavach holds a live WebSocket for the whole call, which Vercel's serverless functions can't do.
On Render's free plan the app sleeps when idle, so open it a minute before your demo.

**Keys:** the API key lives only in `.env` (git-ignored) or the host's environment variables, never in the repo or the browser.

## Demo script (2 minutes)

1. Open Kavach on the laptop (projector) and the family view on a phone using the code or QR.
2. A friend calls your phone and plays the scammer: *"Main CBI se bol raha hoon, aapke Aadhaar pe drugs parcel mila hai…"* Put the call on speaker.
3. Watch the meter climb and the stage tracker advance. At about 70% the alarm fires on the laptop **and** the family phone.
4. Tap **Read it to me** to hear the safe reply. Stop the call, and the spoken report plays with the 1930 helpline.
5. Switch the warning language to Tamil and run the Tamil demo call to show it works across languages.
