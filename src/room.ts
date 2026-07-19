import { DurableObject } from "cloudflare:workers";
import { BUILTIN_TOPIC_COUNT, getBuiltinTopic } from "./topics";

type CpuMode = "rule" | "chatgpt" | null;

interface Player {
  pid: string;
  name: string;
  score: number;
  connected: boolean;
  lang: string;
  isAI: boolean;
  cpuMode: CpuMode;
}

interface Topic {
  builtinId: number;
  secret: number;
  source: "builtin";
}

type Phase = "lobby" | "hint" | "vote" | "guess" | "reveal";

interface RoundResult {
  caught: boolean;
  votedOut: string | null;
  tally: Record<string, number>;
  guessIndex: number | null;
  guessedRight: boolean;
  chameleon: string;
}

interface Game {
  created: boolean;
  code: string;
  hostPid: string | null;
  phase: Phase;
  round: number;
  players: Player[];
  topic: Topic | null;
  chameleon: string | null;
  hints: Record<string, string>;
  hintLanguages: Record<string, string>;
  hintTranslations: Record<string, Record<string, string>>;
  votes: Record<string, string>;
  result: RoundResult | null;
  usedTopics: number[];
}

interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const MAX_PLAYERS = 10;
const CPU_NAMES = ["Mochi", "Luna", "Sora", "Minto"];
const CPU_HINTS: Record<string, string[]> = {
  ja: ["定番", "人気", "身近", "楽しい"],
  en: ["classic", "popular", "familiar", "fun"],
  zh: ["经典", "流行", "熟悉", "有趣"],
  ko: ["대표", "인기", "친숙", "재미"],
  es: ["clásico", "popular", "cercano", "divertido"],
};

function validLang(value: unknown): string {
  const lang = typeof value === "string" ? value.trim().slice(0, 35) : "";
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang) ? lang.toLowerCase() : "en";
}

function freshGame(): Game {
  return {
    created: false,
    code: "",
    hostPid: null,
    phase: "lobby",
    round: 0,
    players: [],
    topic: null,
    chameleon: null,
    hints: {},
    hintLanguages: {},
    hintTranslations: {},
    votes: {},
    result: null,
    usedTopics: [],
  };
}

