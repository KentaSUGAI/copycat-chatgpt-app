# COPYCAT 😼

**A multilingual social-deduction party game that runs inside ChatGPT.**

Everyone sees the same 16-word grid, but one player—the Copycat—does not know the secret word. Give one-word hints, vote for the faker, and survive the final guess. Players can share one room while using Japanese, English, Chinese, Korean, or Spanish.

Built for the **OpenAI Build Week 2026** “Apps for Your Life” track with Codex and GPT-5.6.

## Why COPYCAT

- **Cross-language multiplayer:** the server sends card and word indexes, and each client renders the same game in its own language.
- **Four ways to play:** global human matchmaking, private rooms, instant rule-based CPU practice, or ChatGPT-controlled LLM CPUs.
- **Private rooms:** create a four-character room code for friends and support 3–10 players.
- **Player-funded intelligence:** ask the current ChatGPT conversation for a subtle hint or let that same ChatGPT operate two LLM CPU players through MCP turn tools. The game server never calls a model API.
- **ChatGPT-generated localization:** five languages are bundled for instant play. For another language, ChatGPT can call `localize_copycat` with a translated UI pack and optional 16-word card; the returned `structuredContent` renders in the widget.
- **Original GPT Image art:** the COPYCAT mascot was generated with GPT Image and post-processed into a transparent game asset.
- **No API key or separate account:** the Cloudflare backend is only the game referee. It does not run model inference or receive ChatGPT credentials.
- **Low-cost realtime backend:** one Worker serves the MCP endpoint and widget, while Durable Objects handle matchmaking and WebSocket game state.

## Play

Permanent deployment:

- App host: https://copycat-chatgpt-app.kistame228.workers.dev
- MCP endpoint: https://copycat-chatgpt-app.kistame228.workers.dev/mcp
- Source: https://github.com/KentaSUGAI/copycat-chatgpt-app

1. Sign in to ChatGPT and enable the deployed COPYCAT MCP app.
2. Ask: **“Let’s play COPYCAT.”**
3. Enter a nickname and choose online matchmaking, rule CPU practice, ChatGPT CPU, or a private room.
4. Submit a one-word hint, vote, and—if caught as the Copycat—guess the secret word.

COPYCAT is intentionally a ChatGPT App. Opening the production root URL in a normal browser shows an instruction screen; it does not create public game rooms.

## Architecture

```text
ChatGPT
  ├─ Conversation model
  │    └─ open_copycat MCP tool → open app / create room / join room
  └─ COPYCAT widget
       ├─ window.openai.callTool → private room actions
       ├─ window.openai.sendFollowUpMessage → hint, translation, and LLM CPU requests
       ├─ HTTPS → Matchmaker Durable Object
       └─ WebSocket → GameRoom Durable Object

Cloudflare Worker
  ├─ /mcp                 Streamable HTTP MCP server
  │    ├─ open_copycat / localize_copycat
  │    └─ get_copycat_cpu_turn / submit_copycat_cpu_turn
  ├─ /api/match           Three-player matchmaking + CPU fallback
  ├─ /ws/:code            Realtime room state
  └─ public/               ChatGPT widget assets
```

The MCP tools follow the current MCP Apps metadata shape: `_meta.ui.resourceUri` links render tools to the UI template, `_meta.ui.visibility` separates model-only CPU tools from widget-callable tools, and compatibility aliases are included for ChatGPT. ChatGPT supplies the requested locale as a client hint and mirrors it to the widget document; the app treats locale as presentation metadata, never authorization.

### CPU behavior and cost boundary

- **Rule CPU** is deterministic server code. It is instant, costs zero model tokens, and guarantees the judge can complete a round alone.
- **ChatGPT CPU** is selected explicitly. The widget asks the player's current ChatGPT to read one private CPU turn and submit only the final hint, vote, or guess through MCP. No hidden reasoning is exposed to the game or other players.
- ChatGPT CPU turns may require tapping **Let ChatGPT play the CPU turns** as each phase becomes ready. A widget can ask the host to post a follow-up message, but it cannot silently capture arbitrary model output as if it were a direct model API response.

## Run locally

Prerequisites: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

The Worker starts at `http://localhost:8787`. For a browser-only UI preview during development, open:

