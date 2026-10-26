// Elder's screen: captures the call (mic or a demo recording), streams it live to /ws, renders events.
import { LANGS, audioHooks, mountDashboard, playB64, readHistory, toast } from "./ui.js";
import { runMock } from "./mock.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---- Controls ----
const langSel = $("lang");
langSel.innerHTML = LANGS.map(([c, native, en]) => `<option value="${c}">${native}${native !== en ? ` · ${en}` : ""}</option>`).join("");
langSel.value = params.get("lang") || store.get("kavach.lang", "hi-IN");
langSel.onchange = () => { store.set("kavach.lang", langSel.value); ui.setLang(langSel.value); };

let source = params.get("source") || store.get("kavach.source", "mic");
if (params.get("demo")) $("demo").value = params.get("demo");
function setSource(s) {
  source = s;
  store.set("kavach.source", s);
  document.querySelectorAll("#source button").forEach((b) => b.classList.toggle("on", b.dataset.src === s));
  $("demo-field").classList.toggle("hidden", s !== "demo");
}
document.querySelectorAll("#source button").forEach((b) => (b.onclick = () => !running && setSource(b.dataset.src)));
setSource(source);

const ui = mountDashboard($("dashboard"), { audience: "elder", lang: langSel.value, onAlarmDismiss: () => {} });

function setStatus(text, cls = "") {
  $("status-text").textContent = text;
  $("status").className = `pill ${cls}`;
}

// ---- Live session ----
let running = false;
let ws = null;
let ctx = null;
let micStream = null;
let demoSrc = null;
let demoGain = null;
let streaming = false;
let stopMock = null;

// While Kavach speaks, turn the demo "caller" down on the speakers only. Kavach itself keeps
// hearing the full call (so no words are missed); with the mic, browser echo cancellation
// keeps our own voice out of the transcript.
audioHooks.onStart = () => {
  if (demoGain && ctx) demoGain.gain.setTargetAtTime(0.15, ctx.currentTime, 0.05);
};
audioHooks.onEnd = () => {
  if (demoGain && ctx) demoGain.gain.setTargetAtTime(1, ctx.currentTime, 0.2);
};

function wsUrl(path) {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
}

async function start() {
  if (running) return;
  running = true;
  ui.reset();
  ui.setLang(langSel.value);
  $("go").disabled = true;
  setStatus("Connecting…", "connecting");

  if (MOCK) {
    stopMock = runMock(onEvent);
    setGo(true);
    return;
  }

  try {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("js/pcm-worklet.js");
    const pcm = new AudioWorkletNode(ctx, "pcm-16k");
    const sink = ctx.createGain();
    sink.gain.value = 0;
    pcm.connect(sink).connect(ctx.destination); // keeps the worklet pulled by the graph
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    ui.setAnalyser(analyser);

    pcm.port.onmessage = (e) => {
      if (streaming && ws?.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    let startDemo = null;
    if (source === "mic") {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mic = ctx.createMediaStreamSource(micStream);
      mic.connect(pcm);
      mic.connect(analyser);
    } else {
      const res = await fetch(`demo/${$("demo").value}.wav`);
      if (!res.ok) throw new Error("Demo call file missing");
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      startDemo = () => {
        demoSrc = ctx.createBufferSource();
        demoSrc.buffer = buf;
        demoGain = ctx.createGain(); // speaker volume only
        demoSrc.connect(demoGain).connect(ctx.destination); // you hear the "caller"
        demoSrc.connect(pcm); // Kavach hears it at full level
        demoSrc.connect(analyser);
        demoSrc.onended = () => setTimeout(() => running && stop(), 2500);
        demoSrc.start();
      };
    }

    ws = new WebSocket(wsUrl(`/ws?lang=${encodeURIComponent(langSel.value)}`));
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "ready") {
        streaming = true;
        startDemo?.();
      }
      onEvent(m);
    };
    ws.onclose = () => {
      if (running) {
        toast("Connection closed.", true);
        cleanup();
      }
    };
    ws.onerror = () => toast("Could not reach the Kavach server.", true);
    setGo(true);
  } catch (err) {
    toast(err.name === "NotAllowedError" ? "Microphone permission is needed to listen to the call." : `Could not start: ${err.message}`, true);
    cleanup();
  }
}

