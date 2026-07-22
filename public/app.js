"use strict";
/* COPYCAT 😼 ChatGPT App クライアント
 * - ChatGPT Appsのウィジェット内だけで動作する
 * - 自動マッチングはWorker API、友だち部屋はwindow.openai.callTool、ゲーム進行はWebSocket
 * - APIキーもローカルブリッジも不要。AI相談はChatGPTの会話へ送る
 * - UI・内蔵お題は5言語対応。同じカードを各自の言語で表示する
 */

// ---- 環境 -------------------------------------------------------------------

const ORIGIN = (typeof window.__ORIGIN__ === "string" && window.__ORIGIN__) || location.origin;
const WS_ORIGIN = ORIGIN.replace(/^http/, "ws");
const LOCAL_PREVIEW = ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).get("preview") === "1";
const IN_CHATGPT = (typeof window.openai !== "undefined" && !!window.openai) || LOCAL_PREVIEW;
const INITIAL_TOOL_OUTPUT = (window.openai && window.openai.toolOutput) || {};
const CUSTOM_COPY = INITIAL_TOOL_OUTPUT.uiCopy && typeof INITIAL_TOOL_OUTPUT.uiCopy === "object"
  ? INITIAL_TOOL_OUTPUT.uiCopy
  : null;
const CUSTOM_TOPIC = INITIAL_TOOL_OUTPUT.topicCopy && typeof INITIAL_TOOL_OUTPUT.topicCopy === "object"
  ? INITIAL_TOOL_OUTPUT.topicCopy
  : null;
const CUSTOM_LOCALE = CUSTOM_COPY ? String(INITIAL_TOOL_OUTPUT.locale || "en") : null;
const CUSTOM_LANGUAGE_NAME = CUSTOM_COPY ? String(INITIAL_TOOL_OUTPUT.languageName || CUSTOM_LOCALE) : null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---- 言語 -------------------------------------------------------------------

const URL_PARAMS = new URLSearchParams(location.search);

function detectLang() {
  if (CUSTOM_LOCALE) return CUSTOM_LOCALE;
  const saved = URL_PARAMS.get("lang") || store.get("cc_lang");
  if (saved && I18N[saved]) return saved;
  const host = (document.documentElement.lang || navigator.language || "en").toLowerCase();
  const nav = host.split("-")[0];
  for (const l of SUPPORTED_LANGS) if (nav.startsWith(l)) return l;
  return "en";
}
let LANG = detectLang();

function gameLang() {
  const lang = String(LANG || "en").trim().slice(0, 35);
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang) ? lang.toLowerCase() : "en";
}

