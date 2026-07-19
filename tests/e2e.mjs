import assert from "node:assert/strict";

const BASE = (process.env.TEST_BASE || "http://127.0.0.1:8791").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

class PlayerClient {
  constructor(code, pid, name, lang) {
    this.code = code;
    this.pid = pid;
    this.name = name;
    this.lang = lang;
    this.messages = [];
    this.waiters = [];
  }

  async connect() {
    this.ws = new WebSocket(`${WS_BASE}/ws/${this.code}`);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      this.messages.push(message);
      if (message.type === "state") {
        this.state = message.state;
        this.you = message.you;
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.send({ type: "hello", pid: this.pid, name: this.name, lang: this.lang });
    await this.waitFor((message) => message.type === "state" && message.you.pid === this.pid);
    return this;
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, timeoutMs = 5000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for ${this.pid}; phase=${this.state?.phase || "?"}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  waitForPhase(phase, round) {
    return this.waitFor((message) => message.type === "state" && message.state.phase === phase &&
      (round === undefined || message.state.round === round));
  }

  close() {
    this.ws?.close();
  }
}

async function rpc(method, params, id = 1) {
  const response = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function createRoom() {
  const body = await rpc("tools/call", { name: "open_copycat", arguments: { action: "private" } });
  assert.match(body.result.structuredContent.roomCode, /^[A-Z2-9]{4}$/);
  return body.result.structuredContent.roomCode;
}

async function connectPlayers(code, entries) {
  const players = [];
  for (const [pid, name, lang] of entries) players.push(await new PlayerClient(code, pid, name, lang).connect());
  await Promise.all(players.map((player) => player.waitFor((message) =>
    message.type === "state" && message.state.players.length === entries.length)));
  return players;
}

async function testStaticAndMcp() {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /topics\.js[\s\S]*i18n\.js[\s\S]*app\.js/);

  const initialized = await rpc("initialize", {});
  assert.equal(initialized.result.serverInfo.name, "copycat");
  assert.match(initialized.result.instructions, /action=home/);
  const tools = await rpc("tools/list", {}, 2);
  assert.equal(tools.result.tools[0]._meta.ui.visibility.includes("app"), true);
  assert.deepEqual(tools.result.tools[0]._meta.securitySchemes, [{ type: "noauth" }]);
  assert.equal(tools.result.tools[0]._meta["openai/widgetAccessible"], true);
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name),
    ["open_copycat", "get_copycat_cpu_turn", "submit_copycat_cpu_turn", "translate_copycat_hints", "localize_copycat"],
  );
  const home = await rpc("tools/call", { name: "open_copycat", arguments: {} }, 5);
  assert.equal(home.result.structuredContent.mode, "home");
  assert.equal(home.result.structuredContent.roomCode, "");
  const localized = await rpc("tools/call", {
    name: "localize_copycat",
    arguments: {
      locale: "fr-FR",
      language_name: "Français",
      ui_copy: { match: "Trouver des joueurs", round: "Manche {n}" },
      topic_copy: { builtinId: 0, title: "Animaux", words: Array.from({ length: 16 }, (_, index) => `mot${index}`) },
    },
  }, 6);
  assert.equal(localized.result.structuredContent.locale, "fr-FR");
  assert.equal(localized.result.structuredContent.uiCopy.match, "Trouver des joueurs");
  assert.equal(localized.result.structuredContent.topicCopy.words.length, 16);
  const resource = await rpc("resources/read", { uri: "ui://widget/copycat.html" }, 2);
  assert.match(resource.result.contents[0].text, /topics\.js[\s\S]*i18n\.js[\s\S]*app\.js/);
  assert.equal(resource.result.contents[0].mimeType, "text/html;profile=mcp-app");

  const code = await createRoom();
  const joined = await rpc("tools/call", { name: "open_copycat", arguments: { room_code: code } }, 3);
  assert.equal(joined.result.structuredContent.roomCode, code);
  const missing = await rpc("tools/call", { name: "open_copycat", arguments: { room_code: "0000" } }, 4);
  assert.equal(missing.error.code, -32602);

  const directCreate = await fetch(`${BASE}/api/rooms`, { method: "POST" });
  assert.equal(directCreate.status, 404);
}