export class GameRoom extends DurableObject<Env> {
  game!: Game;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.game = (await ctx.storage.get<Game>("game")) ?? freshGame();
      for (const player of this.game.players) {
        if (player.cpuMode === undefined) player.cpuMode = player.isAI ? "rule" : null;
      }
      this.game.hintTranslations ??= {};
      this.game.hintLanguages ??= {};
    });
  }

  private async save() {
    await this.ctx.storage.put("game", this.game);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/create" && req.method === "POST") {
      if (this.game.created) return new Response("exists", { status: 409 });
      this.game = freshGame();
      this.game.created = true;
      this.game.code = url.searchParams.get("code") ?? "";
      await this.save();
      return Response.json({ ok: true });
    }

    if (url.pathname === "/status") {
      return Response.json({
        exists: this.game.created,
        phase: this.game.phase,
        players: this.game.players.length,
      });
    }

    if (url.pathname === "/add-cpus" && req.method === "POST") {
      if (!this.game.created || this.game.phase !== "lobby") return new Response("unavailable", { status: 409 });
      const requested = Math.max(0, Math.min(9, Number(url.searchParams.get("count")) || 0));
      const lang = validLang(url.searchParams.get("lang"));
      const cpuMode: Exclude<CpuMode, null> = url.searchParams.get("mode") === "chatgpt" ? "chatgpt" : "rule";
      const available = Math.max(0, MAX_PLAYERS - this.game.players.length);
      const count = Math.min(requested, available);
      for (let index = 0; index < count; index++) {
        const pid = `cpu_${crypto.randomUUID()}`;
        this.game.players.push({
          pid,
          name: `CPU ${CPU_NAMES[(this.game.players.length + index) % CPU_NAMES.length]}`,
          score: 0,
          connected: true,
          lang,
          isAI: true,
          cpuMode,
        });
      }
      await this.save();
      return Response.json({ ok: true, added: count });
    }

    if (url.pathname === "/cpu-context" && req.method === "GET") {
      return Response.json(this.chatGptCpuContext());
    }

    if (url.pathname === "/cpu-action" && req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
      }
      return this.applyChatGptCpuAction(body);
    }

    if (url.pathname === "/hint-translations" && req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
      }
      return this.applyHintTranslations(body);
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 8192) return;
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const attachment = (ws.deserializeAttachment() as { pid?: string } | null) ?? {};
    const me = this.game.players.find((player) => player.pid === attachment.pid);

    try {
      switch (msg.type) {
        case "hello":
          await this.onHello(ws, msg);
          return;
        case "language":
          if (me) {
            me.lang = validLang(msg.lang);
            await this.saveAndBroadcast();
          }
          return;
        case "start":
          if (me && me.pid === this.game.hostPid && (this.game.phase === "lobby" || this.game.phase === "reveal")) {
            await this.startRound();
          }
          return;
        case "hint":
          await this.onHint(me, msg);
          return;
        case "vote":
          await this.onVote(me, msg);
          return;
        case "guess":
          await this.onGuess(me, msg);
          return;
        case "leave":
          if (me) {
            this.game.players = this.game.players.filter((player) => player.pid !== me.pid);
            this.afterPlayerRemoved(me.pid);
            ws.close(1000, "left");
            await this.saveAndBroadcast();
          }
          return;
      }
    } catch (error) {
      this.send(ws, { type: "error", message: String(error) });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = (ws.deserializeAttachment() as { pid?: string } | null) ?? {};
    const me = this.game.players.find((player) => player.pid === attachment.pid);
    if (!me) return;

    const otherPids = this.ctx
      .getWebSockets()
      .filter((socket) => socket !== ws)
      .map((socket) => (socket.deserializeAttachment() as { pid?: string } | null)?.pid);
    if (otherPids.includes(me.pid)) return;

    if (this.game.phase === "lobby") {
      this.game.players = this.game.players.filter((player) => player.pid !== me.pid);
      this.afterPlayerRemoved(me.pid);
    } else {
      me.connected = false;
      if (this.game.hostPid === me.pid) this.afterPlayerRemoved(me.pid);
    }
    await this.saveAndBroadcast();
  }

  private async onHello(ws: WebSocket, msg: any) {
    const game = this.game;
    const pid = typeof msg.pid === "string" ? msg.pid.slice(0, 40) : "";
    const name = (typeof msg.name === "string" ? msg.name : "").trim().slice(0, 12) || "Player";
    if (!pid) {
      this.send(ws, { type: "error", message: "pid is required" });
      return;
    }
    if (!game.created) {
      this.send(ws, { type: "reject", code: "no_room", message: "Room not found." });
      ws.close(1000, "no room");
      return;
    }

    let player = game.players.find((candidate) => candidate.pid === pid);
    if (!player) {
      if (game.phase !== "lobby") {
        this.send(ws, { type: "reject", code: "in_progress", message: "Game in progress." });
        ws.close(1000, "in progress");
        return;
      }
      if (game.players.length >= MAX_PLAYERS) {
        this.send(ws, { type: "reject", code: "full", message: "Room is full." });
        ws.close(1000, "full");
        return;
      }
      player = { pid, name, score: 0, connected: true, lang: validLang(msg.lang), isAI: false, cpuMode: null };
      game.players.push(player);
    } else {
      player.name = name;
      player.connected = true;
      player.lang = validLang(msg.lang ?? player.lang);
    }

    if (!game.hostPid || !game.players.some((candidate) => candidate.pid === game.hostPid)) {
      game.hostPid = pid;
    }
    ws.serializeAttachment({ pid });
    await this.saveAndBroadcast();
  }

  private afterPlayerRemoved(pid: string) {
    if (this.game.hostPid !== pid) return;
    const next = this.game.players.find((player) => player.connected) ?? this.game.players[0];
    this.game.hostPid = next?.pid ?? null;
  }

  private async startRound() {
    const game = this.game;
    if (game.players.length < 3) {
      this.toHost({ type: "toast", code: "need3" });
      return;
    }

    game.round += 1;
    game.hints = {};
    game.hintLanguages = {};
    game.hintTranslations = {};
    game.votes = {};
    game.result = null;
    game.topic = null;
    game.chameleon = game.players[Math.floor(Math.random() * game.players.length)].pid;
    this.pickBuiltinTopic();
    game.phase = "hint";
    this.playRuleCpuHints();
    await this.saveAndBroadcast();
  }

  private playRuleCpuHints() {
    const game = this.game;
    if (game.phase !== "hint" || !game.topic) return;
    for (const [index, player] of game.players.filter((candidate) => candidate.cpuMode === "rule").entries()) {
      if (game.hints[player.pid] !== undefined) continue;
      const hints = CPU_HINTS[player.lang] ?? CPU_HINTS.en;
      const offset = player.pid === game.chameleon ? index : game.topic.secret + index;
      game.hints[player.pid] = hints[offset % hints.length];
      game.hintLanguages[player.pid] = player.lang;
    }
    if (game.players.every((player) => game.hints[player.pid] !== undefined)) game.phase = "vote";
  }

  private playRuleCpuVotes() {
    const game = this.game;
    if (game.phase !== "vote") return;
    const human = game.players.find((player) => !player.isAI);
    for (const player of game.players.filter((candidate) => candidate.cpuMode === "rule")) {
      if (game.votes[player.pid] !== undefined) continue;
      const target = player.pid === game.chameleon
        ? human ?? game.players.find((candidate) => candidate.pid !== player.pid)
        : game.players.find((candidate) => candidate.pid === game.chameleon);
      if (target && target.pid !== player.pid) game.votes[player.pid] = target.pid;
    }
  }

  private pickBuiltinTopic() {
    const game = this.game;
    let pool = Array.from({ length: BUILTIN_TOPIC_COUNT }, (_, index) => index)
      .filter((index) => !game.usedTopics.includes(index));
    if (pool.length === 0) {
      game.usedTopics = [];
      pool = Array.from({ length: BUILTIN_TOPIC_COUNT }, (_, index) => index);
    }
    const builtinId = pool[Math.floor(Math.random() * pool.length)];
    game.usedTopics.push(builtinId);
    game.topic = { builtinId, secret: Math.floor(Math.random() * 16), source: "builtin" };
  }

  private async onHint(me: Player | undefined, msg: any) {
    const game = this.game;
    if (!me || game.phase !== "hint" || game.hints[me.pid] !== undefined) return;
    const word = (typeof msg.word === "string" ? msg.word : "").trim().slice(0, 15);
    if (!word) return;
    game.hints[me.pid] = word;
    game.hintLanguages[me.pid] = me.lang;
    if (game.players.every((player) => game.hints[player.pid] !== undefined)) {
      game.phase = "vote";
      this.playRuleCpuVotes();
    }
    await this.saveAndBroadcast();
  }

  private async onVote(me: Player | undefined, msg: any) {
    const game = this.game;
    if (!me || game.phase !== "vote" || game.votes[me.pid] !== undefined) return;
    const target = game.players.find((player) => player.pid === msg.target);
    if (!target || target.pid === me.pid) return;
    game.votes[me.pid] = target.pid;
    this.playRuleCpuVotes();
    if (game.players.every((player) => game.votes[player.pid] !== undefined)) {
      await this.resolveVotes();
    } else {
      await this.saveAndBroadcast();
    }
  }

  private async resolveVotes() {
    const game = this.game;
    const tally: Record<string, number> = {};
    for (const target of Object.values(game.votes)) tally[target] = (tally[target] ?? 0) + 1;

    let top: string | null = null;
    let topCount = 0;
    let tie = false;
    for (const [pid, count] of Object.entries(tally)) {
      if (count > topCount) {
        top = pid;
        topCount = count;
        tie = false;
      } else if (count === topCount) {
        tie = true;
      }
    }

    const votedOut = tie ? null : top;
    const caught = votedOut === game.chameleon;
    game.result = {
      caught,
      votedOut,
      tally,
      guessIndex: null,
      guessedRight: false,
      chameleon: game.chameleon!,
    };

    if (caught) {
      game.phase = "guess";
      const copycat = game.players.find((player) => player.pid === game.chameleon);
      if (copycat?.cpuMode === "rule" && game.topic) this.finishGuess(copycat, (game.topic.secret + 1) % 16);
    } else {
      const copycat = game.players.find((player) => player.pid === game.chameleon);
      if (copycat) copycat.score += 2;
      game.phase = "reveal";
    }
    await this.saveAndBroadcast();
  }

  private async onGuess(me: Player | undefined, msg: any) {
    const game = this.game;
    if (!me || game.phase !== "guess" || me.pid !== game.chameleon || !game.topic || !game.result) return;
    const index = Number(msg.index);
    if (!Number.isInteger(index) || index < 0 || index >= 16) return;

    this.finishGuess(me, index);
    await this.saveAndBroadcast();
  }

  private finishGuess(copycat: Player, index: number) {
    const game = this.game;
    if (!game.topic || !game.result) return;
    game.result.guessIndex = index;
    game.result.guessedRight = index === game.topic.secret;
    if (game.result.guessedRight) copycat.score += 1;
    else for (const player of game.players) if (player.pid !== game.chameleon) player.score += 1;
    game.phase = "reveal";
  }

  private toHost(payload: unknown) {
    for (const socket of this.ctx.getWebSockets()) {
      const pid = (socket.deserializeAttachment() as { pid?: string } | null)?.pid;
      if (pid === this.game.hostPid) this.send(socket, payload);
    }
  }

  private send(ws: WebSocket, payload: unknown) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  private publicHints(targetLang?: string): {
    pid: string;
    name: string;
    isAI: boolean;
    word: string;
    sourceLang: string;
    translatedWord: string | null;
  }[] {
    const normalizedTarget = targetLang ? validLang(targetLang) : null;
    return this.game.players
      .filter((player) => this.game.hints[player.pid] !== undefined)
      .map((player) => ({
        pid: player.pid,
        name: player.name,
        isAI: player.isAI,
        word: this.game.hints[player.pid],
        sourceLang: this.game.hintLanguages[player.pid] ?? player.lang,
        translatedWord: normalizedTarget && normalizedTarget !== (this.game.hintLanguages[player.pid] ?? player.lang)
          ? this.game.hintTranslations[player.pid]?.[normalizedTarget] ?? null
          : null,
      }));
  }

  private async saveAndBroadcast() {
    await this.save();
    const game = this.game;
    const showHints = game.phase === "vote" || game.phase === "guess" || game.phase === "reveal";
    const reveal = game.phase === "reveal";
    const publicState = {
      code: game.code,
      phase: game.phase,
      round: game.round,
      hostPid: game.hostPid,
      players: game.players.map((player) => ({
        pid: player.pid,
        name: player.name,
        isAI: player.isAI,
        cpuMode: player.cpuMode,
        score: player.score,
        connected: player.connected,
        hasHint: game.hints[player.pid] !== undefined,
        hasVoted: game.votes[player.pid] !== undefined,
      })),
      topic: game.topic && game.phase !== "lobby"
        ? { source: game.topic.source, builtinId: game.topic.builtinId }
        : null,
      votes: reveal ? game.votes : null,
      result: reveal
        ? game.result
        : game.phase === "guess"
          ? { caught: true, votedOut: game.result?.votedOut ?? null, tally: game.result?.tally ?? {} }
          : null,
      secret: reveal && game.topic ? game.topic.secret : null,
      chameleon: reveal ? game.chameleon : null,
    };

    const dealt = game.phase !== "lobby";
    for (const socket of this.ctx.getWebSockets()) {
      const pid = (socket.deserializeAttachment() as { pid?: string } | null)?.pid;
      if (!pid) continue;
      const isCopycat = dealt && game.chameleon === pid;
      const you = {
        pid,
        isHost: pid === game.hostPid,
        role: dealt ? (isCopycat ? "copycat" : "citizen") : null,
        secretIndex: dealt && !isCopycat && game.topic ? game.topic.secret : null,
      };
      const viewer = game.players.find((player) => player.pid === pid);
      const state = {
        ...publicState,
        hints: showHints ? this.publicHints(viewer?.lang ?? "en") : null,
      };
      this.send(socket, { type: "state", state, you });
    }
  }

  private chatGptCpuContext() {
    const game = this.game;
    if (!game.created || !game.topic || game.phase === "lobby" || game.phase === "reveal") {
      return { pending: false, code: game.code, phase: game.phase };
    }

    let cpu: Player | undefined;
    if (game.phase === "hint") {
      cpu = game.players.find((player) => player.cpuMode === "chatgpt" && game.hints[player.pid] === undefined);
    } else if (game.phase === "vote") {
      cpu = game.players.find((player) => player.cpuMode === "chatgpt" && game.votes[player.pid] === undefined);
    } else if (game.phase === "guess") {
      const candidate = game.players.find((player) => player.pid === game.chameleon);
      if (candidate?.cpuMode === "chatgpt" && game.result?.guessIndex == null) cpu = candidate;
    }
    if (!cpu) return { pending: false, code: game.code, phase: game.phase };

    const topic = getBuiltinTopic(game.topic.builtinId);
    const isCopycat = cpu.pid === game.chameleon;
    return {
      pending: true,
      code: game.code,
      phase: game.phase,
      round: game.round,
      cpu: { pid: cpu.pid, name: cpu.name, language: cpu.lang, role: isCopycat ? "copycat" : "citizen" },
      topic: {
        title: topic.title,
        words: topic.words,
        secretIndex: isCopycat ? null : game.topic.secret,
        secretWord: isCopycat ? null : topic.words[game.topic.secret],
      },
      hints: this.publicHints().map((hint) => ({ ...hint, isSelf: hint.pid === cpu!.pid })),
      players: game.players.map((player) => ({ pid: player.pid, name: player.name, isAI: player.isAI })),
      instruction: game.phase === "hint"
        ? "Return one subtle one-word hint. Never say the secret word. As Copycat, bluff from the category and candidates."
        : game.phase === "vote"
          ? "Vote for exactly one other player using their pid. Infer only from the public hints."
          : "Choose one word index from 0 to 15 as the Copycat's final guess.",
    };
  }

  private async applyChatGptCpuAction(body: Record<string, unknown>): Promise<Response> {
    const pid = typeof body.cpuPid === "string" ? body.cpuPid : "";
    const cpu = this.game.players.find((player) => player.pid === pid && player.cpuMode === "chatgpt");
    if (!cpu) return Response.json({ ok: false, error: "cpu_not_found" }, { status: 404 });

    if (this.game.phase === "hint" && this.game.hints[pid] === undefined) {
      const word = (typeof body.hint === "string" ? body.hint : "").trim().split(/\s+/)[0]?.slice(0, 15) ?? "";
      if (!word) return Response.json({ ok: false, error: "hint_required" }, { status: 400 });
      this.game.hints[pid] = word;
      this.game.hintLanguages[pid] = cpu.lang;
      if (this.game.players.every((player) => this.game.hints[player.pid] !== undefined)) {
        this.game.phase = "vote";
        this.playRuleCpuVotes();
      }
      await this.saveAndBroadcast();
      return Response.json({ ok: true, phase: this.game.phase });
    }

    if (this.game.phase === "vote" && this.game.votes[pid] === undefined) {
      const target = this.game.players.find((player) => player.pid === body.voteFor && player.pid !== pid);
      if (!target) return Response.json({ ok: false, error: "valid_vote_required" }, { status: 400 });
      this.game.votes[pid] = target.pid;
      this.playRuleCpuVotes();
      if (this.game.players.every((player) => this.game.votes[player.pid] !== undefined)) await this.resolveVotes();
      else await this.saveAndBroadcast();
      return Response.json({ ok: true, phase: this.game.phase });
    }

    if (this.game.phase === "guess" && pid === this.game.chameleon && this.game.topic && this.game.result) {
      const index = Number(body.guessIndex);
      if (!Number.isInteger(index) || index < 0 || index >= 16) {
        return Response.json({ ok: false, error: "valid_guess_required" }, { status: 400 });
      }
      this.finishGuess(cpu, index);
      await this.saveAndBroadcast();
      return Response.json({ ok: true, phase: this.game.phase });
    }

    return Response.json({ ok: false, error: "no_pending_turn", phase: this.game.phase }, { status: 409 });
  }

  private async applyHintTranslations(body: Record<string, unknown>): Promise<Response> {
    if (this.game.phase === "lobby" || this.game.phase === "hint") {
      return Response.json({ ok: false, error: "hints_not_public" }, { status: 409 });
    }
    const requesterPid = typeof body.requesterPid === "string" ? body.requesterPid.slice(0, 40) : "";
    const requester = this.game.players.find((player) => player.pid === requesterPid);
    if (!requester) return Response.json({ ok: false, error: "requester_not_found" }, { status: 404 });

    const targetLang = validLang(body.targetLocale);
    if (targetLang !== requester.lang) {
      return Response.json({ ok: false, error: "locale_mismatch" }, { status: 400 });
    }
    const rows = Array.isArray(body.translations) ? body.translations.slice(0, MAX_PLAYERS) : [];
    let accepted = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const entry = row as Record<string, unknown>;
      const pid = typeof entry.pid === "string" ? entry.pid.slice(0, 40) : "";
      const translated = typeof entry.translation === "string" ? entry.translation.trim().slice(0, 40) : "";
      const source = this.game.players.find((player) => player.pid === pid);
      const sourceLang = this.game.hintLanguages[pid] ?? source?.lang;
      if (!source || this.game.hints[pid] === undefined || sourceLang === targetLang || !translated) continue;
      this.game.hintTranslations[pid] ??= {};
      this.game.hintTranslations[pid][targetLang] = translated;
      accepted++;
    }
    if (accepted === 0) {
      return Response.json({ ok: false, error: "no_valid_translations" }, { status: 400 });
    }
    await this.saveAndBroadcast();
    return Response.json({ ok: true, accepted, targetLocale: targetLang, phase: this.game.phase });
  }
}