function t(key, vars) {
  let s = (CUSTOM_COPY && CUSTOM_COPY[key]) ?? (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// 多言語マップ({ja:"…",en:"…"} または文字列)を自分の言語で解決
function loc(m) {
  if (m == null) return "?";
  if (typeof m === "string") return m;
  return m[LANG] ?? m.en ?? m.ja ?? Object.values(m)[0] ?? "?";
}

// サーバー配信のbuiltinIdを自分の言語のタイトル+16語に解決
function resolveTopic(pub) {
  if (!pub) return null;
  if (CUSTOM_TOPIC && Number(CUSTOM_TOPIC.builtinId) === Number(pub.builtinId) &&
      Array.isArray(CUSTOM_TOPIC.words) && CUSTOM_TOPIC.words.length === 16) {
    return { title: CUSTOM_TOPIC.title, words: CUSTOM_TOPIC.words, source: "chatgpt" };
  }
  const bt = TOPICS[pub.builtinId] || TOPICS[0];
  return { title: loc(bt.title), words: bt.words.map(loc), source: "builtin" };
}

// ---- 状態 -------------------------------------------------------------------

const S = {
  screen: "home",          // home | matching | game
  code: null,
  ws: null,
  wsAlive: false,
  room: null,
  you: null,
  toolBusy: false,
  joinError: null,
  reconnectTimer: null,
  matchTimer: null,
  translationRequests: new Set(),
  match: { ticket: null, players: 1, needed: 2, status: "idle", fallbackInMs: 10000, cpuPlayers: 0 },
};

let myPid = URL_PARAMS.get("pid") || store.get("cc_pid");
if (!myPid) {
  myPid = "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set("cc_pid", myPid);
}
let myName = (URL_PARAMS.get("n") || store.get("cc_name") || "").trim().slice(0, 12);

// 自分用: ChatGPTの会話にヒント相談を送る。API呼び出しはアプリ側では行わない。
async function suggestHint() {
  const r = S.room, y = S.you;
  const rt = resolveTopic(r && r.topic);
  if (!rt || !y) return;
  const isCopycat = y.role === "copycat";
  const roleText = isCopycat
    ? "I am the Copycat and do not know the secret word. Suggest one plausible bluff hint."
    : `The secret word is "${rt.words[y.secretIndex]}". Suggest one subtle hint without saying the word itself.`;
  await window.openai.sendFollowUpMessage({
    prompt: `Help me with my COPYCAT turn. Category: "${rt.title}". Candidates: ${rt.words.join(", ")}. ${roleText} Reply with only one word in ${LANG_NAMES_EN[LANG] || LANG}.`,
    scrollToBottom: true,
  });
  toast(t("consultSent"));
}

async function requestChatGptCpuTurn() {
  if (!window.openai || typeof window.openai.sendFollowUpMessage !== "function" || !S.code) return;
  await window.openai.sendFollowUpMessage({
    prompt: `Operate the ChatGPT CPU players for COPYCAT room ${S.code}. Repeatedly call get_copycat_cpu_turn with room_code ${S.code}, reason privately and fairly from only the returned role/context, then call submit_copycat_cpu_turn with the matching action. Continue until get_copycat_cpu_turn returns pending=false. Never reveal any CPU's private role, secret word, or chain-of-thought in chat; only briefly confirm when the pending turns are complete.`,
    scrollToBottom: true,
  });
  toast(t("cpuTurnSent"));
}

async function requestTranslation() {
  if (!window.openai || typeof window.openai.sendFollowUpMessage !== "function") return;
  const topic = S.room && S.room.topic ? resolveTopic(S.room.topic) : null;
  const topicPayload = topic && S.room.topic
    ? { builtinId: S.room.topic.builtinId, title: topic.title, words: topic.words }
    : null;
  await window.openai.sendFollowUpMessage({
    prompt: `Localize the COPYCAT widget. If the target language is not already clear from our conversation, ask me which language I want. Then translate every value in the supplied English UI object, preserving every {placeholder} and simple HTML tag exactly, and call localize_copycat once. Pass room_code=${S.code || ""}, a BCP 47 locale, language_name, the complete translated object as ui_copy, and topic_copy when supplied. Do not summarize instead of calling the tool. English UI JSON: ${JSON.stringify(I18N.en)}. Current topic JSON: ${JSON.stringify(topicPayload)}.`,
    scrollToBottom: true,
  });
  toast(t("translateSent"));
}

function untranslatedHints() {
  const target = gameLang();
  return (S.room?.hints || []).filter((hint) =>
    hint.pid !== S.you?.pid && hint.sourceLang && hint.sourceLang !== target && !hint.translatedWord);
}

async function requestHintTranslations(force = false) {
  if (!window.openai || typeof window.openai.sendFollowUpMessage !== "function" || !S.code || !S.you) return;
  const hints = untranslatedHints();
  if (!hints.length) return;
  const key = `${S.code}:${S.room.round}:${gameLang()}`;
  if (!force && S.translationRequests.has(key)) return;
  S.translationRequests.add(key);
  render();
  const languageName = (LANG === CUSTOM_LOCALE && CUSTOM_LANGUAGE_NAME) || LANG_NAMES_EN[LANG] || LANG;
  try {
    await window.openai.sendFollowUpMessage({
      prompt: `Translate the public one-word hints in COPYCAT room ${S.code} into ${languageName} (${gameLang()}). Preserve names and player ids; do not explain or reveal roles. Call translate_copycat_hints exactly once with room_code=${S.code}, requester_pid=${S.you.pid}, target_locale=${gameLang()}, and one translation for every supplied foreign-language hint. Keep each translation concise and natural for the game. Hints JSON: ${JSON.stringify(hints.map((hint) => ({ pid: hint.pid, source_locale: hint.sourceLang, original: hint.word })))}`,
      scrollToBottom: false,
    });
    toast(t("hintTranslationSent"));
  } catch {
    S.translationRequests.delete(key);
    render();
  }
}

function maybeRequestHintTranslations() {
  if (["vote", "guess", "reveal"].includes(S.room?.phase)) void requestHintTranslations(false);
}

// ---- WebSocket ----------------------------------------------------------------

function wsSend(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(obj));
}

function joinRoom(code) {
  code = code.toUpperCase().trim();
  if (!/^[A-Z0-9]{4}$/.test(code)) { toast(t("code4")); return; }
  const name = currentName();
  if (!name) { toast(t("enterName")); return; }
  myName = name;
  clearTimeout(S.matchTimer);
  S.matchTimer = null;
  if (!URL_PARAMS.get("n")) store.set("cc_name", name);
  S.code = code;
  S.screen = "game";
  S.joinError = null;
  connect();
  render();
}

async function openRoomWithChatGPT(code) {
  if (!IN_CHATGPT || typeof window.openai.callTool !== "function") {
    toast(t("chatgptOnlyTitle"));
    return;
  }
  const name = currentName();
  if (!name) { toast(t("enterName")); return; }
  S.toolBusy = true;
  render();
  try {
    const args = code ? { room_code: code.toUpperCase().trim() } : { action: "private" };
    const result = await window.openai.callTool("open_copycat", args);
    const output = result && result.structuredContent;
    if (!output || !output.roomCode) throw new Error(t("createFail"));
    joinRoom(output.roomCode);
  } catch (error) {
    toast(error && error.message ? error.message : t("createFail"));
  } finally {
    S.toolBusy = false;
    render();
  }
}

function connect() {
  if (S.ws) { try { S.ws.onclose = null; S.ws.close(); } catch {} }
  const ws = new WebSocket(`${WS_ORIGIN}/ws/${S.code}`);
  S.ws = ws;
  ws.onopen = () => {
    S.wsAlive = true;
    ws.send(JSON.stringify({ type: "hello", pid: myPid, name: myName || "?", lang: gameLang() }));
    render();
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "state") {
      S.room = msg.state;
      S.you = msg.you;
      render();
      maybeRequestHintTranslations();
    } else if (msg.type === "toast") {
      toast(msg.code ? t(msg.code) : msg.message);
    } else if (msg.type === "reject") {
      S.joinError = t("joinErr_" + (msg.code || "no_room"));
      S.screen = "home";
      S.room = null;
      render();
    } else if (msg.type === "error") {
      toast(msg.message);
    }
  };
  ws.onclose = () => {
    S.wsAlive = false;
    if (S.screen === "game") {
      render();
      clearTimeout(S.reconnectTimer);
      S.reconnectTimer = setTimeout(() => { if (S.screen === "game") connect(); }, 2000);
    }
  };
}

