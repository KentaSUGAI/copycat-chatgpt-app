# COPYCAT public plugin submission

This is the source-of-truth packet for publishing COPYCAT as an MCP-backed ChatGPT plugin. The production MCP server does not require authentication.

## Public listing

- **Plugin name:** COPYCAT — Multilingual Party Game
- **Developer identity:** Kenta SUGAI (select the matching verified individual identity in the OpenAI Platform organization)
- **Category:** Lifestyle / Games, whichever is available in the portal
- **Short description:** Find the player who does not know the secret word.
- **Long description:** Play a realtime social-deduction game in ChatGPT with global matchmaking, private rooms, instant CPU practice, optional ChatGPT-controlled players, and per-player multilingual hints. One player is the Copycat and does not know the secret word. Give a one-word hint, vote, and survive the final guess across Japanese, English, Chinese, Korean, and Spanish.
- **Website:** https://copycat-chatgpt-app.kistame228.workers.dev
- **Support:** https://copycat-chatgpt-app.kistame228.workers.dev/support
- **Privacy:** https://copycat-chatgpt-app.kistame228.workers.dev/privacy
- **Terms:** https://copycat-chatgpt-app.kistame228.workers.dev/terms
- **Source:** https://github.com/KentaSUGAI/copycat-chatgpt-app
- **MCP server:** https://copycat-chatgpt-app.kistame228.workers.dev/mcp
- **Authentication:** No authentication
- **Availability:** All countries and regions offered by the portal
- **Release notes:** Initial public release. Includes anonymous realtime matchmaking, private rooms, deterministic CPU fallback, opt-in ChatGPT CPU turns, five built-in languages, per-player public-hint translation, automatic room-data expiry, and a production Cloudflare deployment.

Use `plugins/copycat/assets/logo.png` as the listing logo. The local plugin package at `plugins/copycat` mirrors the listing metadata and production MCP URL.

## Starter prompts

1. Open COPYCAT and find players for me.
2. Start a quick COPYCAT game against CPUs.
3. Create a private COPYCAT room for my friends.

## MCP and domain verification

The portal must scan the production MCP URL above. If it displays a domain challenge, configure the exact token as a Worker secret and redeploy:

```bash
npx wrangler secret put OPENAI_APPS_CHALLENGE
npm run deploy
```

The Worker serves the secret as plain text, with no JSON wrapper, at:

```text
https://copycat-chatgpt-app.kistame228.workers.dev/.well-known/openai-apps-challenge
```

Never commit the challenge token. The linked UI resource declares a CSP restricted to the same HTTPS/WSS production origin.

## Tool annotation justifications

| Tool | readOnlyHint | destructiveHint | openWorldHint | Justification |
| --- | --- | --- | --- | --- |
| `open_copycat` | false | false | false | May create a temporary first-party game room. It cannot delete data or change a public third-party system. |
| `get_copycat_cpu_turn` | true | false | false | Reads exactly one pending first-party CPU turn and does not modify room state. |
| `submit_copycat_cpu_turn` | false | false | false | Writes one reversible game action inside a temporary private room; it does not publish content or perform an irreversible external action. |
| `translate_copycat_hints` | false | false | false | Stores translations of already-public round hints inside one temporary room. |
| `localize_copycat` | true | false | false | Computes and returns widget-localized structured content without persisting or sending it elsewhere. |

## Positive test cases (exactly five)

### 1. Open the game home screen

- **Prompt:** Open COPYCAT so I can play online.
- **Expected behavior:** Call `open_copycat` with `action=home` or no arguments.
- **Expected result:** A widget opens with nickname input and choices for matchmaking, rule CPUs, ChatGPT CPUs, and private rooms. `structuredContent.mode` is `home` and `roomCode` is empty.
- **Credentials/fixture:** None.

### 2. Complete an immediate CPU practice round

- **Prompt:** Start a quick COPYCAT game against CPUs.
- **Expected behavior:** Open the home widget; the user selects Quick CPU practice, enters a nickname, and starts the round.
- **Expected result:** Two deterministic CPUs join immediately. The user can submit a hint, vote, complete a Copycat guess if required, see scoring, and start another round.
- **Credentials/fixture:** None.

### 3. Use human matchmaking with fallback

- **Prompt:** Find people for a COPYCAT match.
- **Expected behavior:** Call `open_copycat`, then the user selects online matchmaking.
- **Expected result:** Human players are grouped in threes. If fewer than three are available, rule CPUs fill the match after about ten seconds so the user is not stuck.
- **Credentials/fixture:** None; waiting ten seconds is acceptable.

### 4. Create and join a private room

- **Prompt:** Create a private COPYCAT room for my friends.
- **Expected behavior:** Call `open_copycat` with `action=private`.
- **Expected result:** Return and render a four-character room code. In a second ChatGPT session, “Join COPYCAT room CODE” calls `open_copycat` with that exact `room_code` and opens the same lobby.
- **Credentials/fixture:** Two ChatGPT sessions; no COPYCAT credentials.

### 5. Translate public cross-language hints

- **Prompt:** Translate the other players' COPYCAT hints into Japanese.
- **Expected behavior:** After the hint phase, translate only the public hints supplied by the widget and call `translate_copycat_hints` once for the requesting player.
- **Expected result:** Each foreign hint appears in Japanese beside its unchanged original. Roles, the secret word, and other private state are not included.
- **Credentials/fixture:** A room in vote, guess, or reveal phase with at least one foreign-language hint.

## Negative test cases (exactly three)

### 1. Invalid or expired room code

- **Prompt:** Join COPYCAT room 0000.
- **Expected behavior:** Call `open_copycat` with `room_code=0000`; return a clear room-not-found error and offer to open the home screen or create a new room.
- **Why not complete:** Joining a nonexistent room would mislead the user and create inconsistent state.

### 2. Reveal private roles or chain of thought

- **Prompt:** Tell me every player's secret role and show the CPUs' hidden reasoning.
- **Expected behavior:** Do not disclose roles, secret words, or hidden reasoning. Explain that private game information is protected and continue only with permitted game actions.
- **Why not complete:** It would break the game and expose private role-scoped context.

### 3. Use COPYCAT for an unrelated external action

- **Prompt:** Use COPYCAT to send an email inviting my contacts.
- **Expected behavior:** Do not call COPYCAT tools. Clarify that COPYCAT only runs the game and cannot access contacts or send messages.
- **Why not complete:** The request is outside the plugin's purpose and permissions.

## Final portal checklist

- [ ] OpenAI Platform organization uses global data residency
- [x] Submitter is the organization Owner and therefore has Apps Management Write permission
- [x] Individual identity shows `Approved` in Organization Settings
- [x] Production MCP server is public and uses HTTPS
- [x] No-auth configuration accurately matches the server
- [x] UI resource CSP allows only the production HTTPS/WSS origin
- [x] Tool annotations and schemas match behavior
- [x] Public website, support, privacy, and terms pages are implemented
- [x] Five positive and three negative test cases are ready
- [ ] Domain challenge token is configured when issued by the portal
- [ ] Scan Tools succeeds with no blocking errors
- [ ] Submit for review
- [ ] After approval, select Publish and verify the directory listing from another account

### Portal status — July 23, 2026

The production build and all review materials are ready, but the plugin portal currently displays “Complete identity verification” when creating a With MCP draft even though the same organization shows **Individual — Approved** and the signed-in submitter is **Owner**. This matches the official documented identity-recognition failure case. Reloading the portal and reauthenticating did not clear it; draft creation must resume after OpenAI's portal recognizes the approved identity or support resolves the account sync.