async function testAutomaticMatchmaking() {
  const enqueue = async (pid, name, lang) => {
    const response = await fetch(`${BASE}/api/match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid, name, lang }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const status = async (ticket) => {
    const response = await fetch(`${BASE}/api/match/${ticket}`);
    assert.equal(response.status, 200);
    return response.json();
  };

  const first = await enqueue("match-p1", "Mina", "ja");
  const second = await enqueue("match-p2", "Noah", "en");
  const third = await enqueue("match-p3", "Lia", "es");
  assert.equal(first.status, "waiting");
  assert.equal(second.players, 2);
  assert.equal(third.status, "matched");

  const matched = await Promise.all([status(first.ticket), status(second.ticket), Promise.resolve(third)]);
  assert.ok(matched.every((entry) => entry.status === "matched"));
  assert.equal(new Set(matched.map((entry) => entry.roomCode)).size, 1);

  const players = await connectPlayers(third.roomCode, [
    ["match-p1", "Mina", "ja"],
    ["match-p2", "Noah", "en"],
    ["match-p3", "Lia", "es"],
  ]);
  assert.equal(players[0].state.players.length, 3);
  players.forEach((player) => player.close());
}

async function testCpuFallbackAndPractice() {
  const suffix = Date.now().toString(36);
  const fallbackResponse = await fetch(`${BASE}/api/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pid: `fallback-${suffix}`, name: "Solo", lang: "ja" }),
  });
  assert.equal(fallbackResponse.status, 200);
  let fallback = await fallbackResponse.json();
  assert.equal(fallback.status, "waiting");
  assert.ok(fallback.fallbackInMs > 0 && fallback.fallbackInMs <= 10000);

  const deadline = Date.now() + 13000;
  while (fallback.status !== "matched" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await fetch(`${BASE}/api/match/${fallback.ticket}`);
    assert.equal(response.status, 200);
    fallback = await response.json();
  }
  assert.equal(fallback.status, "matched");
  assert.equal(fallback.cpuPlayers, 2);

  const practiceResponse = await fetch(`${BASE}/api/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pid: `practice-${suffix}`, name: "Tester", lang: "ja", cpu: true }),
  });
  assert.equal(practiceResponse.status, 200);
  const practice = await practiceResponse.json();
  assert.equal(practice.status, "matched");
  assert.equal(practice.cpuPlayers, 2);

  const solo = await new PlayerClient(practice.roomCode, `practice-${suffix}`, "Tester", "ja").connect();
  await solo.waitFor((message) => message.type === "state" && message.state.players.length === 3);
  assert.equal(solo.you.isHost, true);
  assert.equal(solo.state.players.filter((player) => player.isAI).length, 2);

  solo.send({ type: "start" });
  await solo.waitForPhase("hint", 1);
  assert.ok(solo.state.players.filter((player) => player.isAI).every((player) => player.hasHint));
  solo.send({ type: "hint", word: "テスト" });
  await solo.waitFor((message) => message.type === "state" && message.state.phase === "vote" &&
    message.state.players.filter((player) => player.isAI).every((player) => player.hasVoted));
  assert.equal(solo.state.hints.filter((hint) => hint.isAI).length, 2);

  const cpuTarget = solo.state.players.find((player) => player.isAI);
  solo.send({ type: "vote", target: cpuTarget.pid });
  const outcome = await solo.waitFor((message) => message.type === "state" &&
    (message.state.phase === "guess" || message.state.phase === "reveal"));
  if (outcome.state.phase === "guess") {
    assert.equal(solo.you.role, "copycat");
    solo.send({ type: "guess", index: 0 });
    await solo.waitForPhase("reveal", 1);
  }
  assert.ok(solo.state.result);
  solo.close();
}

async function testChatGptCpuTools() {
  const suffix = Date.now().toString(36);
  const pid = `llm-practice-${suffix}`;
  const response = await fetch(`${BASE}/api/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pid, name: "Human", lang: "en", cpu: true, cpuMode: "chatgpt" }),
  });
  assert.equal(response.status, 200);
  const match = await response.json();
  assert.equal(match.status, "matched");
  assert.equal(match.cpuMode, "chatgpt");

  const human = await new PlayerClient(match.roomCode, pid, "Human", "en").connect();
  await human.waitFor((message) => message.type === "state" && message.state.players.length === 3);
  assert.equal(human.state.players.filter((player) => player.cpuMode === "chatgpt").length, 2);
  human.send({ type: "start" });
  await human.waitForPhase("hint", 1);

  for (let count = 0; count < 2; count++) {
    const turn = await rpc("tools/call", {
      name: "get_copycat_cpu_turn",
      arguments: { room_code: match.roomCode },
    }, 20 + count);
    const context = turn.result.structuredContent;
    assert.equal(context.pending, true);
    assert.equal(context.phase, "hint");
    assert.equal(context.topic.words.length, 16);
    if (context.cpu.role === "copycat") assert.equal(context.topic.secretWord, null);
    else assert.equal(typeof context.topic.secretWord, "string");
    const submitted = await rpc("tools/call", {
      name: "submit_copycat_cpu_turn",
      arguments: { room_code: match.roomCode, cpu_pid: context.cpu.pid, hint: `clue${count}` },
    }, 30 + count);
    assert.equal(submitted.result.structuredContent.ok, true);
  }

  human.send({ type: "hint", word: "human" });
  await human.waitForPhase("vote", 1);
  for (let count = 0; count < 2; count++) {
    const turn = await rpc("tools/call", {
      name: "get_copycat_cpu_turn",
      arguments: { room_code: match.roomCode },
    }, 40 + count);
    const context = turn.result.structuredContent;
    assert.equal(context.pending, true);
    assert.equal(context.phase, "vote");
    const target = context.players.find((player) => player.pid !== context.cpu.pid);
    await rpc("tools/call", {
      name: "submit_copycat_cpu_turn",
      arguments: { room_code: match.roomCode, cpu_pid: context.cpu.pid, vote_for: target.pid },
    }, 50 + count);
  }

  const target = human.state.players.find((player) => player.pid !== pid);
  human.send({ type: "vote", target: target.pid });
  const outcome = await human.waitFor((message) => message.type === "state" &&
    (message.state.phase === "guess" || message.state.phase === "reveal"));
  if (outcome.state.phase === "guess") {
    if (human.you.role === "copycat") {
      human.send({ type: "guess", index: 0 });
    } else {
      const turn = await rpc("tools/call", {
        name: "get_copycat_cpu_turn",
        arguments: { room_code: match.roomCode },
      }, 60);
      assert.equal(turn.result.structuredContent.phase, "guess");
      await rpc("tools/call", {
        name: "submit_copycat_cpu_turn",
        arguments: {
          room_code: match.roomCode,
          cpu_pid: turn.result.structuredContent.cpu.pid,
          guess_index: 0,
        },
      }, 61);
    }
    await human.waitForPhase("reveal", 1);
  }
  assert.ok(human.state.result);
  human.close();
}