async function createRoom() {
  await openRoomWithChatGPT("");
}

async function startMatchmaking(mode = "online") {
  const cpu = mode !== "online";
  const name = currentName();
  if (!name) { toast(t("enterName")); return; }
  myName = name;
  store.set("cc_name", name);
  S.screen = "matching";
  S.match = { ticket: null, players: 1, needed: 2, status: "connecting", fallbackInMs: cpu ? 0 : 10000, cpuPlayers: 0 };
  render();

  try {
    const response = await fetch(`${ORIGIN}/api/match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: myPid, name: myName, lang: gameLang(), cpu, cpuMode: mode === "chatgpt" ? "chatgpt" : "rule" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("matchFail"));
    handleMatchStatus(data);
  } catch (error) {
    S.screen = "home";
    render();
    toast(error && error.message ? error.message : t("matchFail"));
  }
}

function handleMatchStatus(data) {
  if (data.status === "matched" && data.roomCode) {
    S.match = {
      ...S.match,
      status: "matched",
      players: 3,
      needed: 0,
      cpuPlayers: Math.max(0, Number(data.cpuPlayers) || 0),
      cpuMode: data.cpuMode || null,
    };
    render();
    setTimeout(() => joinRoom(data.roomCode), 350);
    return;
  }
  if (data.status !== "waiting" || !data.ticket) {
    cancelMatchmaking(false);
    toast(t("matchExpired"));
    return;
  }
  S.match = {
    ticket: data.ticket,
    status: "waiting",
    players: Math.max(1, Number(data.players) || 1),
    needed: Math.max(1, Number(data.needed) || 1),
    fallbackInMs: Math.max(0, Number(data.fallbackInMs) || 0),
    cpuPlayers: 0,
  };
  render();
  clearTimeout(S.matchTimer);
  S.matchTimer = setTimeout(pollMatchmaking, 1100);
}

async function pollMatchmaking() {
  if (S.screen !== "matching" || !S.match.ticket) return;
  try {
    const response = await fetch(`${ORIGIN}/api/match/${S.match.ticket}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "expired");
    S.match.pollFails = 0;
    handleMatchStatus(data);
  } catch {
    // 一時的な失敗(電波・タイミング)で即諦めない
    S.match.pollFails = (S.match.pollFails || 0) + 1;
    if (S.match.pollFails <= 2 && S.screen === "matching" && S.match.ticket) {
      clearTimeout(S.matchTimer);
      S.matchTimer = setTimeout(pollMatchmaking, 1100);
      return;
    }
    cancelMatchmaking(false);
    toast(t("matchExpired"));
  }
}

