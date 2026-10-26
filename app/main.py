"""Kavach server: browser mic -> Sarvam realtime STT -> scam score -> spoken warning -> report."""

import asyncio
import base64
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sarvamai import AsyncSarvamAI, RealtimeAudioInput, RealtimeEnd, RealtimePing

from .report import build_report
from .scam import score_transcript
from .sessions import open_session, sessions
from .warning import get_warning, normalize_lang, speak, to_english

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

@asynccontextmanager
async def lifespan(_app):
    # Pre-render the Hindi + English warnings so the first alert on stage is instant.
    client = AsyncSarvamAI(api_subscription_key=API_KEY)
    for lang in ("hi-IN", "en-IN"):
        try:
            await get_warning(client, lang)
        except Exception:
            pass
    yield


app = FastAPI(title="Kavach", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


class SpeakRequest(BaseModel):
    text: str
    lang: str = "hi-IN"


@app.post("/api/speak")
async def speak_text(req: SpeakRequest):
    """Reads the suggested safe reply aloud, on tap."""
    client = AsyncSarvamAI(api_subscription_key=API_KEY)
    try:
        return {"audio": await speak(client, req.text[:500], req.lang)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/session/{sid}")
async def session_info(sid: str):
    s = sessions.get(sid.upper())
    return {"exists": bool(s), "live": bool(s and s.live), "lang": s.lang if s else None}


@app.websocket("/watch")
async def watch(websocket: WebSocket, session: str = ""):
    """Family view: mirrors a live call's events."""
    await websocket.accept()
    s = sessions.get(session.upper())
    if not s:
        await websocket.send_json({"type": "error", "message": "No call with that code."})
        await websocket.close()
        return
    await websocket.send_json({"type": "watching", "session": s.id, "lang": s.lang, "live": s.live})
    for msg in list(s.history):
        await websocket.send_json(msg)
    s.watchers.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep open; family pings are ignored
    except Exception:
        pass
    finally:
        s.watchers.discard(websocket)


@app.websocket("/ws")
async def call_stream(websocket: WebSocket, lang: str = "hi-IN"):
    await websocket.accept()
    lang = normalize_lang(lang)
    client = AsyncSarvamAI(api_subscription_key=API_KEY)
    session = await open_session(lang)
    started = time.monotonic()

    finals: list[str] = []
    partial = ""
    warned = False
    scoring = False
    last_scored_text = ""
    last_partial_score = 0.0
    last_score: dict | None = None
    background: set[asyncio.Task] = set()

    def elapsed() -> float:
        return round(time.monotonic() - started, 1)

    async def send(msg: dict):
        try:
            await websocket.send_json(msg)
        except Exception:
            pass
        await session.publish(msg)

    def spawn(coro):
        task = asyncio.create_task(coro)
        background.add(task)
        task.add_done_callback(background.discard)

    async def run_score():
        nonlocal scoring, warned, last_scored_text, last_score
        text = " ".join(finals[-TRANSCRIPT_WINDOW:] + ([partial] if partial else [])).strip()
        if not text or text == last_scored_text:
            scoring = False
            return
        last_scored_text = text
        try:
            result = await score_transcript(client, text, lang)
            last_score = result
            await send({"type": "score", "t": elapsed(), **result})
            if result["probability"] >= WARN_AT and not warned:
                warned = True
                warning_text, audio = await get_warning(client, lang)
                await send({"type": "warning", "text": warning_text, "audio": audio,
                            "probability": result["probability"], "t": elapsed()})
        except Exception as e:
            await send({"type": "error", "message": f"scoring failed: {e}", "fatal": False})
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
        spawn(run_score())

    async def translate_line(idx: int, text: str):
        english = await to_english(client, text)
        if english and english.strip().lower() != text.strip().lower():
            await send({"type": "translation", "idx": idx, "text": english})

    await send({"type": "session", "id": session.id, "lang": lang})

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
                        return False
                    if msg.get("bytes"):
                        audio = base64.b64encode(msg["bytes"]).decode()
                        await stt.send_realtime_audio_input(RealtimeAudioInput(audio=audio))
                    elif msg.get("text"):
                        try:
                            if json.loads(msg["text"]).get("type") == "stop":
                                break
                        except ValueError:
                            pass
                await stt.send_realtime_end(RealtimeEnd())
                return True

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
                            idx = len(finals) - 1
                            await send({"type": "final", "idx": idx, "text": text, "t": elapsed(),
                                        "language": getattr(event, "language", None)})
                            maybe_score(force=True)
                            spawn(translate_line(idx, text))
                    elif kind == "error":
                        fatal = bool(getattr(event, "is_fatal", False))
                        await send({"type": "error", "message": getattr(event, "message", "STT error"), "fatal": fatal})
                        if fatal:
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
                await asyncio.wait_for(reader, timeout=3)  # let the last sentence finalize
            except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError):
                pass
            finally:
                reader.cancel()
                pinger.cancel()

        # Post-call report (only if anything was said).
        if finals:
            # Let in-flight scoring/translation finish so the report sees the final score.
            if background:
                await asyncio.wait(list(background), timeout=4)
            await send({"type": "analyzing"})
            try:
                report = await build_report(client, " ".join(finals), last_score, lang)
                await send({"type": "report", **report, "duration": elapsed(),
                            "transcript": finals, "final_score": last_score})
                # Spoken version follows separately so the report shows up instantly.
                if report["summary_local"]:
                    try:
                        await send({"type": "report_audio", "audio": await speak(client, report["summary_local"], lang)})
                    except Exception:
                        pass
            except Exception as e:
                await send({"type": "error", "message": f"report failed: {e}", "fatal": False})
        await send({"type": "ended"})
    except Exception as e:
        await send({"type": "error", "message": f"speech connection failed: {e}", "fatal": True})
    finally:
        session.live = False
        for task in list(background):
            task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# Frontend. Mounted last so /ws, /watch and /api win.
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
