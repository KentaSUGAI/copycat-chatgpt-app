import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

interface QueueEntry {
  ticket: string;
  pid: string;
  name: string;
  lang: string;
  joinedAt: number;
}

interface MatchResult {
  code: string;
  expiresAt: number;
  cpuPlayers: number;
  cpuMode: "rule" | "chatgpt" | null;
}

interface MatchState {
  queue: QueueEntry[];
  results: Record<string, MatchResult>;
}

const MATCH_SIZE = 3;
const QUEUE_TTL_MS = 2 * 60 * 1000;
const RESULT_TTL_MS = 5 * 60 * 1000;
const CPU_FALLBACK_MS = 10 * 1000;
const SUPPORTED_LANGS = new Set(["ja", "en", "zh", "ko", "es"]);

function freshState(): MatchState {
  return { queue: [], results: {} };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
  });
}

export class Matchmaker extends DurableObject<Env> {
  state!: MatchState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<MatchState>("state")) ?? freshState();
      await this.prune();
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    await this.prune();

    if (url.pathname === "/match" && req.method === "POST") {
      return this.enqueue(req);
    }

    const ticketMatch = url.pathname.match(/^\/match\/([a-f0-9-]{36})$/);
    if (ticketMatch && req.method === "GET") {
      return this.status(ticketMatch[1]);
    }
    if (ticketMatch && req.method === "DELETE") {
      return this.cancel(ticketMatch[1]);
    }

    return new Response("not found", { status: 404 });
  }

  private async enqueue(req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const pid = typeof body.pid === "string" ? body.pid.slice(0, 40) : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 12) : "";
    const lang = typeof body.lang === "string" && SUPPORTED_LANGS.has(body.lang) ? body.lang : "en";
    if (!pid || !name) return json({ error: "pid_and_name_required" }, 400);

    const cpuRequested = body.cpu === true;
    const cpuMode = body.cpuMode === "chatgpt" ? "chatgpt" : "rule";
    const existing = this.state.queue.find((entry) => entry.pid === pid);
    if (existing && !cpuRequested) return this.waiting(existing.ticket);
    if (existing) this.state.queue = this.state.queue.filter((entry) => entry.ticket !== existing.ticket);

    const ticket = crypto.randomUUID();
    const entry = { ticket, pid, name, lang, joinedAt: Date.now() };
    this.state.queue.push(entry);

    if (cpuRequested) {
      this.state.queue = this.state.queue.filter((candidate) => candidate.ticket !== ticket);
      const code = await this.createRoom(MATCH_SIZE - 1, lang, cpuMode);
      if (!code) {
        await this.save();
        return json({ error: "room_creation_failed" }, 503);
      }
      this.state.results[ticket] = {
        code,
        expiresAt: Date.now() + RESULT_TTL_MS,
        cpuPlayers: MATCH_SIZE - 1,
        cpuMode,
      };
    }

    if (!cpuRequested && this.state.queue.length >= MATCH_SIZE) {
      // グループ確定〜部屋作成〜結果記録は原子的に行う。createRoomのawait中に
      // 入力ゲートが開き、他プレイヤーのポーリングが「キューにも結果にも無い」
      // 瞬間を観測して404(expired)になるレースを防ぐ。
      const ok = await this.ctx.blockConcurrencyWhile(() => this.formGroup(0, lang, "rule"));
      if (!ok) {
        await this.save();
        return json({ error: "room_creation_failed" }, 503);
      }
    }

    await this.save();
    return this.status(ticket);
  }

  /** 先頭MATCH_SIZE件(不足分はCPU)で部屋を作り、全チケットに結果を書く。呼び出し側でblockConcurrencyWhile必須 */
  private async formGroup(minCpu: number, fallbackLang: string, cpuMode: "rule" | "chatgpt"): Promise<boolean> {
    const group = this.state.queue.splice(0, MATCH_SIZE);
    const cpuPlayers = Math.max(minCpu, MATCH_SIZE - group.length);
    const code = await this.createRoom(cpuPlayers, group[0]?.lang ?? fallbackLang, cpuMode);
    if (!code) {
      this.state.queue.unshift(...group);
      return false;
    }
    const expiresAt = Date.now() + RESULT_TTL_MS;
    for (const entry of group) {
      this.state.results[entry.ticket] = { code, expiresAt, cpuPlayers, cpuMode: cpuPlayers ? cpuMode : null };
    }
    return true;
  }

  private async status(ticket: string): Promise<Response> {
    const match = this.state.results[ticket];
    if (match) return this.matched(ticket, match);

    const queued = this.state.queue.find((entry) => entry.ticket === ticket);
    if (queued && Date.now() - queued.joinedAt >= CPU_FALLBACK_MS) {
      // enqueue側と同じレース対策(blockConcurrencyWhileで原子化)
      const ok = await this.ctx.blockConcurrencyWhile(() => this.formGroup(0, queued.lang, "rule"));
      if (!ok) {
        await this.save();
        return json({ error: "room_creation_failed" }, 503);
      }
      await this.save();
      return this.matched(ticket, this.state.results[ticket]);
    }

    if (queued) return this.waiting(ticket);
    return json({ status: "expired", ticket }, 404);
  }

  private matched(ticket: string, match: MatchResult): Response {
    return json({
      status: "matched",
      ticket,
      roomCode: match.code,
      needed: 0,
      cpuPlayers: match.cpuPlayers,
      cpuMode: match.cpuMode,
    });
  }

  private waiting(ticket: string): Response {
    const entry = this.state.queue.find((candidate) => candidate.ticket === ticket);
    return json({
      status: "waiting",
      ticket,
      players: Math.min(this.state.queue.length, MATCH_SIZE - 1),
      needed: Math.max(1, MATCH_SIZE - this.state.queue.length),
      fallbackInMs: entry ? Math.max(0, CPU_FALLBACK_MS - (Date.now() - entry.joinedAt)) : CPU_FALLBACK_MS,
    });
  }

  private async cancel(ticket: string): Promise<Response> {
    const before = this.state.queue.length;
    this.state.queue = this.state.queue.filter((entry) => entry.ticket !== ticket);
    delete this.state.results[ticket];
    if (before !== this.state.queue.length) await this.save();
    return json({ ok: true });
  }

  private async createRoom(cpuPlayers: number, lang: string, cpuMode: "rule" | "chatgpt"): Promise<string | null> {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 8; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
      const res = await stub.fetch(`https://do/create?code=${code}`, { method: "POST" });
      if (!res.ok) continue;
      if (cpuPlayers > 0) {
        const cpuRes = await stub.fetch(
          `https://do/add-cpus?count=${cpuPlayers}&lang=${encodeURIComponent(lang)}&mode=${cpuMode}`,
          { method: "POST" },
        );
        if (!cpuRes.ok) continue;
      }
      return code;
    }
    return null;
  }

  private async prune() {
    const now = Date.now();
    const queue = this.state.queue.filter((entry) => now - entry.joinedAt < QUEUE_TTL_MS);
    const results = Object.fromEntries(
      Object.entries(this.state.results).filter(([, result]) => result.expiresAt > now),
    );
    if (queue.length !== this.state.queue.length || Object.keys(results).length !== Object.keys(this.state.results).length) {
      this.state = { queue, results };
      await this.save();
    }
  }

  private async save() {
    await this.ctx.storage.put("state", this.state);
  }
}