function cancelMatchmaking(notifyServer = true) {
  const ticket = S.match.ticket;
  clearTimeout(S.matchTimer);
  S.matchTimer = null;
  S.match = { ticket: null, players: 1, needed: 2, status: "idle", fallbackInMs: 10000, cpuPlayers: 0 };
  S.screen = "home";
  render();
  if (notifyServer && ticket) {
    fetch(`${ORIGIN}/api/match/${ticket}`, { method: "DELETE", keepalive: true }).catch(() => {});
  }
}

// ---- 画面 -----------------------------------------------------------------------

const app = document.getElementById("app");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function currentName() {
  const el = document.getElementById("name-input");
  return (el ? el.value.trim().slice(0, 12) : "") || myName;
}

function dispName(p) {
  return p.name;
}

let toastTimer = null;
function toast(text) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 3500);
}

// 再描画で入力中のテキストとフォーカスを失わないための保存/復元
function render() {
  const saved = {};
  let focusId = null, selStart = null;
  app.querySelectorAll("input, select").forEach((el) => {
    if (el.id) saved[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
  });
  const ae = document.activeElement;
  if (ae && ae.id && app.contains(ae)) { focusId = ae.id; selStart = ae.selectionStart; }

  app.innerHTML = S.screen === "home" ? viewHome() : S.screen === "matching" ? viewMatching() : viewGame();

  for (const [id, val] of Object.entries(saved)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox" || el.type === "radio") el.checked = val;
    else if (!el.dataset.keep) el.value = val;
  }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch {} }
  }
}

function langSelectHtml(cls) {
  const languages = CUSTOM_LOCALE
    ? [...SUPPORTED_LANGS, CUSTOM_LOCALE]
    : SUPPORTED_LANGS;
  return `
    <select id="lang-select" class="${cls || ""}" data-action-change="lang" aria-label="${esc(t("langLabel"))}">
      ${languages.map((l) => `<option value="${l}" ${l === LANG ? "selected" : ""}>${esc(l === CUSTOM_LOCALE ? CUSTOM_LANGUAGE_NAME : LANG_NAMES[l])}</option>`).join("")}
    </select>
  `;
}

// ---- home -----------------------------------------------------------------------

