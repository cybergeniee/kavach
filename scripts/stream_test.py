"""Streams a 16 kHz mono WAV into the running server in real time, like a live mic,
and prints every event. Usage: python scripts/stream_test.py [wav] [ws-url]"""

import asyncio
import json
import sys
import time
import wave
from pathlib import Path

import websockets

WAV = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).with_name("test_call.wav"))
URL = sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:8000/ws?lang=hi-IN"
CHUNK = 3200  # 100 ms


async def main():
    with wave.open(WAV) as w:
        pcm = w.readframes(w.getnframes())
    start = time.monotonic()
    async with websockets.connect(URL, max_size=None) as ws:
        first = json.loads(await ws.recv())
        if first["type"] != "ready":
            sys.exit(f"server said: {first}")
        print("[ready] streaming...")

        async def sender():
            for i in range(0, len(pcm), CHUNK):
                await ws.send(pcm[i:i + CHUNK])
                await asyncio.sleep(0.1)
            await asyncio.sleep(3)  # trailing silence so the last sentence finalizes
            await ws.send(json.dumps({"type": "stop"}))

        async def receiver():
            async for raw in ws:
                m = json.loads(raw)
                t = f"{time.monotonic() - start:5.1f}s"
                if m["type"] == "warning":
                    print(f"{t} WARNING: {m['text']} (audio {len(m['audio'])} b64 chars)")
                elif m["type"] == "score":
                    print(f"{t} SCORE {m['probability']:3d} {m['scam_type']}: {m['reason']}")
                elif m["type"] in ("final", "error"):
                    print(f"{t} {m['type'].upper()}: {m.get('text') or m.get('message')}")

        await asyncio.gather(sender(), receiver())


asyncio.run(main())