```text
http://localhost:8787/?preview=1&lang=en
```

The preview is only a local UI/test convenience. To test the actual ChatGPT bridge, expose the Worker through a public HTTPS tunnel and add `https://<host>/mcp` in ChatGPT Developer mode.

## Verify

Run the complete type, syntax, MCP, matchmaking, CPU, WebSocket, private-room, scoring, and multilingual test suite with one command:

```bash
npm run verify
```

You can also run the E2E test against an already-running Worker:

```bash
TEST_BASE=http://127.0.0.1:8787 npm run test:e2e
```

## Deploy

```bash
npx wrangler login
npm run deploy
```

The current production connector URL is `https://copycat-chatgpt-app.kistame228.workers.dev/mcp`. Register it as a no-auth custom app in ChatGPT Developer mode. No OpenAI API key or client-side process is required.

### Judge test path

1. Open the submitted live `/mcp` URL as a custom connector in ChatGPT Developer mode.
2. Ask ChatGPT to play COPYCAT.
3. Choose **Quick CPU practice** for an immediate full round, **Play with ChatGPT CPUs** to demonstrate per-account reasoning, or use three ChatGPT sessions to demonstrate multilingual matchmaking.
4. Repository verification requires only `npm install && npm run verify`; no credentials or sample data are needed.

## Privacy and security

The MCP tool uses `noauth` because it does not access user-specific data. ChatGPT sign-in does not forward ChatGPT account data or access tokens to this Worker. The client creates a temporary player ID in local storage; room state is short-lived. If persistent account data is added later, the app will need its own OAuth 2.1 flow following the Apps SDK authentication specification.

## How Codex and GPT-5.6 were used

Codex powered by GPT-5.6 was the primary engineering collaborator during Build Week. It was used to:

- implement and reconcile the Durable Object state machine, WebSocket protocol, MCP descriptors, and multilingual client contract;
- replace a local-bridge prototype with a deployable ChatGPT App architecture after checking Apps SDK boundaries;
- add online matchmaking, rule-based CPU fallback/practice, and an accessible responsive widget;
- build E2E coverage for MCP resources, room creation restrictions, three-player matching, roles, hints, votes, the Copycat comeback guess, scoring, and next-round state;
- inspect the official Build Week rules, align the repository with submission requirements, and verify the final project end to end.

Product decisions remained human-owned: a social game rather than a generic chatbot, index-based cross-language synchronization, no backend LLM cost, no reuse of ChatGPT identity as app authentication, a deterministic CPU fallback, and an opt-in ChatGPT CPU path powered by each player's own conversation.

See [docs/BUILD_WEEK.md](docs/BUILD_WEEK.md) for the dated development record and [docs/SUBMISSION.md](docs/SUBMISSION.md) for the Devpost copy and demo script.

## Project layout

```text
src/
  index.ts        Worker router
  matchmaker.ts   Matchmaker Durable Object and CPU fallback
  room.ts         GameRoom Durable Object and game state machine
  mcp.ts          ChatGPT MCP server and widget resource
  topics.ts       Server-side built-in card count
public/
  index.html      Widget entry
  app.js          ChatGPT bridge, WebSocket, and UI
  i18n.js         UI copy in five languages
  topics.js       Ten parallel-translated word decks
  style.css       Responsive light/dark UI
tests/
  run-e2e.mjs     One-command local Worker test harness
  e2e.mjs         MCP and multiplayer E2E suite
```

## License

[MIT](LICENSE)

---

<details>
<summary>日本語の概要</summary>

COPYCATは、ChatGPT内で遊ぶ3〜10人向けの多言語正体隠匿ゲームです。全員に同じ16単語が見えますが、1人だけ秘密ワードを知りません。一言ヒントと投票でコピーキャットを見つけます。日本語・英語・中国語・韓国語・スペイン語を同じ部屋で同時に使えます。

オンライン対戦は3人を自動マッチングし、10秒以内に相手が見つからなければルールCPUが参加します。「クイック練習」なら審査員1人ですぐに全ラウンドを確認でき、「ChatGPT CPU」では参加者自身のChatGPTがMCP経由でCPUのヒント・投票・推理を担当します。OpenAI APIキー、追加ログイン、ローカルブリッジは不要です。

</details>