function viewHome() {
  if (!IN_CHATGPT) {
    return `
      <div class="app-only">
        <div class="logo-cat"><img class="mascot-image" src="${ORIGIN}/assets/copycat-mascot-512.png" alt=""></div>
        <h1 class="logo">COPYCAT</h1>
        <div class="card center mt">
          <h2>${esc(t("chatgptOnlyTitle"))}</h2>
          <div class="small">${esc(t("chatgptOnlyBody"))}</div>
        </div>
        <nav class="legal-links" aria-label="COPYCAT information">
          <a href="${ORIGIN}/support">Support</a>
          <a href="${ORIGIN}/privacy">Privacy</a>
          <a href="${ORIGIN}/terms">Terms</a>
        </nav>
      </div>`;
  }
  const gptCode = window.openai && window.openai.toolOutput && window.openai.toolOutput.roomCode || "";
  const prefill = gptCode.toUpperCase();
  return `
    <div class="home-top">
      <div class="brand-mini"><img src="${ORIGIN}/assets/copycat-mascot-512.png" alt=""> COPYCAT</div>
      ${langSelectHtml("lang-home")}
    </div>
    <div class="hero">
      <div class="logo-cat" aria-hidden="true"><img class="mascot-image" src="${ORIGIN}/assets/copycat-mascot-512.png" alt=""></div>
      <p class="eyebrow">ONLINE SOCIAL GAME</p>
      <h1 class="logo">COPYCAT</h1>
      <p class="tagline">${t("tagline")}</p>
    </div>
    ${S.joinError ? `<div class="card error-card">${esc(S.joinError)}</div>` : ""}
    <div class="card action-card">
      <label class="field-label" for="name-input">${esc(t("nameLabel"))}</label>
      <input type="text" id="name-input" maxlength="12" autocomplete="nickname" placeholder="${esc(t("namePh"))}" value="${esc(myName)}">
      ${gptCode ? `
        <button class="primary wide" data-action="join-prepared" data-code="${esc(gptCode)}">${esc(t("joinPrepared", { code: gptCode }))}</button>
      ` : `
        <button class="primary wide match-button" data-action="match">
          <span>${esc(t("match"))}</span><small>${esc(t("matchSub"))}</small>
        </button>
        <button class="cpu-button chatgpt-cpu wide" data-action="chatgpt-cpu-match">
          <span aria-hidden="true">✦</span><span><b>${esc(t("playChatGptCpu"))}</b><small>${esc(t("playChatGptCpuSub"))}</small></span>
        </button>
        <button class="cpu-button wide" data-action="cpu-match">
          <span aria-hidden="true">⚡</span><span><b>${esc(t("practiceCpu"))}</b><small>${esc(t("practiceCpuSub"))}</small></span>
        </button>
        <div class="or"><span>${esc(t("orFriends"))}</span></div>
        <div class="row code-row">
          <input type="text" id="join-code" aria-label="${esc(t("codePh"))}" placeholder="${esc(t("codePh"))}" maxlength="4" style="text-transform:uppercase" value="${esc(prefill)}">
          <button class="secondary fit" data-action="join" ${S.toolBusy ? "disabled" : ""}>${esc(t("join"))}</button>
        </div>
        <button class="text-button wide" data-action="create" ${S.toolBusy ? "disabled" : ""}>${esc(S.toolBusy ? t("toolBusy") : t("createPrivate"))}</button>
      `}
    </div>
    <button class="text-button wide translate-button" data-action="translate">${esc(t("translateWithChatGpt"))}</button>
    <div class="privacy-note"><span aria-hidden="true">🔒</span>${t("freeBlurb")}</div>
  `;
}

function viewMatching() {
  const found = Math.min(3, S.match.players || 1);
  const fallbackSeconds = Math.max(1, Math.ceil((S.match.fallbackInMs || 0) / 1000));
  const matchedCopy = S.match.cpuPlayers > 0
    ? t("cpuJoined", { n: S.match.cpuPlayers })
    : t("joiningMatch");
  return `
    <div class="matching-screen">
      <button class="close-button" data-action="cancel-match" aria-label="${esc(t("cancel"))}">×</button>
      <div class="match-orbit ${S.match.status === "matched" ? "is-matched" : ""}" aria-hidden="true">
        <div class="match-core"><img src="${ORIGIN}/assets/copycat-mascot-512.png" alt=""></div>
        <span class="orbit-dot dot-one"></span>
        <span class="orbit-dot dot-two"></span>
        <span class="orbit-dot dot-three"></span>
      </div>
      <p class="eyebrow">MATCHMAKING</p>
      <h1>${esc(S.match.status === "matched" ? t("matchFound") : t("searching"))}</h1>
      <p class="matching-copy">${esc(S.match.status === "matched" ? matchedCopy : t("searchingSub"))}</p>
      <div class="match-progress" role="status" aria-live="polite">
        <div class="match-avatars">
          ${[0, 1, 2].map((i) => `<span class="match-avatar ${i < found ? "found" : ""}">${i === 0 ? "😼" : i < found ? "●" : ""}</span>`).join("")}
        </div>
        <strong>${esc(t("playersFound", { n: found }))}</strong>
        <span>${esc(found >= 3 ? t("ready") : t("cpuFallback", { n: fallbackSeconds }))}</span>
      </div>
      <button class="text-button" data-action="cancel-match">${esc(t("cancel"))}</button>
    </div>`;
}

// ---- game -----------------------------------------------------------------------

function viewGame() {
  const r = S.room;
  if (!r) {
    return `<div class="waiting"><span class="spin">😼</span> ${esc(t("connecting", { code: S.code || "" }))}</div>`;
  }
  let body = "";
  if (r.phase === "lobby") body = viewLobby();
  else if (r.phase === "hint") body = viewHint();
  else if (r.phase === "vote") body = viewVote();
  else if (r.phase === "guess") body = viewGuess();
  else if (r.phase === "reveal") body = viewReveal();

  return `
    <div class="header">
      <span class="logo-s">😼</span>
      <span class="code-chip">${esc(r.code)}</span>
      <span class="phase-chip">${esc(t("phase_" + r.phase))}${r.round ? ` · ${t("round", { n: r.round })}` : ""}</span>
      <span class="spacer"></span>
      ${S.wsAlive ? "" : `<span class="small danger-text">${esc(t("reconnecting"))}</span>`}
    </div>
    ${body}
    ${viewPlayers()}
  `;
}