function onEvent(m) {
  if (m.type === "session") {
    $("code").textContent = m.id;
    $("share-btn").classList.remove("hidden");
  }
  if (m.type === "ready") setStatus(source === "demo" && !MOCK ? "Live · demo call" : "Live · listening", "live");
  if (m.type === "analyzing") setStatus("Analyzing call…", "connecting");
  if (m.type === "report") {
    ui.saveHistory();
    renderHistory();
  }
  if (m.type === "ended") cleanup();
  if (m.type === "error" && m.fatal) cleanup();
  ui.handle(m);
}

function stop() {
  if (!running) return;
  streaming = false;
  setStatus("Analyzing call…", "connecting");
  $("go").disabled = true;
  stopAudio();
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
  else cleanup();
  // Safety net: never hang if the server goes quiet.
  setTimeout(() => running && cleanup(), 25000);
}

function stopAudio() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  try { demoSrc && (demoSrc.onended = null, demoSrc.stop()); } catch {}
  demoSrc = null;
}

function cleanup() {
  running = false;
  streaming = false;
  stopMock?.();
  stopMock = null;
  stopAudio();
  const s = ws;
  ws = null;
  if (s && s.readyState <= 1) { s.onclose = null; s.close(); }
  ctx?.close().catch(() => {});
  ctx = null;
  demoGain = null;
  ui.setAnalyser(null);
  setStatus("Ready");
  setGo(false);
}

function setGo(isRunning) {
  const go = $("go");
  go.disabled = false;
  go.classList.toggle("stop", isRunning);
  go.innerHTML = isRunning ? "Stop and get report" : "Start listening";
}

$("go").onclick = () => (running ? stop() : start());

// ---- Safe reply: read aloud on tap ----
ui.onReplyPlay(async () => {
  const text = ui.replyText();
  if (!text) return;
  if (MOCK) return toast("Audio is off in offline demo mode.");
  try {
    const res = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: langSel.value }) });
    if (!res.ok) throw new Error();
    playB64((await res.json()).audio);
  } catch { toast("Could not play the reply.", true); }
});

// ---- Family sharing ----
$("share-btn").onclick = () => {
  const code = $("code").textContent;
  const link = `${location.origin}/family.html?code=${code}`;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="text-align:center">
    <h2>Let family watch live</h2>
    <div class="sub">They see the transcript, the risk meter and every alert, in real time.</div>
    <div class="qr" id="qr"></div>
    <div class="share-code">${code}</div>
    <div class="share-link">${link}</div>
    <div class="row" style="justify-content:center">
      <button class="btn blue" data-a="copy">Copy link</button>
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(`Watch my call live on Kavach: ${link}`)}" target="_blank" rel="noopener">Send on WhatsApp</a>
      <button class="btn" data-a="close">Close</button>
    </div></div>`;
  bg.onclick = (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (e.target === bg || a === "close") bg.remove();
    if (a === "copy") navigator.clipboard?.writeText(link).then(() => toast("Link copied"));
  };
  document.body.appendChild(bg);
  if (window.QRCode) new QRCode(bg.querySelector("#qr"), { text: link, width: 200, height: 200 });
  else bg.querySelector("#qr").remove();
};

// ---- History ----
function renderHistory() {
  const list = readHistory();
  $("history-list").innerHTML = list.length
    ? list.map((h) => `<div class="hist-item">
        <span class="verdict-badge ${h.verdict}">${h.verdict}</span>
        <span class="what">${h.type ? `${h.type} · ` : ""}peak ${h.peak}% — ${h.summary.replace(/</g, "&lt;")}</span>
        <span class="when">${new Date(h.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span></div>`).join("")
    : `<div class="empty" style="padding:20px">No calls yet.</div>`;
}
$("history-btn").onclick = () => {
  renderHistory();
  $("history").classList.toggle("hidden");
  $("history").scrollIntoView({ behavior: "smooth" });
};

if (MOCK) toast("Offline demo mode: scripted call, no mic or server.");
if (params.has("autostart")) start();
