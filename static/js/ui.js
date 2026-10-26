// Shared dashboard: meter, scam stages, safe reply, live transcript, timeline, alarm, report.
// Driven entirely by server events (see CONTRACT.md) via ui.handle(msg).

export const LANGS = [
  ["hi-IN", "हिन्दी", "Hindi"], ["en-IN", "English", "English"], ["bn-IN", "বাংলা", "Bengali"],
  ["ta-IN", "தமிழ்", "Tamil"], ["te-IN", "తెలుగు", "Telugu"], ["mr-IN", "मराठी", "Marathi"],
  ["gu-IN", "ગુજરાતી", "Gujarati"], ["kn-IN", "ಕನ್ನಡ", "Kannada"], ["ml-IN", "മലയാളം", "Malayalam"],
  ["pa-IN", "ਪੰਜਾਬੀ", "Punjabi"], ["od-IN", "ଓଡ଼ିଆ", "Odia"],
];
const LANG_NAME = Object.fromEntries(LANGS.map(([c, , en]) => [c, en]));
LANG_NAME["or-IN"] = "Odia";

const SCAM_LABEL = {
  none: "Looks like a normal call", digital_arrest: "“Digital arrest” scam", kyc_expiry: "Fake KYC / account block",
  fake_officer: "Fake officer / impersonation", otp_request: "OTP theft attempt", parcel_customs: "Fake parcel / customs case",
  lottery_prize: "Lottery / prize scam", investment: "Investment scam", family_emergency: "Fake family emergency",
  remote_access: "Remote-access / refund scam", electricity_bill: "Fake electricity cut", sim_block: "Fake SIM-block / TRAI",
  job_task: "Fake job / task scam", wrong_transfer: "“Money sent by mistake” scam", other: "Suspicious call",
};
const STAGES = [
  ["contact", "Contact"], ["impersonation", "Fake identity"], ["fear", "Threats"],
  ["isolation", "Isolation"], ["payment_demand", "Asks OTP / money"],
];
const HOT_WORDS = [
  "otp", "cbi", "police", "arrest", "digital arrest", "kyc", "aadhaar", "aadhar", "pan card", "parcel", "drugs", "customs",
  "fir", "upi", "cvv", "pin", "anydesk", "teamviewer", "safe account", "transfer", "fine", "warrant", "rbi", "trai",
  "money laundering", "passports?", "blocked?", "verification fee", "court",
  "गिरफ्तार", "पुलिस", "पैसे", "खाता", "अरेस्ट", "ओटीपी", "मत बताना", "किसी को",
];
const HOT_RE = new RegExp(`(${HOT_WORDS.map((w) => (/^[a-z ]/i.test(w) ? `\\b${w}\\b` : w)).join("|")})`, "gi");