function viewLobby() {
  const r = S.room, y = S.you;
  const humans = r.players.filter((p) => !p.isAI).length;
  const isHost = y && y.isHost;
  const shareText = t("shareChat", { code: r.code });
  return `
    <div class="card center">
      <div class="small">${esc(t("shareCode"))}</div>
      <div class="mt"><span class="code-badge">${esc(r.code)}</span></div>
      <button class="ghost wide mt" data-action="copy-link" data-url="${esc(shareText)}">${esc(t("copyLink"))}</button>
    </div>
    <div class="card">
      <h2>${esc(t("rulesTitle"))}</h2>
      <div class="small">${t("rulesText")}</div>
    </div>
    ${isHost ? `
    <div class="card">
      <button class="primary wide mt" data-action="start" ${r.players.length >= 3 ? "" : "disabled"}>
        ${r.players.length >= 3 ? esc(t("start")) : esc(t("needMore", { n: 3 - r.players.length }))}
      </button>
    </div>` : `
    <div class="card"><div class="waiting">${esc(t("waitingHost", { n: humans }))}</div></div>`}
  `;
}

function gridHtml({ clickable = false } = {}) {
  const r = S.room, y = S.you;
  const rt = resolveTopic(r.topic);
  if (!rt) return "";
  const secretIdx = y && y.secretIndex != null ? y.secretIndex : (r.secret != null ? r.secret : -1);
  const wrongIdx = r.result && r.result.guessIndex != null && !r.result.guessedRight ? r.result.guessIndex : -1;
  return `
    <div class="topic-title">${esc(t("topicLabel"))}: <b>${esc(rt.title)}</b></div>
    <div class="grid">
      ${rt.words.map((w, i) => `
        <div class="cell ${i === secretIdx ? "secret" : ""} ${i === wrongIdx ? "guessed-wrong" : ""} ${clickable ? "clickable" : ""}"
             ${clickable ? `data-action="guess" data-index="${i}"` : ""}>${esc(w)}</div>`).join("")}
    </div>
  `;
}

function roleBanner() {
  const y = S.you, r = S.room;
  if (!y || !y.role) return "";
  if (y.role === "copycat") {
    return `<div class="role-banner copycat"><span class="big">${esc(t("youAreCopycat"))}</span><br>${esc(t("copycatDesc"))}</div>`;
  }
  const rt = resolveTopic(r.topic);
  const w = rt ? rt.words[y.secretIndex] : "";
  return `<div class="role-banner citizen">${esc(t("secretIs"))} <span class="secret-word">${esc(w)}</span><br>
    <span class="small">${esc(t("secretNote"))}</span></div>`;
}

function hintCopyHtml(hint) {
  if (!hint.translatedWord) return `<span class="hint-copy"><span class="word">"${esc(hint.word)}"</span></span>`;
  const sourceName = LANG_NAMES[hint.sourceLang] || hint.sourceLang;
  return `<span class="hint-copy">
    <span class="word">"${esc(hint.translatedWord)}"</span>
    <span class="hint-original">${esc(t("originalHint", { word: hint.word, language: sourceName }))}</span>
  </span>`;
}

function hintTranslationControl() {
  if (!untranslatedHints().length) return "";
  const key = `${S.code}:${S.room.round}:${gameLang()}`;
  const requested = S.translationRequests.has(key);
  return `<div class="translation-control" role="status">
    <span>${esc(t(requested ? "hintTranslationWorking" : "hintTranslationAvailable"))}</span>
    <button class="text-button" data-action="translate-hints">${esc(t(requested ? "retryTranslation" : "translateHints"))}</button>
  </div>`;
}

function viewHint() {
  const r = S.room, y = S.you;
  const mine = r.players.find((p) => p.pid === y.pid);
  const submitted = mine && mine.hasHint;
  const done = r.players.filter((p) => p.hasHint).length;
  return `
    ${roleBanner()}
    ${gridHtml()}
    <div class="card">
      <h2>${esc(t("hintHeader", { done, total: r.players.length }))}</h2>
      ${submitted ? `<div class="waiting">${esc(t("submittedWait"))}</div>` : `
        <div class="row">
          <input type="text" id="hint-input" maxlength="15" placeholder="${esc(t("hintPh"))}">
          <button class="primary fit" data-action="hint">${esc(t("submit"))}</button>
        </div>
        <button class="ghost wide mt" data-action="suggest">${esc(t("consultAI"))}</button>
        ${y.role === "copycat" ? `<div class="small mt center">${esc(t("consultNote"))}</div>` : ""}
      `}
      ${hasPendingChatGptCpu(r) ? chatGptCpuControl() : ""}
    </div>
  `;
}

