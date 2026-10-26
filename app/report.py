"""After the call: a short report in the user's language, spoken aloud, plus next steps."""

from sarvamai import AsyncSarvamAI

from .scam import LANG_NAMES, MODEL, parse_json

PROMPT = """A phone call just ended. Below is what the caller said, and Kavach's final scam score.
Write a short post-call report for an elderly person in India and their family.

Rules:
- "summary_local": 2-3 short, calm sentences in {lang} that the elderly person will HEAR read aloud.
  Say what the caller tried to do and what to do now. If it was a scam, reassure them that they did the right thing by checking.
- "summary_en": the same in simple English.
- "next_steps": 2-4 short English action items. For a scam include: do not call back; if money or an OTP was shared,
  call the national cyber crime helpline 1930 immediately and report at cybercrime.gov.in; block the number; tell family.
  For a safe call, return an empty list.
- "verdict": "scam", "suspicious", or "safe"."""

SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "call_report",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "verdict": {"type": "string", "enum": ["scam", "suspicious", "safe"]},
                "summary_local": {"type": "string"},
                "summary_en": {"type": "string"},
                "next_steps": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["verdict", "summary_local", "summary_en", "next_steps"],
            "additionalProperties": False,
        },
    },
}


async def build_report(client: AsyncSarvamAI, transcript: str, last_score: dict | None, lang: str) -> dict:
    score_line = (
        f"Final score: {last_score['probability']}/100, type: {last_score['scam_type']}, reason: {last_score['reason']}"
        if last_score else "No score."
    )
    response = await client.chat.completions(
        model=MODEL,
        reasoning_effort=None,
        temperature=0.2,
        max_tokens=700,
        response_format=SCHEMA,
        messages=[
            {"role": "system", "content": PROMPT.replace("{lang}", LANG_NAMES.get(lang, "Hindi"))},
            {"role": "user", "content": f"{score_line}\n\nCaller transcript:\n{transcript}"},
        ],
    )
    data = parse_json(response.choices[0].message.content)
    report = {
        "verdict": data.get("verdict", "suspicious"),
        "summary_local": str(data.get("summary_local", "")),
        "summary_en": str(data.get("summary_en", "")),
        "next_steps": [str(s) for s in data.get("next_steps", [])][:4],
    }
    return report
