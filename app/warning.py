"""Speech output: the spoken scam warning (Sarvam Translate + Bulbul), and a general speak()."""

from sarvamai import AsyncSarvamAI

LANGUAGES = ["hi-IN", "en-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "gu-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN"]

ENGLISH = "This is a fraud call. Do not share your OTP. Do not send any money. Cut the call now."
HINDI = "अम्मा, यह फ्रॉड कॉल है। OTP मत बताना। कोई पैसे मत भेजना। अभी फ़ोन काट दो।"

_cache: dict[str, tuple[str, str]] = {}


def normalize_lang(lang: str) -> str:
    return lang if lang in LANGUAGES else "hi-IN"


async def speak(client: AsyncSarvamAI, text: str, lang: str) -> str:
    """Text -> base64 WAV with Bulbul v3 (covers all 11 languages, incl. Malayalam and Odia)."""
    tts = await client.text_to_speech.convert(
        text=text[:2400],
        language_code=normalize_lang(lang),
        model="bulbul:v3",
        speaker="priya",
        pace=0.95,
        speech_sample_rate=22050,
        output_audio_codec="wav",
    )
    return tts.audios[0]


async def _warning_text(client: AsyncSarvamAI, lang: str) -> tuple[str, str]:
    if lang == "hi-IN":
        return HINDI, lang
    if lang == "en-IN":
        return ENGLISH, lang
    try:
        result = await client.text.translate(
            input=ENGLISH, source_language_code="en-IN", target_language_code=lang,
        )
        return result.translated_text, lang
    except Exception:
        return ENGLISH, "en-IN"


async def get_warning(client: AsyncSarvamAI, lang: str) -> tuple[str, str]:
    """Returns (warning text, base64 WAV audio). Cached per language."""
    lang = normalize_lang(lang)
    if lang not in _cache:
        text, tts_lang = await _warning_text(client, lang)
        _cache[lang] = (text, await speak(client, text, tts_lang))
    return _cache[lang]


async def to_english(client: AsyncSarvamAI, text: str) -> str | None:
    """English subtitle for a transcript line (for judges / family abroad)."""
    try:
        result = await client.text.translate(
            input=text[:900], source_language_code="auto", target_language_code="en-IN",
        )
        return result.translated_text
    except Exception:
        return None
