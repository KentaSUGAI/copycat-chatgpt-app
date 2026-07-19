# YouTubeアップロード用メタデータ

ファイル: `~/Downloads/COPYCAT-demo.mp4`(1:46 / 1080p / 11.7MB)
サムネイル(任意): `~/Downloads/COPYCAT-thumbnail.png`
公開設定: **公開(Public)** — Build Weekの要件。限定公開は不可。

## Title

COPYCAT 😼 — a multilingual party game inside ChatGPT (OpenAI Build Week 2026)

## Description

```
COPYCAT is a social-deduction party game that lives inside ChatGPT.

Everyone sees the same 16-word board — in their own language (EN/JA/ZH/KO/ES,
parallel-translated decks; the server only shares card indexes). Everyone but
one secret Copycat knows the secret word. Drop one-word hints, vote for the
faker, and watch a caught Copycat steal the win by deducing the word.

How Codex & GPT-5.6 are used:
• AI players think inside each player's OWN ChatGPT: the widget requests a
  turn, ChatGPT reads one CPU's role-safe context via a private MCP tool
  (get_copycat_cpu_turn), GPT-5.6 reasons in your conversation, and only the
  final action is submitted (submit_copycat_cpu_turn). No API keys, zero
  operator inference cost.
• localize_copycat lets ChatGPT render the whole widget in any language on
  demand.
• Public hints from other languages are translated by each participant's own
  ChatGPT and shown beside the original, with no backend model API.
• The app itself was built during Build Week with Codex — game state machine,
  multilingual UI, E2E tests, and the mascot.

Backend: one Cloudflare Worker + Durable Objects (matchmaking, WebSocket game
state) — a referee that never calls a model.

▶ Play: https://copycat-chatgpt-app.kistame228.workers.dev
   (in ChatGPT: Settings → Apps & Connectors → add the /mcp endpoint, then say
   "open COPYCAT")
⚙ Code: https://github.com/KentaSUGAI/copycat-chatgpt-app

This demo shows real matchmaking and a real round on the deployed app, played
by three browsers in English, Japanese, and Korean.

#OpenAIBuildWeek #ChatGPT #Codex #GPT56
```

## アップロード手順

1. https://studio.youtube.com → 作成 → 動画をアップロード → `COPYCAT-demo.mp4`
2. タイトル・説明を上記からコピー
3. 「いいえ、子ども向けではありません」を選択
4. サムネイルに `COPYCAT-thumbnail.png`(任意)
5. 公開範囲: **公開** → URLをコピー
6. DevpostのVideo欄に貼り付け → **Submit**(締切: 7/21 17:00 PT = 日本時間 7/22 09:00)
