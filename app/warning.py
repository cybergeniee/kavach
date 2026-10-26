"""Builds the spoken warning in the user's language with Sarvam Translate + Bulbul."""

from sarvamai import AsyncSarvamAI

LANGUAGES = ["hi-IN", "en-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "gu-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN"]

ENGLISH = "This is a fraud call. Do not share your OTP. Do not send any money. Cut the call now."
HINDI = "अम्मा, यह फ्रॉड कॉल है। OTP मत बताना। कोई पैसे मत भेजना। अभी फ़ोन काट दो।"

_cache: dict[str, tuple[str, str]] = {}


async def _warning_text(client: AsyncSarvamAI, lang: str) -> str:
    if lang == "hi-IN":
        return HINDI
    if lang == "en-IN":
        return ENGLISH
    try:
        result = await client.text.translate(
            input=ENGLISH, source_language_code="en-IN", target_language_code=lang,
        )
        return result.translated_text
    except Exception:
        return ENGLISH


async def get_warning(client: AsyncSarvamAI, lang: str) -> tuple[str, str]:
    """Returns (warning text, base64 WAV audio). Cached per language."""
    if lang not in LANGUAGES:
        lang = "hi-IN"
    if lang in _cache:
        return _cache[lang]

    text = await _warning_text(client, lang)
    tts_lang = lang if text != ENGLISH else "en-IN"
    tts = await client.text_to_speech.convert(
        text=text,
        language_code=tts_lang,
        model="bulbul:v3",  # v3 covers all 11 languages, incl. Malayalam and Odia
        speaker="priya",
        pace=0.95,
        speech_sample_rate=22050,
        output_audio_codec="wav",
    )
    _cache[lang] = (text, tts.audios[0])
    return _cache[lang]
