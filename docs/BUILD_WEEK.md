# OpenAI Build Week development record

This document distinguishes Build Week work and records how Codex with GPT-5.6 contributed to COPYCAT. The submission period began July 13, 2026.

## July 19, 2026 — Product and architecture

- Defined COPYCAT as a ChatGPT-native, multilingual social-deduction game in the Apps for Your Life category.
- Chose index-based topic synchronization so one room can render the same card independently in Japanese, English, Chinese, Korean, and Spanish.
- Chose Cloudflare Workers and Durable Objects for a deployable, low-cost MCP, matchmaking, and realtime room backend.
- Kept ChatGPT identity separate from application authentication and avoided collecting account data.
- Removed the requirement for an OpenAI API key or a local Codex bridge; ChatGPT handles optional personal hint assistance in the player's own conversation.

## July 19, 2026 — Core implementation

- Implemented the `open_copycat` MCP tool and `ui://widget/copycat.html` resource.
- Implemented room creation, WebSocket reconnects, host transfer, role assignment, hints, voting, final guesses, scoring, and replay.
- Implemented one-tap three-player matchmaking, ten-second CPU fallback, and instant CPU practice.
- Added an opt-in ChatGPT CPU mode. The player's current ChatGPT reads private per-CPU turn context and submits only final actions through two model-only MCP tools, keeping operator model cost at zero.
- Added a model-to-widget localization path: ChatGPT can translate the supplied English UI dictionary and current 16-word topic, then render the translated `structuredContent` through `localize_copycat`.
- Added ten built-in parallel-translated decks and five-language UI copy.
- Added responsive light/dark styling and reduced-motion support, plus an original GPT Image mascot with a validated alpha channel.

## July 19, 2026 — Verification and submission readiness

- Added E2E tests for MCP initialization and metadata, model-generated localization output, direct room-creation restrictions, matchmaking, rule CPU fallback/practice, ChatGPT CPU private context and action tools, private rooms, multilingual role privacy, hints, votes, final guesses, scoring, and the next round.
- Ran TypeScript and JavaScript checks successfully.
- Ran the complete E2E flow successfully against a local Cloudflare Worker.
- Added a one-command `npm run verify` path for judges.
- Updated MCP metadata against the current Apps SDK reference, including the standard UI resource URI, widget visibility, `noauth` compatibility mirror, and server instructions.
- Rewrote the README in English, added judge instructions, corrected CPU documentation, added an MIT license, and prepared the Devpost description and timed demo script.

## Codex collaboration

Codex with GPT-5.6 was used for implementation, architecture review, documentation research, test design, debugging, and submission preparation. Codex accelerated mechanical and cross-cutting work: keeping the server/client protocol aligned, updating five language surfaces, checking current Apps SDK metadata, and exercising multi-client game flows.

The human entrant made the defining product and engineering decisions: the game concept, intended audience, category, privacy boundary, cross-language index protocol, deployment platform, and cost model. Codex proposed and implemented changes under those constraints; the entrant reviewed the resulting behavior.

## Evidence to retain

- The Codex task containing the majority of the core implementation; run `/feedback` in that task and save its Session ID for Devpost.
- This dated record and the source file timestamps.
- The final Git commit history created before submission.
- The successful `npm run verify` output and, if useful, a screenshot of the three-language demo.

> Important: this working directory did not contain Git history when the submission audit was run on July 19. Initialize and push the repository before submission so the final judged snapshot is immutable and testable.
