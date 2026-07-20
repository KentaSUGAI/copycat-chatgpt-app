# OpenAI Build Week — Submitted Entry

> **2026-07-20 提出完了。** 〆切: **2026-07-21 17:00 PT（日本時間 7/22 09:00）**
> 提出物: 3分以内の公開動画、リポジトリ、README、CodexセッションID、テスト用URL
> 公開ページ: https://devpost.com/software/copycat-a-multilingual-party-game-inside-chatgpt

## Project name

**COPYCAT 😼 — a multilingual party game inside ChatGPT**

## Category

Apps for Your Life

## Elevator pitch (200 chars)

A multilingual social-deduction game inside ChatGPT. Match people, use instant rule CPUs, or let your own ChatGPT operate LLM players—without an API key, bridge, install, or separate login.

## Description

COPYCAT is social deduction for 3–10 players. Everyone sees the same 16-word grid, but one secret Copycat does not know the secret word. Players submit one-word hints, vote for the faker, and a caught Copycat gets one final chance to guess the word.

**What is different:**

1. **Cross-language multiplayer.** Built-in decks are parallel-translated in Japanese, English, Chinese, Korean, and Spanish. The server shares only card and word indexes, so every player sees the same game in their selected language. When free-form hints become public, each participant's own ChatGPT translates foreign hints into that participant's language; the room caches those translations and displays them beside the original.

2. **Every social configuration works.** Every participant opens COPYCAT from ChatGPT, enters a nickname, and chooses global matchmaking, a private room, instant rule CPU practice, or ChatGPT CPUs. Matchmaking groups three people and falls back to rule CPUs after ten seconds so one judge can always finish a round.

3. **Per-account LLM play, without operator inference cost.** The Cloudflare backend never calls an LLM. In ChatGPT CPU mode, the widget posts a turn request to the player's current ChatGPT. The model reads one CPU's role-safe context through `get_copycat_cpu_turn`, reasons in that user's conversation, and sends only its final action through `submit_copycat_cpu_turn`.

4. **Model-to-widget translation.** Five languages are bundled for zero-latency play. For any other language, the widget supplies its English copy and current card to ChatGPT; `localize_copycat` returns the model-generated language pack as `structuredContent`, and a localized widget is rendered without an app-side model API.

5. **Near-zero-cost multiplayer infrastructure.** A Cloudflare Worker serves the MCP endpoint, matchmaking API, and widget assets; one global Durable Object matches players and one Durable Object per room runs the WebSocket state machine. Built-in decks and rule CPU behavior keep the core round playable even when no model turn is requested.

**How we used Codex:**

- Codex completed the game state machine, reconciled the multilingual UI and server contracts, and added MCP/WebSocket E2E coverage.
- Codex added per-player realtime hint translation through `translate_copycat_hints`, preserving the original answer and the no-operator-API-cost boundary.
- Codex consolidated topic authoring behind a validated generator and created a repository-local `$add-copycat-topics` skill so new five-language decks can be appended safely.
- Codex migrated the product from a local `codex app-server` bridge prototype to a true ChatGPT App-only architecture after validating the Apps SDK authentication and component-bridge boundaries.
- Codex verified the Cloudflare deployment bundle, MCP descriptors, responsive UI, and complete three-player round flow.
- Codex added one-tap matchmaking and redesigned the widget with the Apple Design skill: clear hierarchy, immediate feedback, quiet translucent materials, dark mode, and reduced-motion support.
- Codex used GPT Image to create the original COPYCAT mascot and integrated the alpha asset into the responsive widget.
- Codex prepared a one-command judge verification path and aligned the MCP metadata, English README, license, and submission materials with the official Build Week rules.
- Primary Codex `/feedback` Session ID: `019f7a47-ad85-76d2-a22c-9086b8be71ca`

## Built with

chatgpt-apps, apps-sdk, mcp, cloudflare-workers, durable-objects, websocket, javascript, typescript, codex

## Try it

- Live app: https://copycat-chatgpt-app.kistame228.workers.dev
- MCP endpoint: https://copycat-chatgpt-app.kistame228.workers.dev/mcp
- Repo: https://github.com/KentaSUGAI/copycat-chatgpt-app
- Demo video: https://youtu.be/nNtECjvOBXA
- Codex `/feedback` Session ID: `019f7a47-ad85-76d2-a22c-9086b8be71ca`
- Requirement: a ChatGPT login with the COPYCAT app enabled. No API key or local bridge is needed.

## Demo video script (≤3 min)

1. **0:00** — Hook: “One of these players does not know the secret word.”
2. **0:15** — Ask ChatGPT to open COPYCAT; enter a nickname and tap “Find players.”
3. **0:35** — Show ChatGPT CPU mode: start a round and tap “Let ChatGPT play the CPU turns,” then show the model calling the private turn/action tools. Use quick rule CPU practice first when recording a guaranteed complete round.
4. **0:58** — Show the same card rendered in Japanese and English and the private role/secret views.
5. **1:22** — Submit hints, show a foreign hint translated beside its original, vote, and demonstrate the Copycat’s final comeback guess.
6. **1:55** — Press “Translate with ChatGPT” and render one additional language through `localize_copycat`.
7. **2:20** — Architecture: ChatGPT MCP tools + widget → Cloudflare Worker/Durable Object. Emphasize per-account model reasoning, deterministic fallback, and no operator API key.
8. **2:43** — Show `npm run verify`, repository, and live app URL. Close by 2:55.

## Submission checklist

- [x] Add the Codex session ID required by the event rules (`019f7a47-ad85-76d2-a22c-9086b8be71ca`)
- [x] Add an English README, MIT license, judge test path, and dated Codex development record
- [x] Pass type/syntax checks and the full local MCP/WebSocket E2E suite
- [x] Push the repository to `https://github.com/KentaSUGAI/copycat-chatgpt-app`
- [x] Run `npx wrangler login` and `npm run deploy`
- [x] Pass the complete MCP/WebSocket E2E suite against the permanent production URL
- [x] Register the permanent deployed `/mcp` endpoint in ChatGPT and complete an in-ChatGPT CPU round smoke test
- [x] Run `npm run verify` once more from a clean checkout of the public GitHub repository
- [x] Record a demo shorter than three minutes (`~/Downloads/COPYCAT-demo.mp4`, 2:07, narrated in English, includes the per-player hint-translation feature; upload metadata in `docs/YOUTUBE.md`)
- [x] Upload the demo to YouTube as **Public** (`https://youtu.be/nNtECjvOBXA`)
- [x] Add the public repository URL above and to the Devpost public project page
- [x] Submit through Devpost with Japan as the country of residence; verify the public page shows “Project submitted!” and “Submitted to OpenAI Build Week”