function viewVote() {
  const r = S.room, y = S.you;
  const mine = r.players.find((p) => p.pid === y.pid);
  const voted = mine && mine.hasVoted;
  const done = r.players.filter((p) => p.hasVoted).length;
  return `
    ${roleBanner()}
    ${gridHtml()}
    <div class="card">
      <h2>${esc(t("voteHeader", { done, total: r.players.length }))}</h2>
      <div class="hint-list">
        ${(r.hints || []).map((h) => {
          const self = h.pid === y.pid;
          return `<div class="hint-card ${!voted && !self ? "votable" : ""}" ${!voted && !self ? `data-action="vote" data-pid="${esc(h.pid)}"` : ""}>
            ${hintCopyHtml(h)}
            <span class="by">${esc(h.name)}${h.isAI ? ` · ${esc(t("cpuTag"))}` : ""}${self ? esc(t("selfMark")) : ""}</span>
          </div>`;
        }).join("")}
      </div>
      ${hintTranslationControl()}
      ${voted ? `<div class="waiting">${esc(t("votedWait"))}</div>` : ""}
      ${hasPendingChatGptCpu(r) ? chatGptCpuControl() : ""}
    </div>
  `;
}

function viewGuess() {
  const r = S.room, y = S.you;
  const iAmCham = y.role === "copycat";
  return `
    <div class="result-banner lose">
      <div class="title">${esc(t("caughtTitle"))}</div>
      <div class="small">${esc(t("caughtSub"))}</div>
    </div>
    ${iAmCham ? `
      <div class="role-banner copycat">${esc(t("guessPrompt"))}</div>
      ${gridHtml({ clickable: true })}
    ` : `
      ${gridHtml()}
      <div class="waiting"><span class="spin">😼</span> ${esc(t("guessWait"))}</div>
      ${hasPendingChatGptCpu(r) ? chatGptCpuControl() : ""}
    `}
    <div class="card">
      <div class="hint-list">
        ${(r.hints || []).map((h) => `<div class="hint-card">${hintCopyHtml(h)}<span class="by">${esc(h.name)}</span></div>`).join("")}
      </div>
      ${hintTranslationControl()}
    </div>
  `;
}

