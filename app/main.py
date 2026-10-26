"""Kavach server: browser mic -> Sarvam realtime STT -> scam score -> spoken warning."""

import asyncio
import base64
import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from sarvamai import AsyncSarvamAI, RealtimeAudioInput, RealtimeEnd, RealtimePing

from .scam import score_transcript
from .warning import get_warning

ROOT = Path(__file__).resolve().parent.parent

# Load .env for local runs (on Render the key comes from the dashboard env vars).
env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())

API_KEY = os.environ.get("SARVAM_API_KEY")
if not API_KEY:
    raise SystemExit("SARVAM_API_KEY is not set. Add it to .env or your host's env vars.")

WARN_AT = 70  # probability that triggers the spoken warning
PARTIAL_SCORE_EVERY = 2.5  # seconds between mid-sentence scores
TRANSCRIPT_WINDOW = 12  # sentences of context sent to the model

KEYTERMS = json.dumps([
    "CBI", "digital arrest", "KYC", "OTP", "Aadhaar", "PAN card", "RBI", "TRAI",
    "customs", "parcel", "money laundering", "FedEx", "AnyDesk", "TeamViewer",
    "UPI", "CVV", "safe account", "arrest warrant", "cyber crime", "Mumbai police",
])

app = FastAPI(title="Kavach")


@app.get("/health")
async def health():
    return {"ok": True}


@app.websocket("/ws")
async def call_stream(websocket: WebSocket, lang: str = "hi-IN"):
    await websocket.accept()
    client = AsyncSarvamAI(api_subscription_key=API_KEY)

    finals: list[str] = []
    partial = ""
    warned = False
    scoring = False
    last_scored_text = ""
    last_partial_score = 0.0

    async def send(msg: dict):
        try:
            await websocket.send_json(msg)
        except Exception:
            pass

    async def run_score():
        nonlocal scoring, warned, last_scored_text
        text = " ".join(finals[-TRANSCRIPT_WINDOW:] + ([partial] if partial else [])).strip()
        if not text or text == last_scored_text:
            scoring = False
            return
        last_scored_text = text
        try:
            result = await score_transcript(client, text)
            await send({"type": "score", **result})
            if result["probability"] >= WARN_AT and not warned:
                warned = True
                warning_text, audio = await get_warning(client, lang)
                await send({"type": "warning", "text": warning_text, "audio": audio,
                            "probability": result["probability"]})
        except Exception as e:
            await send({"type": "error", "message": f"scoring failed: {e}"})
        finally:
            scoring = False

    def maybe_score(force: bool):
        nonlocal scoring, last_partial_score
        if scoring:
            return  # one call in flight at a time; the next sentence triggers a fresh one
        now = time.monotonic()
        if not force and now - last_partial_score < PARTIAL_SCORE_EVERY:
            return
        last_partial_score = now
        scoring = True
        asyncio.create_task(run_score())

    try:
        async with client.speech_to_text_realtime_streaming.connect(
            language_code="auto",
            model="saaras:v4",
            mode="codemix",
            stream_type="fast",
            encoding="linear16",
            sample_rate="16000",
            keyterms=KEYTERMS,
        ) as stt:
            await send({"type": "ready"})

            async def browser_to_sarvam():
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        break
                    if msg.get("bytes"):
                        audio = base64.b64encode(msg["bytes"]).decode()
                        await stt.send_realtime_audio_input(RealtimeAudioInput(audio=audio))
                    elif msg.get("text") and json.loads(msg["text"]).get("type") == "stop":
                        break
                await stt.send_realtime_end(RealtimeEnd())

            async def sarvam_to_browser():
                nonlocal partial
                async for event in stt:
                    kind = getattr(event, "event", None)
                    if kind == "transcript.partial":
                        partial = event.text or ""
                        await send({"type": "partial", "text": partial})
                        maybe_score(force=False)
                    elif kind == "transcript.final":
                        text = (event.text or "").strip()
                        partial = ""
                        if text:
                            finals.append(text)
                            await send({"type": "final", "text": text})
                            maybe_score(force=True)
                    elif kind == "error":
                        await send({"type": "error", "message": getattr(event, "message", "STT error")})
                        if getattr(event, "is_fatal", False):
                            break
                    elif kind == "session.end":
                        break

            async def keepalive():
                while True:
                    await asyncio.sleep(15)
                    await stt.send_realtime_ping(RealtimePing())

            reader = asyncio.create_task(sarvam_to_browser())
            pinger = asyncio.create_task(keepalive())
            try:
                await browser_to_sarvam()
                # Give Sarvam a moment to return the last final transcript.
                await asyncio.wait_for(reader, timeout=5)
            except (asyncio.TimeoutError, WebSocketDisconnect):
                pass
            finally:
                reader.cancel()
                pinger.cancel()
    except Exception as e:
        await send({"type": "error", "message": f"speech connection failed: {e}"})
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# Frontend (built against CONTRACT.md). Mounted last so /ws and /health win.
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
