// Offline demo: replays a scripted session through the same handler as the real socket.
// Open the page with ?mock=1. No mic, no network, no API key.

const S = (probability, scam_type, stage, reason, red_flags, safe_reply = "") =>
  ({ type: "score", probability, scam_type, stage, reason, red_flags, safe_reply });

const SCRIPT = [
  [300, { type: "session", id: "DEMO1", lang: "hi-IN" }],
  [600, { type: "ready" }],
  [1500, { type: "partial", text: "Hello kya main" }],
  [2400, { type: "partial", text: "Hello kya main Kamla ji se baat" }],
  [3600, { type: "final", idx: 0, t: 3.6, language: "hi-IN", text: "Hello क्या मैं कमला जी से बात कर रहा हूँ?" }],
  [3900, { ...S(5, "none", "contact", "Just a greeting so far.", []), t: 3.9 }],
  [4500, { type: "translation", idx: 0, text: "Hello, am I speaking to Kamla ji?" }],
  [5600, { type: "partial", text: "मैं Mumbai police cyber crime" }],
  [7200, { ...S(62, "fake_officer", "impersonation", "Caller claims to be from Mumbai police cyber crime.", ["claims police"]), t: 7.2 }],
  [8600, { type: "final", idx: 1, t: 8.6, language: "hi-IN", text: "मैं Mumbai police cyber crime branch से inspector Sharma बोल रहा हूँ।" }],
  [9000, { ...S(88, "digital_arrest", "impersonation", "Police impersonation is the classic opening of a digital arrest scam.",
    ["claims police", "cyber crime branch"], "मैं खुद पुलिस स्टेशन आकर बात करूँगी, अभी फ़ोन रख रही हूँ।"), t: 9.0 }],
  [9300, { type: "warning", t: 9.3, probability: 88, text: "अम्मा, यह फ्रॉड कॉल है। OTP मत बताना। कोई पैसे मत भेजना। अभी फ़ोन काट दो।", audio: null }],
  [9700, { type: "translation", idx: 1, text: "I am Inspector Sharma speaking from the Mumbai police cyber crime branch." }],
  [12000, { type: "partial", text: "आपके Aadhaar card से एक parcel" }],
  [15500, { type: "final", idx: 2, t: 15.5, language: "hi-IN", text: "आपके Aadhaar card से एक parcel भेजा गया है जिसमें drugs मिले हैं। आपके नाम पे FIR है।" }],
  [15900, { ...S(97, "digital_arrest", "fear", "Fake drugs-parcel case and FIR threat to scare the victim.",
    ["claims police", "drugs parcel", "FIR threat"], "मैं खुद पुलिस स्टेशन आकर बात करूँगी, अभी फ़ोन रख रही हूँ।"), t: 15.9 }],
  [16500, { type: "translation", idx: 2, text: "A parcel with drugs was sent using your Aadhaar card. There is an FIR in your name." }],
  [20500, { type: "final", idx: 3, t: 20.5, language: "hi-IN", text: "आप अभी digital arrest में हैं, यह बात किसी को मत बताना।" }],
  [20900, { ...S(99, "digital_arrest", "isolation", "Declares a 'digital arrest' and demands secrecy.",
    ["claims police", "drugs parcel", "digital arrest", "secrecy"], "मैं अपने बेटे से बात करके ही कुछ करूँगी।"), t: 20.9 }],
  [21500, { type: "translation", idx: 3, text: "You are under digital arrest right now, don't tell anyone about this." }],
  [25500, { type: "final", idx: 4, t: 25.5, language: "hi-IN", text: "Case clear करने के लिए OTP बताओ और safe account में पैसे transfer करो।" }],
  [25900, { ...S(100, "digital_arrest", "payment_demand", "Asks for OTP and money transfer to a 'safe account'.",
    ["digital arrest", "secrecy", "asks OTP", "money transfer"], "मैं कोई OTP या पैसे नहीं दूँगी। फ़ोन रख रही हूँ।"), t: 25.9 }],
  [26400, { type: "translation", idx: 4, text: "To clear the case, tell the OTP and transfer money to a safe account." }],
  [28500, { type: "analyzing" }],
  [30000, { type: "report", verdict: "scam", duration: 28.5, audio: null,
    summary_local: "यह कॉल एक डिजिटल अरेस्ट फ्रॉड था। असली पुलिस कभी फ़ोन पर OTP या पैसे नहीं माँगती। आपने सही किया कि फ़ोन काट दिया।",
    summary_en: "This was a digital arrest scam. Real police never ask for an OTP or money over the phone. You did the right thing by cutting the call.",
    next_steps: ["Do not call this number back.", "Block the number.", "If you shared money or an OTP, call 1930 right away and report at cybercrime.gov.in.", "Tell your family about this call."],
    transcript: [] }],
  [30100, { type: "ended" }],
];

export function runMock(handle) {
  const timers = SCRIPT.map(([ms, msg]) => setTimeout(() => handle(structuredClone(msg)), ms));
  return () => timers.forEach(clearTimeout);
}