const GAUGE_LEN = Math.PI * 140;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const highlight = (s) => esc(s).replace(HOT_RE, "<mark>$1</mark>");
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function toast(text, isErr = false) {
  const el = document.createElement("div");
  el.className = `toast${isErr ? " err" : ""}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3500);
}

// ---- Audio playback (base64 WAV) with a hook so the mic can be muted meanwhile ----
let currentAudio = null;
export const audioHooks = { onStart: () => {}, onEnd: () => {} };
export function playB64(b64) {
  return new Promise((resolve) => {
    if (!b64) return resolve();
    if (currentAudio) currentAudio.pause();
    const a = new Audio(`data:audio/wav;base64,${b64}`);
    currentAudio = a;
    const done = () => { if (currentAudio === a) currentAudio = null; audioHooks.onEnd(); resolve(); };
    a.onended = done;
    a.onerror = done;
    audioHooks.onStart();
    a.play().catch(done);
  });
}
function speakFallback(text, lang) {
  if (!("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function mountDashboard(root, opts = {}) {
  const audience = opts.audience || "elder"; // "elder" | "family"
  const EMPTY_HTML = audience === "family"
    ? "Waiting for words on the call…"
    : "Press <b>Start listening</b> and put the call on speaker.<br>Kavach understands Hindi, English, Tamil, and mixed speech.";
  root.innerHTML = `
  <div class="grid">
    <div class="col">
      <section class="card meter-card">
        <h3>Scam risk <span class="tag" id="k-updated"></span></h3>
        <svg class="gauge" viewBox="0 0 320 180" aria-hidden="true">
          <path class="track" d="M20 160 A140 140 0 0 1 300 160" fill="none" stroke-width="22" stroke-linecap="round"/>
          <path class="fill" id="k-arc" d="M20 160 A140 140 0 0 1 300 160" fill="none" stroke-width="22" stroke-linecap="round"
                stroke-dasharray="${GAUGE_LEN}" stroke-dashoffset="${GAUGE_LEN}"/>
        </svg>
        <div class="score-num" id="k-score" aria-live="polite">0<small>%</small></div>
        <div class="verdict" id="k-verdict">Waiting for the call</div>
        <div class="scam-type" id="k-type"></div>
        <div class="reason" id="k-reason"></div>
        <div class="flags" id="k-flags"></div>
      </section>

      <section class="card">
        <h3>Scam script tracker</h3>
        <div class="stages" id="k-stages">
          ${STAGES.map(([k, l]) => `<div class="stage" data-stage="${k}"><div class="bar"></div>${l}</div>`).join("")}
        </div>
      </section>

      <section class="card reply-card hidden" id="k-reply-card">
        <h3>${audience === "family" ? "Kavach is telling her to say" : "Say this to the caller"}</h3>
        <div class="reply-text" id="k-reply"></div>
        <button class="btn green" id="k-reply-play">🔊 Read it to me</button>
      </section>
    </div>

    <div class="col">
      <section class="card">
        <div class="viz">
          <canvas id="k-viz" width="800" height="108"></canvas>
          <div class="lang" id="k-lang">Language: auto</div>
        </div>
      </section>

      <section class="card transcript-card">
        <h3>Live call transcript <span class="tag">with English subtitles</span></h3>
        <div class="transcript" id="k-transcript">
          <div class="empty" id="k-empty">${EMPTY_HTML}</div>
        </div>
      </section>

      <section class="card timeline">
        <h3>Risk over the call <span class="tag" id="k-peak"></span></h3>
        <svg viewBox="0 0 600 110" preserveAspectRatio="none" id="k-timeline">
          <defs><linearGradient id="riskGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#ef4444" stop-opacity=".45"/><stop offset="100%" stop-color="#ef4444" stop-opacity="0"/>
          </linearGradient></defs>
          <line class="grid-line" x1="0" x2="600" y1="33" y2="33"/>
          <line class="grid-line" x1="0" x2="600" y1="66" y2="66"/>
          <path class="area" id="k-area" d=""/>
          <path class="path" id="k-path" d=""/>
          <g id="k-marks"></g>
        </svg>
      </section>
    </div>
  </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const state = {};
  let level = 0; // 0..1 for the visualizer when no analyser is attached
  let analyser = null;
  let lang = opts.lang || "hi-IN";
  let quiet = false; // suppress alarm (e.g. family joined after the call ended)

  function reset() {
    Object.assign(state, {
      scores: [], warnedAt: null, peak: 0, lines: new Map(), partialEl: null, probability: 0,
      transcript: [], english: {}, lastScore: null, warning: null, report: null, sessionId: null, started: Date.now(),
    });
    $("k-transcript").innerHTML = "";
    $("k-transcript").appendChild(Object.assign(document.createElement("div"), { className: "empty", id: "k-empty", innerHTML: EMPTY_HTML }));
    setScore({ probability: 0, scam_type: "none", stage: "none", reason: "", red_flags: [], safe_reply: "" }, true);
    $("k-verdict").textContent = "Waiting for the call";
    $("k-type").textContent = "";
    $("k-lang").textContent = "Language: auto";
    $("k-path").setAttribute("d", "");
    $("k-area").setAttribute("d", "");
    $("k-marks").innerHTML = "";
    $("k-peak").textContent = "";
    $("k-updated").textContent = "";
  }

  function riskClass(p) {
    document.body.classList.toggle("risk-mid", p >= 40 && p < 70);
    document.body.classList.toggle("risk-high", p >= 70);
  }

  function setScore(s, silent = false) {
    const p = s.probability;
    state.probability = p;
    $("k-arc").setAttribute("stroke-dashoffset", GAUGE_LEN * (1 - p / 100));
    animateNumber($("k-score"), p);
    riskClass(p);
    $("k-verdict").textContent = p >= 70 ? "⚠ SCAM LIKELY" : p >= 40 ? "Suspicious — be careful" : "Looks safe so far";
    $("k-type").textContent = p >= 40 ? SCAM_LABEL[s.scam_type] || "" : "";
    $("k-reason").textContent = s.reason || "";
    const flags = $("k-flags");
    const existing = new Set([...flags.children].map((c) => c.textContent));
    const next = new Set(p >= 40 ? s.red_flags : []);
    [...flags.children].forEach((c) => { if (!next.has(c.textContent)) c.remove(); });
    next.forEach((f) => { if (!existing.has(f)) flags.appendChild(Object.assign(document.createElement("span"), { className: "flag", textContent: f })); });

    const idx = STAGES.findIndex(([k]) => k === s.stage);
    root.querySelectorAll(".stage").forEach((el, i) => {
      el.classList.toggle("done", p >= 40 && i <= idx);
      el.classList.toggle("current", p >= 40 && i === idx);
    });

    const card = $("k-reply-card");
    if (s.safe_reply) {
      $("k-reply").textContent = s.safe_reply;
      card.classList.remove("hidden");
    } else if (silent) card.classList.add("hidden");
    if (!silent) $("k-updated").textContent = "updated just now";
  }

  function animateNumber(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 700);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el.innerHTML = `${v}<small>%</small>`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function drawTimeline() {
    const pts = state.scores;
    if (!pts.length) return;
    const maxT = Math.max(20, pts[pts.length - 1].t + 2);
    const x = (t) => (t / maxT) * 600;
    const y = (p) => 106 - (p / 100) * 100;
    let d = `M0 ${y(0)}`;
    for (const s of pts) d += ` L${x(s.t).toFixed(1)} ${y(s.p).toFixed(1)}`;
    $("k-path").setAttribute("d", d);
    $("k-area").setAttribute("d", `${d} L${x(pts[pts.length - 1].t).toFixed(1)} 110 L0 110 Z`);
    $("k-marks").innerHTML = state.warnedAt != null
      ? `<line class="warn-mark" x1="${x(state.warnedAt)}" x2="${x(state.warnedAt)}" y1="0" y2="110"/><text x="${x(state.warnedAt) + 4}" y="12">warned at ${fmtT(state.warnedAt)}</text>`
      : "";
    $("k-peak").textContent = `peak ${state.peak}%`;
  }

  function hideEmpty() { $("k-empty")?.remove(); }

  function scrollDown() {
    const box = $("k-transcript");
    box.scrollTop = box.scrollHeight;
  }

  function showPartial(text) {
    hideEmpty();
    if (!text) { state.partialEl?.remove(); state.partialEl = null; return; }
    if (!state.partialEl) {
      state.partialEl = document.createElement("div");
      state.partialEl.className = "line partial";
      state.partialEl.innerHTML = `<div class="meta"><span>speaking…</span></div><div class="txt"></div>`;
      $("k-transcript").appendChild(state.partialEl);
    }
    state.partialEl.querySelector(".txt").innerHTML = highlight(text);
    level = Math.min(1, level + 0.35);
    scrollDown();
  }

  function addFinal(m) {
    hideEmpty();
    state.partialEl?.remove();
    state.partialEl = null;
    state.transcript[m.idx] = m.text;
    const el = document.createElement("div");
    el.className = "line";
    const lg = m.language ? `<span class="lg">${esc(LANG_NAME[m.language] || m.language)}</span>` : "";
    el.innerHTML = `<div class="meta"><span>${m.t != null ? fmtT(m.t) : ""}</span>${lg}</div><div class="txt">${highlight(m.text)}</div><div class="en"></div>`;
    if (HOT_RE.test(m.text)) el.classList.add("hot");
    HOT_RE.lastIndex = 0;
    state.lines.set(m.idx, el);
    $("k-transcript").appendChild(el);
    if (m.language) $("k-lang").textContent = `Caller speaking: ${LANG_NAME[m.language] || m.language}`;
    if (state.english[m.idx]) el.querySelector(".en").textContent = state.english[m.idx];
    scrollDown();
  }

  function addTranslation(m) {
    state.english[m.idx] = m.text;
    const el = state.lines.get(m.idx);
    if (el) el.querySelector(".en").textContent = `“${m.text}”`;
  }

  // ---- Alarm overlay ----
  function showAlarm(m) {
    if (quiet) return;
    document.querySelector(".alarm")?.remove();
    const fam = audience === "family";
    const div = document.createElement("div");
    div.className = "alarm";
    div.setAttribute("role", "alertdialog");
    div.innerHTML = `<div class="alarm-inner">
      <div class="big-icon">🚨</div>
      <h1>${esc(fam ? "Scam call in progress!" : m.text)}</h1>
      <div class="alarm-en">${fam
        ? `Kavach has already warned her: “${esc(m.text)}”. Call her now.`
        : "This is a fraud call. Do not share any OTP. Do not send money. Cut the call."}</div>
      <div class="alarm-score">Scam risk ${m.probability}% · ${esc(SCAM_LABEL[state.lastScore?.scam_type] || "Scam")}</div>
      <div class="actions">
        <button class="btn" data-a="ok">${fam ? "OK, calling her" : "✋ I cut the call"}</button>
        ${m.audio ? `<button class="btn ghost" data-a="replay">🔊 Hear again</button>` : ""}
      </div></div>`;
    div.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (a === "replay") playB64(m.audio);
      if (a === "ok") { div.remove(); opts.onAlarmDismiss?.(); }
    });
    document.body.appendChild(div);
    navigator.vibrate?.([500, 200, 500, 200, 800]);
    if (!fam) {
      if (m.audio) playB64(m.audio);
      else speakFallback(m.text, lang);
    } else beep();
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      [0, 0.35, 0.7].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.25);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.3);
      });
    } catch {}
  }

  // ---- Report modal ----
  function showReport(r) {
    state.report = r;
    document.querySelector(".modal-bg.report")?.remove();
    const bg = document.createElement("div");
    bg.className = "modal-bg report";
    const peak = state.peak;
    const scam = r.verdict !== "safe";
    bg.innerHTML = `<div class="modal">
      <span class="verdict-badge ${esc(r.verdict)}">${r.verdict === "scam" ? "Scam call" : r.verdict === "suspicious" ? "Suspicious call" : "Safe call"}</span>
      <h2>Call report</h2>
      <div class="sub">${new Date().toLocaleString()}${state.sessionId ? ` · code ${esc(state.sessionId)}` : ""}</div>
      <div class="stats">
        <div class="stat"><b>${fmtT(r.duration || 0)}</b><span>call length</span></div>
        <div class="stat"><b style="color:${peak >= 70 ? "var(--danger)" : peak >= 40 ? "var(--warn)" : "var(--safe)"}">${peak}%</b><span>peak risk</span></div>
        <div class="stat"><b>${state.warnedAt != null ? fmtT(state.warnedAt) : "—"}</b><span>warned at</span></div>
      </div>
      <div class="summary-local">${esc(r.summary_local)}</div>
      <div class="summary-en">${esc(r.summary_en)}</div>
      <div class="row"><button class="btn green ${r.audio ? "" : "hidden"}" data-a="play" id="k-play-summary">🔊 Play summary</button></div>
      ${r.next_steps?.length ? `<ul class="steps">${r.next_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${scam ? `<div class="helpline"><div><div style="font-size:13px;opacity:.8">National Cyber Crime Helpline</div>
        <div class="num"><a href="tel:1930">1930</a></div></div>
        <div style="flex:1;font-size:14px">Lost money or shared an OTP? Call within the first hour, the “golden hour”, to freeze the money.<br>
        <a href="https://cybercrime.gov.in" target="_blank" rel="noopener">Report at cybercrime.gov.in →</a></div></div>` : ""}
      <div class="row">
        <button class="btn blue" data-a="download">⬇ Download report</button>
        <button class="btn" data-a="whatsapp">Share on WhatsApp</button>
        <button class="btn" data-a="close" style="margin-left:auto">Close</button>
      </div></div>`;
    bg.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (e.target === bg || a === "close") bg.remove();
      if (a === "play") playB64(state.report?.audio);
      if (a === "download") downloadReport();
      if (a === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, "_blank");
    });
    document.body.appendChild(bg);
  }

  function addReportAudio(audio) {
    if (!state.report) return;
    state.report.audio = audio;
    document.getElementById("k-play-summary")?.classList.remove("hidden");
    if (audience === "elder" && document.querySelector(".modal-bg.report")) playB64(audio);
  }

  function shareText() {
    const r = state.report || {};
    const s = state.lastScore || {};
    return `🛡 Kavach call report: ${(r.verdict || "").toUpperCase()} (peak risk ${state.peak}%)\n` +
      `${SCAM_LABEL[s.scam_type] || ""}\n${r.summary_en || ""}\n` +
      (r.verdict !== "safe" ? "If money or an OTP was shared, call 1930 now / cybercrime.gov.in" : "");
  }

  function downloadReport() {
    const r = state.report || {};
    const s = state.lastScore || {};
    const lines = [
      "KAVACH — CALL REPORT", `Date: ${new Date().toLocaleString()}`, `Verdict: ${r.verdict}`,
      `Peak scam risk: ${state.peak}%`, `Type: ${SCAM_LABEL[s.scam_type] || "-"}`,
      `Warned at: ${state.warnedAt != null ? fmtT(state.warnedAt) : "not needed"}`, `Call length: ${fmtT(r.duration || 0)}`, "",
      "SUMMARY", r.summary_local || "", r.summary_en || "", "",
      "RED FLAGS", ...(s.red_flags || []).map((f) => `- ${f}`), "",
      "NEXT STEPS", ...(r.next_steps || []).map((f) => `- ${f}`), "",
      "WHAT THE CALLER SAID",
      ...(r.transcript || state.transcript).map((t, i) => `[${i + 1}] ${t}${state.english[i] ? `\n    EN: ${state.english[i]}` : ""}`),
      "", "Helpline: 1930 · https://cybercrime.gov.in",
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    a.download = `kavach-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    a.click();
  }

  // ---- Visualizer ----
  const canvas = $("k-viz");
  const g = canvas.getContext("2d");
  const freq = new Uint8Array(64);
  (function draw() {
    const W = canvas.width, H = canvas.height, bars = 48;
    g.clearRect(0, 0, W, H);
    const color = getComputedStyle(document.body).getPropertyValue("--risk").trim() || "#22c55e";
    if (analyser) analyser.getByteFrequencyData(freq);
    level *= 0.92;
    for (let i = 0; i < bars; i++) {
      let v;
      if (analyser) v = freq[Math.floor((i / bars) * 40) + 2] / 255;
      else v = level * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.7 + performance.now() / 180)));
      const h = Math.max(4, v * H);
      g.fillStyle = color;
      g.globalAlpha = 0.35 + v * 0.65;
      const bw = W / bars;
      g.beginPath();
      g.roundRect(i * bw + 2, (H - h) / 2, bw - 4, h, 3);
      g.fill();
    }
    g.globalAlpha = 1;
    requestAnimationFrame(draw);
  })();

  function handle(m) {
    switch (m.type) {
      case "session": state.sessionId = m.id; break;
      case "partial": showPartial(m.text); break;
      case "final": addFinal(m); break;
      case "translation": addTranslation(m); break;
      case "score": {
        state.lastScore = m;
        state.peak = Math.max(state.peak, m.probability);
        state.scores.push({ t: m.t ?? (Date.now() - state.started) / 1000, p: m.probability });
        setScore(m);
        drawTimeline();
        break;
      }
      case "warning":
        state.warnedAt = m.t ?? (Date.now() - state.started) / 1000;
        state.warning = m;
        drawTimeline();
        showAlarm(m);
        break;
      case "analyzing": $("k-verdict").textContent = "Preparing call report…"; break;
      case "report":
        $("k-verdict").textContent = m.verdict === "scam" ? "⚠ This was a scam call" : m.verdict === "suspicious" ? "Suspicious call" : "✓ Safe call";
        showReport(m);
        break;
      case "report_audio": addReportAudio(m.audio); break;
      case "error": toast(m.message, true); break;
    }
  }

  reset();
  return {
    handle, reset, state,
    setAnalyser: (a) => { analyser = a; },
    setLang: (l) => { lang = l; },
    setQuiet: (q) => { quiet = q; },
    replyText: () => $("k-reply").textContent,
    onReplyPlay: (fn) => $("k-reply-play").addEventListener("click", fn),
    saveHistory() {
      if (!state.report) return;
      try {
        const list = JSON.parse(localStorage.getItem("kavach.history") || "[]");
        list.unshift({ at: Date.now(), verdict: state.report.verdict, peak: state.peak,
          type: SCAM_LABEL[state.lastScore?.scam_type] || "", summary: state.report.summary_en });
        localStorage.setItem("kavach.history", JSON.stringify(list.slice(0, 20)));
      } catch {}
    },
  };
}

export function readHistory() {
  try { return JSON.parse(localStorage.getItem("kavach.history") || "[]"); } catch { return []; }
}
