---
name: add-copycat-topics
description: Add, translate, validate, and synchronize built-in COPYCAT topic cards. Use when a user asks to add, expand, revise, translate, or audit the multilingual 16-word decks in the copycat-chatgpt-app project.
---

# Add COPYCAT Topics

Add cards through the canonical browser dataset and let the project generator produce the server copy.

## Workflow

1. Confirm the repository by finding `package.json` with `name: copycat-chatgpt-app`.
2. Read `public/topics.js` and `scripts/sync-topics.mjs` before editing.
3. Append new cards to `TOPICS`. Never insert, reorder, or remove existing cards unless the user explicitly requests a compatibility-breaking migration; the numeric array position is persisted as `builtinId`.
4. Give every card:
   - a unique lowercase kebab-case `id`;
   - a `title` containing exactly the supported language keys from `SUPPORTED_LANGS`;
   - exactly 16 word objects, each containing a non-empty value for every supported language.
5. Keep all translations aligned by array index. Translate the same concept rather than a neighboring concept, regional substitute, explanation, or category label.
6. Choose 16 distinct, recognizable concepts of similar specificity. Avoid duplicate localized words inside a card, near-synonyms that become indistinguishable in another language, slurs, sexual content, and concepts unsuitable for a general party game.
7. Edit only `public/topics.js` by hand. Run `npm run topics:sync` to generate `src/topics.ts`; never hand-edit the generated file.
8. Run `npm run topics:check` and `npm run verify`. Fix every failure before handing off.
9. Inspect the diff. Expect the canonical card addition plus the corresponding generated English server card and count; reject unrelated generated changes.

## Translation Guidance

- Prefer the everyday noun or short phrase a native speaker would recognize on a game card.
- Keep capitalization and script natural for each language.
- Preserve proper nouns in their conventional localized form.
- If a concept has no concise unambiguous translation in every supported language, replace the concept across all languages.

## Completion Report

State the number and IDs of cards added, the resulting total card count, and whether both topic validation and the full test suite passed.
