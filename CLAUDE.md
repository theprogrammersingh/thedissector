# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this product is

"The Dissector" turns a WhatsApp `.txt` chat export into a polished psychological "dossier" of the
group and its participants. It is **BYOK (bring-your-own-key) with no backend, ever** — cloud
provider calls go straight from the browser to the provider using the user's own key. There is also
a fully **on-device** path where no network call happens at all.

The privacy stance is deliberate, not an implementation shortcut. Don't introduce a server-side
component (including a proxy) without first flagging the CORS/ToS tradeoff in PRD §6 and §14.

Two planning docs live at the repo root: `the-dissector-prd.md` (requirements, roadmap, deferred
work) and `the-dissector-design-guidelines.md` (visual language, screen-by-screen UX).

## Current state

The app is **built and working end-to-end**: upload → participants → settings → forensics → consent
→ analysis → report → print-to-PDF. Six providers, an on-device model runtime, an in-browser
forensics pass, and a PWA shell. 273 tests pass via `npm test`.

## Architecture

```
Angular 21 SPA (zoneless, signals, standalone components, lazy routes)
 ├─ core/parsing/       WhatsApp .txt → normalized messages (Android/iOS formats differ),
 │                      transcript building, most-recent-N message capping
 ├─ core/forensics/     In-browser evidence, in a Web Worker: leverage metrics (pure arithmetic),
 │                      semantic "receipt" retrieval (MiniLM), emotion timeline (roberta)
 ├─ core/local-llm/     On-device generation: transformers.js on WebGPU in a second Worker,
 │                      8-model catalogue, download/cache management, device-lost recovery,
 │                      per-device limits persisted to localStorage
 ├─ core/providers/     One `LlmProvider` interface behind six adapters (Claude, Gemini, OpenAI,
 │                      Grok, DeepSeek, Local) + structured-output and markdown-fallback parsers
 ├─ core/prompts/       Cloud system prompt; `prompts/local/` holds the 3-pass on-device sequence
 │                      (group audit → per-participant dossiers → superlatives) and evidence pack
 ├─ core/state/         `SessionStore` — one signal store for the whole flow
 ├─ core/guards/        Four route guards gating the funnel
 └─ features/           One directory per screen, plus report/components/
```

### Constraints worth internalizing

- **Provider adapters stay behind one interface.** Model lineups shift fast; the orchestrator and
  UI must never depend on a specific provider's request/response shape.
- **Structured output first, markdown fallback second.** Prefer each provider's JSON-mode/tool-call
  schema; fall back to the lenient markdown parser only when that isn't respected.
- **Provider refusals are an expected, handled case, not a bug.** The system prompt asks for blunt
  content about real named people. Surface it plainly and let the user switch providers — do not
  prompt-engineer around a refusal.
- **The consent gate (FR-8) and anonymization toggle (FR-9) sit immediately before the API call.**
  That screen deliberately drops the case-file theme — see below.
- **The FR-10 disclaimer** must stay prominent on both the on-screen report and the PDF cover, and
  must remain in the accessibility tree.
- **On-device runs are bounded in two independent ways** and both matter: `LOCAL_MAX_MESSAGES`
  caps how much chat the forensics passes read, and `LOCAL_MAX_INPUT_TOKENS` caps the prompt. The
  second is not a settled number — read the docblock in `run-pass-with-retry.ts` before changing
  it; it separates what was measured from what was inferred.

### Things that are easy to get wrong

- **PDF export is `window.print()` plus a `@media print` stylesheet.** There is no pdfmake and no
  PDF library. The print design re-points the design tokens to ink-on-paper in `styles.scss`
  rather than overriding components one by one.
- **The app is zoneless.** A signal write does not update the DOM synchronously. Anything that
  reads the DOM right after setting a signal (printing is the live example) must wait for a render
  via `afterNextRender`.
- **`setParsedChat()` wipes all downstream state**, including settings. Anything that needs to
  survive a new upload either lives outside `SessionStore` (see `LocalLimitsService`) or is
  re-applied after the wipe (see the `?provider=` handling in `upload-page.ts`).
- **Response bodies are parsed inside the try block.** `analyze()` is called as `void`, so a throw
  becomes an unhandled rejection and the UI spins forever. Use `readJsonBody`/`readBodyText`.

## Design system

- Governing metaphor: **case file, not clinic** — evidence aesthetic, never borrowing the visual
  authority of a real mental-health tool.
- Palette: charcoal + warm off-white, **one** accent (crimson). Do not add a second accent. Two
  accent tiers exist for contrast: `--text-accent` on light, `--text-accent-on-dark` on charcoal.
- Typography: slab-serif/typewriter (Special Elite) for headers and data fields, clean sans (Inter)
  for body. Both are **self-hosted** in `public/fonts/` — do not reintroduce a font CDN.
- **Consent, privacy, API-key and error copy drop the theme.** Plain and honest, never in character.
- Motion respects `prefers-reduced-motion` and must be skippable.

## Commands

- `npm start` — dev server at `http://localhost:4200`.
- `npm run build` — production build to `dist/` (budgets: 500 kB warn / 1 MB error initial,
  4 kB/8 kB per-component style).
- `npm test` — Vitest via `@angular/build:unit-test`. Single file: `ng test -- src/path/to.spec.ts`.
- There is no lint script; ESLint is not configured (some `eslint-disable` comments are inert).

## Code conventions

- Standalone components throughout; signals for state; `inject()`; new control flow (`@if`/`@for`).
- TypeScript strict, plus `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
  `noImplicitReturns`, `noFallthroughCasesInSwitch` and Angular's `strictTemplates`. Satisfy them
  rather than loosening them.
- Prettier: 100-char width, single quotes, Angular parser for `.html`.
- Comments explain *why*, especially where a non-obvious constraint drove the code. Several
  files carry hard-won findings about WebGPU, ONNX dtypes and tokenizer behaviour — keep them
  accurate when the code moves under them.
