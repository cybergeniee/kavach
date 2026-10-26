"""Generates the demo calls in static/demo/ with Bulbul (16 kHz mono PCM WAV).
The page can play these through the live pipeline, so you can demo without a second person."""

import base64
import io
import os
import wave
from pathlib import Path

from sarvamai import SarvamAI

ROOT = Path(__file__).resolve().parent.parent
for line in (ROOT / ".env").read_text().splitlines():
    k, sep, v = line.partition("=")
    if sep:
        os.environ.setdefault(k.strip(), v.strip())

CALLS = {
    "digital_arrest_hinglish": ("hi-IN", "aditya", [
        "Hello, kya main Kamla ji se baat kar raha hoon?",
        "Main Mumbai police cyber crime branch se Inspector Sharma bol raha hoon.",
        "Aapke Aadhaar card se ek parcel bheja gaya hai jisme drugs mile hain. Aapke naam pe FIR hai.",
        "Aap abhi digital arrest mein hain. Yeh baat kisi ko mat batana, warna turant giraftaar honge.",
        "Case clear karne ke liye aapke phone pe ek OTP aayega, woh mujhe batao aur safe account mein paise transfer karo.",
    ]),
    "kyc_tamil": ("ta-IN", "rahul", [
        "வணக்கம், நான் SBI வங்கியிலிருந்து பேசுகிறேன்.",
        "உங்கள் KYC காலாவதியாகிவிட்டது. இன்று மாலைக்குள் உங்கள் கணக்கு முடக்கப்படும்.",
        "உங்கள் மொபைலுக்கு ஒரு OTP வரும். அதை உடனே எனக்கு சொல்லுங்கள், இல்லையென்றால் பணம் போய்விடும்.",
    ]),
    "customs_english": ("en-IN", "rohan", [
        "Good afternoon madam, this is calling from FedEx courier, Mumbai.",
        "A parcel in your name to Taiwan was stopped by customs. It has five fake passports and drugs inside.",
        "I am connecting you to the CBI officer now. Please do not disconnect and do not tell your family.",
        "To avoid arrest you must pay a verification fee of fifty thousand rupees on UPI right now.",
    ]),
    "safe_grandson": ("hi-IN", "kabir", [
        "Hello Dadi, main Rohan bol raha hoon. Kaisi ho aap?",
        "Kal shaam ko main aur Mummy aapse milne aayenge.",
        "Aapne aaj ki dawai li na? Aur kuch chahiye toh bata dena, main le aaunga.",
    ]),
}

client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])
silence = b"\x00\x00" * 16000  # 1 s pause between sentences
for name, (lang, speaker, lines) in CALLS.items():
    frames = b""
    for line in lines:
        tts = client.text_to_speech.convert(
            text=line, language_code=lang, model="bulbul:v3", speaker=speaker,
            speech_sample_rate=16000, output_audio_codec="wav",
        )
        with wave.open(io.BytesIO(base64.b64decode(tts.audios[0]))) as w:
            assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
            frames += w.readframes(w.getnframes()) + silence
    out = ROOT / "static" / "demo" / f"{name}.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(frames)
    print(f"{out.name}: {len(frames) / 32000:.1f}s")
