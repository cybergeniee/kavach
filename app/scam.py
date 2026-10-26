"""Scores a live call transcript for scam likelihood with Sarvam-105B."""

import json

from sarvamai import AsyncSarvamAI

MODEL = "sarvam-105b-conversations"

LANG_NAMES = {
    "hi-IN": "Hindi", "en-IN": "English", "bn-IN": "Bengali", "ta-IN": "Tamil", "te-IN": "Telugu",
    "mr-IN": "Marathi", "gu-IN": "Gujarati", "kn-IN": "Kannada", "ml-IN": "Malayalam",
    "pa-IN": "Punjabi", "od-IN": "Odia",
}

SCAM_TYPES = [
    "none", "digital_arrest", "kyc_expiry", "fake_officer", "otp_request",
    "parcel_customs", "lottery_prize", "investment", "other",
]

# The classic scam script, in order. Shown live as a progress tracker.
STAGES = ["none", "contact", "impersonation", "fear", "isolation", "payment_demand"]

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
Only claiming to be from a bank, courier or company, with no threat, urgency or request yet, is at most 50.
If probability is 40 or more, scam_type must not be "none".

"stage" is the furthest step of the scam script the caller has reached:
none (normal call), contact (greeting/confirming identity), impersonation (claims authority or a company),
fear (threats, case, arrest, account blocked), isolation (secrecy, stay on call, don't tell family),
payment_demand (asks for OTP, money, app install, card details).

Keep "reason" to one short English sentence. "red_flags" are 0-4 very short English phrases.
"safe_reply" is ONE short, calm sentence the elderly person can say to the caller right now, written in {lang}
(e.g. tell them you will visit the police station yourself / will call the bank's official number). Empty string if the call looks safe."""


def _schema() -> dict:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "scam_score",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "probability": {"type": "integer", "minimum": 0, "maximum": 100},
                    "scam_type": {"type": "string", "enum": SCAM_TYPES},
                    "stage": {"type": "string", "enum": STAGES},
                    "reason": {"type": "string"},
                    "red_flags": {"type": "array", "items": {"type": "string"}},
                    "safe_reply": {"type": "string"},
                },
                "required": ["probability", "scam_type", "stage", "reason", "red_flags", "safe_reply"],
                "additionalProperties": False,
            },
        },
    }


def parse_json(content: str | None) -> dict:
    content = (content or "").strip()
    content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


async def score_transcript(client: AsyncSarvamAI, transcript: str, lang: str) -> dict:
    response = await client.chat.completions(
        model=MODEL,
        reasoning_effort=None,  # no thinking: we need speed mid-call
        temperature=0.1,
        max_tokens=400,
        response_format=_schema(),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.replace("{lang}", LANG_NAMES.get(lang, "Hindi"))},
            {"role": "user", "content": f"Transcript so far:\n{transcript}"},
        ],
    )
    data = parse_json(response.choices[0].message.content)

    probability = max(0, min(100, int(data.get("probability", 0))))
    scam_type = data.get("scam_type") if data.get("scam_type") in SCAM_TYPES else "other"
    if probability >= 40 and scam_type == "none":
        scam_type = "other"
    return {
        "probability": probability,
        "scam_type": scam_type,
        "stage": data.get("stage") if data.get("stage") in STAGES else "none",
        "reason": str(data.get("reason", "")),
        "red_flags": [str(f) for f in data.get("red_flags", [])][:4],
        "safe_reply": str(data.get("safe_reply", "")) if probability >= 40 else "",
    }
