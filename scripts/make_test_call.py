"""Makes test_call.wav: a fake Hinglish scam call spoken by Bulbul (16 kHz mono PCM).
Lets you test the live pipeline without a second person. Run once."""

import base64
import io
import os
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sarvamai import SarvamAI

ROOT = Path(__file__).resolve().parent.parent
for line in (ROOT / ".env").read_text().splitlines():
    k, sep, v = line.partition("=")
    if sep:
        os.environ.setdefault(k.strip(), v.strip())

LINES = [
    "Hello, kya main Kamla ji se baat kar raha hoon?",
    "Main Mumbai police cyber crime branch se Inspector Sharma bol raha hoon.",
    "Aapke Aadhaar card se ek parcel bheja gaya hai jisme drugs mile hain. Aapke naam pe FIR hai.",
    "Aap abhi digital arrest mein hain. Yeh baat kisi ko mat batana, warna turant giraftaar honge.",
    "Case clear karne ke liye aapke phone pe ek OTP aayega, woh mujhe batao aur safe account mein paise transfer karo.",
]

client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])
frames = b""
silence = b"\x00\x00" * 16000 * 1  # 1 s pause between sentences
for line in LINES:
    tts = client.text_to_speech.convert(
        text=line, language_code="hi-IN", model="bulbul:v3", speaker="aditya",
        speech_sample_rate=16000, output_audio_codec="wav",
    )
    with wave.open(io.BytesIO(base64.b64decode(tts.audios[0]))) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
        frames += w.readframes(w.getnframes()) + silence

out = ROOT / "scripts" / "test_call.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(frames)
print(f"wrote {out} ({len(frames) / 32000:.1f}s)")
