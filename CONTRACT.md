# Kavach frontend ↔ backend contract

The backend serves everything in `static/` at `/`, and one WebSocket at `/ws`.
Both sides must follow this file. Change it only if both people agree.

## Connect

```
ws(s)://<host>/ws?lang=hi-IN
```

`lang` is the language the **warning** is spoken in (the user's own language).
Allowed: `hi-IN en-IN bn-IN ta-IN te-IN mr-IN gu-IN kn-IN ml-IN pa-IN od-IN`. Default `hi-IN`.
The call itself can be in any language or mix of languages; it is auto-detected.

## Browser → server

- **Binary frames:** raw audio, **16 kHz, mono, 16-bit signed little-endian PCM** (Int16).
  Send ~100 ms per frame (1600 samples = 3200 bytes), continuously, in real time.
- **Text frame** `{"type": "stop"}` to end the session. (Closing the socket also works.)

## Server → browser (JSON text frames)

| `type` | Fields | When |
|---|---|---|
| `ready` | — | Sarvam connection is open; start sending audio. |
| `partial` | `text` | Live, still-changing transcript of the current sentence. |
| `final` | `text` | A finished sentence. Append it to the transcript. |
| `score` | `probability` (0–100 int), `scam_type` (string), `reason` (short English), `red_flags` (string[]) | After each sentence (and sometimes mid-sentence). Drives the meter. |
| `warning` | `text` (warning in the user's language), `audio` (base64 WAV), `probability` | Once per session, when probability ≥ 70. Play the audio and show the text big. |
| `error` | `message` | Something failed. Show it; the socket may close after. |

`scam_type` is one of: `none`, `digital_arrest`, `kyc_expiry`, `fake_officer`, `otp_request`,
`parcel_customs`, `lottery_prize`, `investment`, `other`.

## Example session

```json
{"type":"ready"}
{"type":"partial","text":"hello main CBI"}
{"type":"final","text":"Hello, main CBI officer bol raha hoon, aapke naam pe case hai."}
{"type":"score","probability":82,"scam_type":"fake_officer","reason":"Caller claims to be CBI and says there is a case against you.","red_flags":["claims CBI","threat of case"]}
{"type":"warning","text":"अम्मा, यह फ्रॉड कॉल है। ...","audio":"UklGR...","probability":82}
```