async function testBuiltinRound() {
  const code = await createRoom();
  const players = await connectPlayers(code, [
    ["p1", "Aki", "ja"],
    ["p2", "Ben", "en"],
    ["p3", "Caro", "es"],
  ]);
  const host = players[0];
  assert.equal(host.you.isHost, true);

  host.send({ type: "start" });
  await Promise.all(players.map((player) => player.waitForPhase("hint", 1)));
  assert.ok(players.every((player) => player.state.topic.source === "builtin"));
  assert.ok(players.every((player) => Number.isInteger(player.state.topic.builtinId)));
  const copycats = players.filter((player) => player.you.role === "copycat");
  assert.equal(copycats.length, 1);
  const copycat = copycats[0];
  const citizens = players.filter((player) => player !== copycat);
  assert.equal(copycat.you.secretIndex, null);
  assert.ok(citizens.every((player) => Number.isInteger(player.you.secretIndex)));

  players.forEach((player, index) => player.send({ type: "hint", word: `hint${index}` }));
  await Promise.all(players.map((player) => player.waitForPhase("vote", 1)));
  assert.ok(players.every((player) => player.state.hints.length === 3));
  assert.ok(players.every((player) => player.state.hints.every((hint) => hint.isAI === false)));
  assert.equal(players[0].state.hints.find((hint) => hint.pid === "p2").sourceLang, "en");

  const translated = await rpc("tools/call", {
    name: "translate_copycat_hints",
    arguments: {
      room_code: code,
      requester_pid: "p1",
      target_locale: "ja",
      translations: [
        { pid: "p2", translation: "ヒント1" },
        { pid: "p3", translation: "ヒント2" },
      ],
    },
  }, 70);
  assert.equal(translated.result.structuredContent.accepted, 2);
  await players[0].waitFor((message) => message.type === "state" &&
    message.state.hints?.find((hint) => hint.pid === "p2")?.translatedWord === "ヒント1");
  assert.equal(players[0].state.hints.find((hint) => hint.pid === "p3").translatedWord, "ヒント2");
  assert.equal(players[1].state.hints.find((hint) => hint.pid === "p3").translatedWord, null);

  for (const player of players) {
    const target = player === copycat ? citizens[0].pid : copycat.pid;
    player.send({ type: "vote", target });
  }
  await Promise.all(players.map((player) => player.waitForPhase("guess", 1)));
  assert.equal(copycat.state.result.caught, true);
  const secret = citizens[0].you.secretIndex;
  copycat.send({ type: "guess", index: (secret + 1) % 16 });
  await Promise.all(players.map((player) => player.waitForPhase("reveal", 1)));
  assert.equal(host.state.result.guessedRight, false);
  assert.equal(host.state.secret, secret);
  for (const player of players) {
    const score = host.state.players.find((entry) => entry.pid === player.pid).score;
    assert.equal(score, player === copycat ? 0 : 1);
  }

  host.send({ type: "start" });
  await Promise.all(players.map((player) => player.waitForPhase("hint", 2)));
  players.forEach((player) => player.close());
}

await testStaticAndMcp();
await testAutomaticMatchmaking();
await testCpuFallbackAndPractice();
await testChatGptCpuTools();
await testBuiltinRound();
console.log("E2E passed: ChatGPT home/localization, human matching, rule CPU, ChatGPT CPU tools, private rooms, and multilingual rounds");
