// Family view: mirrors a live call by code over /watch.
import { mountDashboard, toast } from "./ui.js";
import { runMock } from "./mock.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let ui = null;
let ws = null;
let retries = 0;

function setStatus(text, cls = "") {
  $("status-text").textContent = text;
  $("status").className = `pill ${cls}`;
}

function watch(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return toast("The code has 5 letters/numbers.", true);
  history.replaceState(null, "", `?code=${code}`);
  $("join").classList.add("hidden");
  $("watching").classList.remove("hidden");
  $("code").textContent = code;
  if (!ui) ui = mountDashboard($("dashboard"), { audience: "family" });

  if (params.has("mock")) {
    setStatus("Live · demo", "live");
    runMock((m) => ui.handle(m));
    return;
  }
  connect(code);
}

function connect(code) {
  setStatus("Connecting…", "connecting");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/watch?session=${code}`);
  let ended = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "watching") {
      retries = 0;
      ui.reset();
      ui.setLang(m.lang);
      ui.setQuiet(!m.live); // don't fire an old alarm for a call that already ended
      setStatus(m.live ? "Live · watching" : "Call ended", m.live ? "live" : "");
      return;
    }
    if (m.type === "error" && !ui.state.sessionId && m.message?.includes("code")) {
      toast(m.message, true);
      ended = true;
      setStatus("Not connected");
      $("join").classList.remove("hidden");
      $("watching").classList.add("hidden");
      return;
    }
    if (m.type === "ended") {
      ended = true;
      setStatus("Call ended");
    }
    ui.handle(m);
  };
  ws.onclose = () => {
    if (ended) return;
    if (retries++ < 5) {
      setStatus("Reconnecting…", "connecting");
      setTimeout(() => connect(code), 1500 * retries);
    } else setStatus("Disconnected");
  };
}

$("join-form").onsubmit = (e) => {
  e.preventDefault();
  watch($("code-input").value);
};

// Browsers block sound until a tap; one tap here unlocks alert beeps.
$("sound-btn").onclick = () => {
  try { new AudioContext().resume(); } catch {}
  $("sound-btn").textContent = "Alert sound on";
};

if (params.get("code")) watch(params.get("code"));
else if (params.has("mock")) watch("DEMO1");
