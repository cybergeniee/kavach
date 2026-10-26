"""Scores a live call transcript for scam likelihood with Sarvam-105B."""

import json

from sarvamai import AsyncSarvamAI

SCAM_TYPES = [
    "none", "digital_arrest", "kyc_expiry", "fake_officer", "otp_request",
    "parcel_customs", "lottery_prize", "investment", "other",
]

SYSTEM_PROMPT = """You protect elderly people in India from phone scams.
You get a live, possibly incomplete transcript of what a CALLER is saying. It may be in Hindi, English, any Indian language, or a mix.
Rate how likely this call is a scam, from 0 to 100.

Strong scam signs:
- "Digital arrest": caller says you are under arrest/investigation and must stay on video call or not tell family.
- Claims to be CBI, police, customs, TRAI, RBI, income tax, court, or a bank officer.
- KYC/PAN/Aadhaar "expired" or "blocked", account will be closed.
- Asks for OTP, PIN, CVV, passwords, screen-sharing apps (AnyDesk, TeamViewer), or to install an app.
- Parcel with drugs/passports in your name, money laundering case, SIM will be blocked.
- Asks to transfer money to a "safe account", pay a fine, fee, or "verification" amount.
- Urgency, threats, secrecy ("don't tell anyone").
- Lottery, prize, refund, or too-good investment returns.

Normal calls (family, friends, delivery confirmations without payment, doctors) should score low.
Do not overreact to one neutral sentence. Score high only when the signs are clear.
Keep "reason" to one short English sentence. "red_flags" are 0-4 very short phrases."""

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "scam_score",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "probability": {"type": "integer", "minimum": 0, "maximum": 100},
                "scam_type": {"type": "string", "enum": SCAM_TYPES},
                "reason": {"type": "string"},
                "red_flags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["probability", "scam_type", "reason", "red_flags"],
            "additionalProperties": False,
        },
    },
}


async def score_transcript(client: AsyncSarvamAI, transcript: str) -> dict:
    response = await client.chat.completions(
        model="sarvam-105b-conversations",
        reasoning_effort=None,  # no thinking: we need speed mid-call
        temperature=0.1,
        max_tokens=300,
        response_format=RESPONSE_FORMAT,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Transcript so far:\n{transcript}"},
        ],
    )
    content = response.choices[0].message.content or ""
    # Tolerate stray code fences around the JSON.
    content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    data = json.loads(content)

    probability = max(0, min(100, int(data.get("probability", 0))))
    scam_type = data.get("scam_type") if data.get("scam_type") in SCAM_TYPES else "other"
    return {
        "probability": probability,
        "scam_type": scam_type,
        "reason": str(data.get("reason", "")),
        "red_flags": [str(f) for f in data.get("red_flags", [])][:4],
    }
