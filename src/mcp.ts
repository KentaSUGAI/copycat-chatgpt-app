import type { Env } from "./index";
import { BUILTIN_TOPIC_COUNT } from "./topics";

// ChatGPT Apps SDK 用の最小MCPサーバー実装(Streamable HTTP / JSON-RPC)。
// ChatGPTの「開発者モード → コネクタ追加」で https://<worker>/mcp を登録すると、
// 会話内から「COPYCATで遊ぼう」でウィジェットが開く。
// LLM推論はプレイヤー各自のアカウント側で行われるため、サーバー側のAIコストはゼロ。

const WIDGET_URI = "ui://widget/copycat.html";
const PROTOCOL_VERSION = "2025-06-18";

function widgetHtml(origin: string): string {
  return `<div id="app"></div>
<link rel="stylesheet" href="${origin}/style.css">
<script>window.__ORIGIN__ = ${JSON.stringify(origin)};</script>
<script src="${origin}/topics.js"></script>
<script src="${origin}/i18n.js"></script>
<script src="${origin}/app.js"></script>`;
}

function toolMeta(visibility: Array<"model" | "app"> = ["model", "app"]) {
  return {
    securitySchemes: [{ type: "noauth" }],
    ui: { resourceUri: WIDGET_URI, visibility },
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "COPYCATを準備しています…",
    "openai/toolInvocation/invoked": "COPYCATを開きました",
  };
}

function modelOnlyMeta() {
  return {
    securitySchemes: [{ type: "noauth" }],
    ui: { visibility: ["model"] },
  };
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

function validRoomCode(value: unknown): string {
  const code = typeof value === "string" ? value.toUpperCase().trim() : "";
  return /^[A-Z0-9]{4}$/.test(code) ? code : "";
}

function resourceMeta(origin: string) {
  return {
    ui: {
      prefersBorder: true,
      domain: origin,
      csp: {
        connectDomains: [origin, origin.replace(/^http/, "ws")],
        resourceDomains: [origin],
      },
    },
    "openai/widgetDescription": "ChatGPTにログインした参加者を3人ずつ自動マッチングする、多言語対応のCOPYCATゲーム画面です。",
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": origin,
    "openai/widgetCSP": {
      connect_domains: [origin, origin.replace(/^http/, "ws")],
      resource_domains: [origin],
    },
  };
}

async function createRoom(env: Env): Promise<string | null> {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const res = await stub.fetch(`https://do/create?code=${code}`, { method: "POST" });
    if (res.ok) return code;
  }
  return null;
}

