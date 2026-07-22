import { GameRoom } from "./room";
import { Matchmaker } from "./matchmaker";
import { handleMcp } from "./mcp";

export { GameRoom, Matchmaker };

export interface Env {
  ROOM: DurableObjectNamespace;
  MATCH: DurableObjectNamespace;
  ASSETS: Fetcher;
  OPENAI_APPS_CHALLENGE?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

function publicOrigin(req: Request, url: URL): string {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;

  let scheme = forwardedProto;
  if (!scheme) {
    try {
      scheme = JSON.parse(req.headers.get("cf-visitor") || "null")?.scheme;
    } catch {
      // Ignore malformed proxy metadata and fall back to the request URL.
    }
  }

  // Wrangler's temporary Cloudflare Tunnel forwards to the local Worker over
  // HTTP, but ChatGPT must receive public HTTPS/WSS widget URLs.
  if (!scheme && forwardedHost.endsWith(".trycloudflare.com")) scheme = "https";
  if (scheme === "http" || scheme === "https") return `${scheme}://${forwardedHost}`;
  return url.origin;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/.well-known/openai-apps-challenge" && req.method === "GET") {
      const token = env.OPENAI_APPS_CHALLENGE?.trim();
      if (!token) return new Response("Not configured", { status: 404 });
      return new Response(token, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    // ChatGPT renders the widget on a sandboxed OpenAI origin. JSON POSTs to
    // the public Worker therefore require a successful CORS preflight before
    // matchmaking can begin inside the widget.
    if (req.method === "OPTIONS" && (url.pathname === "/mcp" || url.pathname.startsWith("/api/"))) {
      return corsPreflight();
    }

    // ChatGPT Apps (MCP) エンドポイント
    if (url.pathname === "/mcp") {
      return handleMcp(req, publicOrigin(req, url), env);
    }

    // 部屋の存在確認
    const statusMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})$/);
    if (statusMatch && req.method === "GET") {
      const stub = env.ROOM.get(env.ROOM.idFromName(statusMatch[1]));
      const res = await stub.fetch("https://do/status");
      return json(await res.json());
    }

    // 匿名のオンライン自動マッチング。ChatGPTのログイン情報には依存せず、
    // ウィジェットごとの一時IDを3人ずつ同じゲームルームへ割り当てる。
    if (url.pathname === "/api/match" && req.method === "POST") {
      const stub = env.MATCH.get(env.MATCH.idFromName("global"));
      return stub.fetch("https://matchmaker/match", req);
    }
    const matchTicket = url.pathname.match(/^\/api\/match\/([a-f0-9-]{36})$/);
    if (matchTicket && (req.method === "GET" || req.method === "DELETE")) {
      const stub = env.MATCH.get(env.MATCH.idFromName("global"));
      return stub.fetch(`https://matchmaker/match/${matchTicket[1]}`, req);
    }

    // WebSocket接続
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{4})$/);
    if (wsMatch) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(wsMatch[1]));
      return stub.fetch(req);
    }

    const publicPage = {
      "/privacy": "/privacy.html",
      "/terms": "/terms.html",
      "/support": "/support.html",
    }[url.pathname];
    if (publicPage && (req.method === "GET" || req.method === "HEAD")) {
      const assetUrl = new URL(publicPage, url.origin);
      return env.ASSETS.fetch(new Request(assetUrl, req));
    }

    // 静的アセットはChatGPTウィジェット用。通常ブラウザでは案内だけを表示する。
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
