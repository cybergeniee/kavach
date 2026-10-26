# Kavach WebSocket contract

The backend serves `static/` at `/` and two WebSockets: `/ws` (the call) and `/watch` (family view).

## `/ws?lang=hi-IN`: the elder's call

`lang` is the language the **warning and report** are spoken in.
Allowed: `hi-IN en-IN bn-IN ta-IN te-IN mr-IN gu-IN kn-IN ml-IN pa-IN od-IN`. Default `hi-IN`.
The call itself can be in any Indian language or a mix; it is auto-detected.

**Browser → server**
- Binary frames: **16 kHz mono Int16 PCM**, ~100 ms each (3200 bytes), continuously in real time.
- Text `{"type":"stop"}` ends the call. Keep the socket open until `ended` to receive the report.

**Server → browser** (JSON)

| `type` | Fields | When |
|---|---|---|
| `session` | `id` (5-char family code), `lang` | First message. |
| `ready` | — | Speech connection open; start sending audio. |
| `partial` | `text` | Live, still-changing text of the current sentence. |
| `final` | `idx`, `text`, `t` (s), `language` | A finished sentence. |
| `translation` | `idx`, `text` | English subtitle for sentence `idx`. |
| `score` | `probability` 0–100, `scam_type`, `stage`, `reason`, `red_flags[]`, `safe_reply`, `t` | After each sentence and every ~2.5 s mid-sentence. |
| `warning` | `text`, `audio` (base64 WAV), `probability`, `t` | Once, when probability ≥ 70. |
| `analyzing` | — | After `stop`; building the report. |
| `report` | `verdict` (scam/suspicious/safe), `summary_local`, `summary_en`, `next_steps[]`, `duration`, `transcript[]`, `final_score` | Post-call. |
| `report_audio` | `audio` (base64 WAV of `summary_local`) | Right after `report`. |
| `ended` | — | Done; server closes. |
| `error` | `message`, `fatal` | Show it. |

`scam_type`: `none digital_arrest kyc_expiry fake_officer otp_request parcel_customs lottery_prize investment other`
`stage`: `none contact impersonation fear isolation payment_demand`

## `/watch?session=CODE`: family view

Sends `{"type":"watching","session","lang","live"}`, replays the call so far, then mirrors every event above live.
Unknown code → `{"type":"error","message":"No call with that code."}`.

## HTTP

- `POST /api/speak {text, lang}` → `{audio}` (base64 WAV). Reads the safe reply aloud.
- `GET /api/session/{code}` → `{exists, live, lang}`
- `GET /health`