export async function handleMcp(req: Request, origin: string, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, GET, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("MCP endpoint: POST JSON-RPC only", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body ?? {};

  // 通知(idなし)は202で受け流す
  if (typeof method === "string" && method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "copycat", version: "2.2.0" },
        instructions:
          "Open COPYCAT when the user asks to play COPYCAT or a multilingual social-deduction game. " +
          "Use action=home for matchmaking, action=private for a private room, or room_code to join friends. " +
          "When the widget asks you to operate ChatGPT CPU players, repeatedly call get_copycat_cpu_turn and submit_copycat_cpu_turn until pending is false. " +
          "When the widget asks you to translate public hints, translate only those hints and call translate_copycat_hints once. " +
          "When asked to translate the widget, call localize_copycat with translated UI strings while preserving placeholders and HTML tags.",
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: [
          {
            name: "open_copycat",
            title: "Play COPYCAT / COPYCATで遊ぶ",
            description:
              "一言ヒントで秘密ワードを知らない1人を探す多言語オンラインゲーム「COPYCAT」を開きます。通常はaction=homeで自動マッチング画面を表示します。友だち用の個室を作る場合はaction=private、既存の部屋へ入る場合はroom_codeを指定します。3人以上で遊べます。",
            inputSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["home", "private"],
                  description: "homeは自動マッチング画面、privateは友だち用の個室を作成。省略時はhome。",
                },
                room_code: {
                  type: "string",
                  description: "参加したい4文字の部屋コード(例: AB3K)。新規作成なら省略。",
                },
              },
              additionalProperties: false,
            },
            outputSchema: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["home", "private", "join"] },
                roomCode: { type: "string" },
                locale: { type: "string" },
              },
              required: ["mode", "roomCode"],
              additionalProperties: false,
            },
            securitySchemes: [{ type: "noauth" }],
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
            _meta: toolMeta(),
          },
          {
            name: "get_copycat_cpu_turn",
            title: "Read the next ChatGPT CPU turn",
            description:
              "Read exactly one pending ChatGPT-controlled CPU turn in a COPYCAT room. The result contains that CPU's private role, permitted secret information, the word grid, public hints, and valid player ids. Never reveal private role or secret data to the human. After reasoning privately, call submit_copycat_cpu_turn. Repeat until pending=false.",
            inputSchema: {
              type: "object",
              properties: { room_code: { type: "string", description: "Four-character COPYCAT room code." } },
              required: ["room_code"],
              additionalProperties: false,
            },
            securitySchemes: [{ type: "noauth" }],
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            _meta: modelOnlyMeta(),
          },
          {
            name: "submit_copycat_cpu_turn",
            title: "Play a ChatGPT CPU turn",
            description:
              "Submit the final action for one pending ChatGPT CPU turn. Use only the field matching the phase returned by get_copycat_cpu_turn: hint for hint, vote_for for vote, or guess_index for guess. Then read the next turn and continue until pending=false.",
            inputSchema: {
              type: "object",
              properties: {
                room_code: { type: "string" },
                cpu_pid: { type: "string" },
                hint: { type: "string", description: "One word, maximum 15 characters." },
                vote_for: { type: "string", description: "Player pid to vote for." },
                guess_index: { type: "integer", minimum: 0, maximum: 15 },
              },
              required: ["room_code", "cpu_pid"],
              additionalProperties: false,
            },
            securitySchemes: [{ type: "noauth" }],
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
            _meta: modelOnlyMeta(),
          },
          {
            name: "translate_copycat_hints",
            title: "Translate public COPYCAT hints",
            description:
              "Store concise translations of the current round's public hints for one player. Use only when the widget supplies the room code, requester pid, target locale, and original hints. Preserve player ids exactly, translate only hint text, and never reveal roles or secret information.",
            inputSchema: {
              type: "object",
              properties: {
                room_code: { type: "string", description: "Four-character COPYCAT room code." },
                requester_pid: { type: "string", description: "The requesting player's exact pid." },
                target_locale: { type: "string", description: "BCP 47 locale requested by that player." },
                translations: {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      pid: { type: "string", description: "Exact pid of the hint author." },
                      translation: { type: "string", description: "Concise translated hint, maximum 40 characters." },
                    },
                    required: ["pid", "translation"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["room_code", "requester_pid", "target_locale", "translations"],
              additionalProperties: false,
            },
            securitySchemes: [{ type: "noauth" }],
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
            _meta: modelOnlyMeta(),
          },
          {
            name: "localize_copycat",
            title: "Translate the COPYCAT widget",
            description:
              "Render COPYCAT with a ChatGPT-generated language pack. Use when the widget or user asks for a language not built in. Translate every supplied English UI key, preserve {placeholders} and simple HTML tags exactly, and optionally translate the current topic title plus all 16 words in index order.",
            inputSchema: {
              type: "object",
              properties: {
                room_code: { type: "string", description: "Current room code, or empty on the home screen." },
                locale: { type: "string", description: "BCP 47 locale tag." },
                language_name: { type: "string" },
                ui_copy: { type: "object", additionalProperties: { type: "string" } },
                topic_copy: {
                  type: "object",
                  properties: {
                    builtinId: { type: "integer", minimum: 0, maximum: BUILTIN_TOPIC_COUNT - 1 },
                    title: { type: "string" },
                    words: { type: "array", items: { type: "string" }, minItems: 16, maxItems: 16 },
                  },
                  required: ["builtinId", "title", "words"],
                  additionalProperties: false,
                },
              },
              required: ["locale", "language_name", "ui_copy"],
              additionalProperties: false,
            },
            securitySchemes: [{ type: "noauth" }],
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            _meta: toolMeta(["model"]),
          },
        ],
      });

    case "tools/call": {
      if (params?.name === "get_copycat_cpu_turn") {
        const code = validRoomCode(params?.arguments?.room_code);
        if (!code) return rpcError(id, -32602, "room_code must be four characters");
        const response = await roomStub(env, code).fetch("https://do/cpu-context");
        const context = await response.json();
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(context) }],
          structuredContent: context,
        });
      }

      if (params?.name === "submit_copycat_cpu_turn") {
        const code = validRoomCode(params?.arguments?.room_code);
        if (!code) return rpcError(id, -32602, "room_code must be four characters");
        const response = await roomStub(env, code).fetch("https://do/cpu-action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cpuPid: params?.arguments?.cpu_pid,
            hint: params?.arguments?.hint,
            voteFor: params?.arguments?.vote_for,
            guessIndex: params?.arguments?.guess_index,
          }),
        });
        const result = await response.json();
        if (!response.ok) return rpcError(id, -32602, JSON.stringify(result));
        return rpcResult(id, {
          content: [{ type: "text", text: `CPU turn accepted. Current phase: ${(result as any).phase}.` }],
          structuredContent: result,
        });
      }

      if (params?.name === "translate_copycat_hints") {
        const code = validRoomCode(params?.arguments?.room_code);
        if (!code) return rpcError(id, -32602, "room_code must be four characters");
        const response = await roomStub(env, code).fetch("https://do/hint-translations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requesterPid: params?.arguments?.requester_pid,
            targetLocale: params?.arguments?.target_locale,
            translations: params?.arguments?.translations,
          }),
        });
        const result = await response.json();
        if (!response.ok) return rpcError(id, -32602, JSON.stringify(result));
        return rpcResult(id, {
          content: [{ type: "text", text: `Translated ${(result as any).accepted} public hints for ${(result as any).targetLocale}.` }],
          structuredContent: result,
        });
      }

      if (params?.name === "localize_copycat") {
        const rawCode = params?.arguments?.room_code;
        const code = rawCode ? validRoomCode(rawCode) : "";
        if (rawCode && !code) return rpcError(id, -32602, "room_code must be four characters");
        const locale = String(params?.arguments?.locale || "en").slice(0, 35);
        const languageName = String(params?.arguments?.language_name || locale).slice(0, 40);
        const rawCopy = params?.arguments?.ui_copy;
        const uiCopy = rawCopy && typeof rawCopy === "object"
          ? Object.fromEntries(Object.entries(rawCopy).slice(0, 120).map(([key, value]) => [key.slice(0, 50), String(value).slice(0, 800)]))
          : {};
        const rawTopic = params?.arguments?.topic_copy;
        const topicCopy = rawTopic && Array.isArray(rawTopic.words) && rawTopic.words.length === 16
          ? {
              builtinId: Math.max(0, Math.min(BUILTIN_TOPIC_COUNT - 1, Number(rawTopic.builtinId) || 0)),
              title: String(rawTopic.title || "").slice(0, 80),
              words: rawTopic.words.map((word: unknown) => String(word).slice(0, 40)),
            }
          : null;
        return rpcResult(id, {
          content: [{ type: "text", text: `COPYCAT is now localized for ${languageName}.` }],
          structuredContent: { mode: code ? "join" : "home", roomCode: code, locale, languageName, uiCopy, topicCopy },
        });
      }

      if (params?.name !== "open_copycat") {
        return rpcError(id, -32602, `unknown tool: ${params?.name}`);
      }
      const requested = (params?.arguments?.room_code ?? "").toString().toUpperCase().trim();
      const action = params?.arguments?.action === "private" ? "private" : "home";
      if (requested && !/^[A-Z0-9]{4}$/.test(requested)) {
        return rpcError(id, -32602, "部屋コードは4文字です");
      }
      let code: string | null = requested || null;
      if (requested) {
        const stub = env.ROOM.get(env.ROOM.idFromName(requested));
        const st = (await (await stub.fetch("https://do/status")).json()) as { exists: boolean };
        if (!st.exists) return rpcError(id, -32602, `部屋「${requested}」は存在しません`);
      }
      if (!code && action === "private") code = await createRoom(env);
      if (action === "private" && !code) return rpcError(id, -32000, "部屋を作成できませんでした");
      const mode = requested ? "join" : action;
      const requestedLocale = params?._meta?.["openai/locale"] ?? "en";
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: code
              ? `部屋「${code}」を開きました。友だちには「ChatGPTのCOPYCATアプリで部屋 ${code} に参加して」と伝えてください。`
              : "COPYCATを開きました。オンライン対戦なら、名前を入力して「対戦相手を探す」を押してください。",
          },
        ],
        structuredContent: { mode, roomCode: code ?? "", locale: requestedLocale },
      });
    }

    case "resources/list":
      return rpcResult(id, {
        resources: [
          {
            uri: WIDGET_URI,
            name: "COPYCAT ゲーム画面",
            mimeType: "text/html;profile=mcp-app",
          },
        ],
      });

    case "resources/read": {
      if (params?.uri !== WIDGET_URI) return rpcError(id, -32602, `unknown resource: ${params?.uri}`);
      return rpcResult(id, {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: "text/html;profile=mcp-app",
            text: widgetHtml(origin),
            _meta: resourceMeta(origin),
          },
        ],
      });
    }

    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

function rpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