function viewReveal() {
  const r = S.room, y = S.you;
  const res = r.result;
  const rt = resolveTopic(r.topic);
  const cham = r.players.find((p) => p.pid === r.chameleon);
  const chamName = cham ? dispName(cham) : "?";
  const secretWord = rt && r.secret != null ? rt.words[r.secret] : "?";
  const iAmCham = y.pid === r.chameleon;
  let title, cls, detail;
  if (!res.caught) {
    title = iAmCham ? t("escCham") : t("escOthers");
    cls = iAmCham ? "win" : "lose";
    detail = res.votedOut === null ? t("tieDetail") : t("wrongAccuseDetail");
  } else if (res.guessedRight) {
    title = iAmCham ? t("cbgYou") : t("cbgOthers");
    cls = iAmCham ? "win" : "lose";
    detail = t("guessedDetail", { word: secretWord });
  } else {
    title = iAmCham ? t("loseYou") : t("winOthers");
    cls = iAmCham ? "lose" : "win";
    detail = res.guessIndex != null && rt ? t("wrongGuessDetail", { word: rt.words[res.guessIndex] }) : "";
  }
  return `
    <div class="result-banner ${cls}">
      <div class="title">${esc(title)}</div>
      <div>${esc(t("copycatWas", { name: chamName }))}</div>
      <div class="small mt">${esc(t("secretWordLabel"))}: <b class="accent-text">${esc(secretWord)}</b>${detail ? " · " + esc(detail) : ""}</div>
    </div>
    ${gridHtml()}
    <div class="card">
      <h2>${esc(t("hintsTitle"))}</h2>
      <div class="hint-list">
        ${(r.hints || []).map((h) => {
          const n = Object.values(r.votes || {}).filter((v) => v === h.pid).length;
          return `<div class="hint-card ${h.pid === r.chameleon ? "was-copycat" : ""}">
            ${hintCopyHtml(h)}
            ${h.pid === r.chameleon ? "😼" : ""}
            <span class="by">${esc(h.name)}</span>
            ${n ? `<span class="votes">${esc(t("votesN", { n }))}</span>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${hintTranslationControl()}
    </div>
    ${y.isHost ? `<button class="primary wide" data-action="start">${esc(t("nextRound"))}</button>`
               : `<div class="waiting">${esc(t("waitingNext"))}</div>`}
  `;
}

function viewPlayers() {
  const r = S.room;
  return `
    <div class="card">
      <h2>${esc(t("playersTitle"))} (${r.players.length})</h2>
      <div class="players">
        ${r.players.map((p) => `
          <div class="player ${p.connected ? "" : "offline"}">
            <span class="dot"></span>
            <span class="name">${esc(dispName(p))}</span>
            ${p.pid === r.hostPid ? `<span class="tag">${esc(t("hostTag"))}</span>` : ""}
            ${p.pid === S.you.pid ? `<span class="tag">${esc(t("youTag"))}</span>` : ""}
            ${p.isAI ? `<span class="tag cpu-tag">${esc(t(p.cpuMode === "chatgpt" ? "chatgptCpuTag" : "cpuTag"))}</span>` : ""}
            <span class="right">
              ${r.phase === "hint" ? (p.hasHint ? "✅" : "✏️") : ""}
              ${r.phase === "vote" ? (p.hasVoted ? "🗳️" : "🤔") : ""}
              <span class="score">${p.score}${esc(t("pts"))}</span>
            </span>
          </div>`).join("")}
      </div>
    </div>
  `;
}

function hasPendingChatGptCpu(r) {
  if (!r) return false;
  if (r.phase === "hint") return r.players.some((p) => p.cpuMode === "chatgpt" && !p.hasHint);
  if (r.phase === "vote") return r.players.some((p) => p.cpuMode === "chatgpt" && !p.hasVoted);
  if (r.phase === "guess") return r.players.some((p) => p.cpuMode === "chatgpt" && p.pid === r.result?.votedOut);
  return false;
}

function chatGptCpuControl() {
  return `<button class="ai-turn-button wide mt" data-action="run-chatgpt-cpu"><span>✦</span>${esc(t("askCpuTurn"))}</button>`;
}

// ---- イベント -------------------------------------------------------------------------

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "create") createRoom();
  else if (a === "match") startMatchmaking("online");
  else if (a === "cpu-match") startMatchmaking("rule");
  else if (a === "chatgpt-cpu-match") startMatchmaking("chatgpt");
  else if (a === "run-chatgpt-cpu") requestChatGptCpuTurn();
  else if (a === "translate-hints") requestHintTranslations(true);
  else if (a === "translate") requestTranslation();
  else if (a === "cancel-match") cancelMatchmaking();
  else if (a === "join-prepared") joinRoom(el.dataset.code);
  else if (a === "join") openRoomWithChatGPT(document.getElementById("join-code").value);
  else if (a === "copy-link") {
    navigator.clipboard.writeText(el.dataset.url).then(() => toast(t("copied"))).catch(() => toast(el.dataset.url));
  }
  else if (a === "start") wsSend({ type: "start" });
  else if (a === "hint") {
    const v = document.getElementById("hint-input").value.trim();
    if (!v) { toast(t("hintNeeded")); return; }
    wsSend({ type: "hint", word: v });
  }
  else if (a === "suggest") suggestHint();
  else if (a === "vote") wsSend({ type: "vote", target: el.dataset.pid });
  else if (a === "guess") wsSend({ type: "guess", index: Number(el.dataset.index) });
});

document.addEventListener("change", (ev) => {
  const langSel = ev.target.closest("[data-action-change=lang]");
  if (langSel) {
    LANG = langSel.value;
    store.set("cc_lang", LANG);
    if (S.screen === "game") wsSend({ type: "language", lang: gameLang() });
    render();
    return;
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  if (ev.target.id === "join-code") openRoomWithChatGPT(ev.target.value);
  if (ev.target.id === "hint-input") document.querySelector('[data-action="hint"]')?.click();
});

// ---- 起動 -----------------------------------------------------------------------------

(function boot() {
  const gptCode = window.openai && window.openai.toolOutput && window.openai.toolOutput.roomCode;
  const code = (gptCode || "").toUpperCase();
  if (code && /^[A-Z0-9]{4}$/.test(code) && myName) {
    joinRoom(code);
  } else {
    render();
  }
})();
