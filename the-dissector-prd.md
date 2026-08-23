# Product Requirements Document — "The Dissector"

**Status:** v1.0 — built, pre-release
**Owner:** Simar Preet Singh
**Platform:** Web app (Angular 21), deployed at https://thedissector.programmersingh.dev
**Date:** August 2026 (revised 23 Aug 2026)

> **Read §0 first.** The app has been built, and it diverges from this document in several places
> that matter. §0 records what actually shipped and what is knowingly deferred; where §0 and a
> later section disagree, §0 is correct.

> "The Dissector" is confirmed as the product name (same as the AI persona).
> Design direction lives in a companion document: `the-dissector-design-guidelines.md`. §14 below summarizes it and lists the requirements it adds.

---

## 0. As-built addendum (23 Aug 2026)

### What shipped differently from this document

- **A sixth provider, and a whole second mode.** Alongside Claude, Gemini, GPT and Grok, the app
  ships **DeepSeek** and an **on-device** provider. On-device runs use transformers.js on WebGPU in
  a Web Worker with an eight-model catalogue, and make **no network call at all** beyond the
  one-time model download. This document was written before that existed and does not otherwise
  account for it.
- **PDF export is `window.print()` with a dedicated print stylesheet, not pdfmake** (FR-5, §6).
  pdfmake was never installed. The print design re-points the design tokens to ink-on-paper so the
  output reads as a document rather than a printed web page.
- **There is no IndexedDB persistence and no history** (FR-6). Nothing is stored but two on-device
  limits and an install-banner dismissal, both in `localStorage`. Reports are not persisted.
- **A forensics step was added to the flow** (§4), between settings and consent: the browser
  measures the chat — leverage metrics, semantically retrieved "receipts", an emotion timeline —
  before anything is sent. On-device runs send those findings *instead of* the transcript.
- **On-device runs are capped** to the most recent 2,000 messages by default, adjustable per
  device. The forensics passes read every message one at a time, and that is the slow part.

### Deferred — known and accepted for now

Findings from the pre-release audit that were triaged and consciously not fixed. None is a
correctness bug in the happy path; each is a real gap.

**Process**
- **Version control.** At audit time the entire application was untracked — one commit, with
  `src/app/core`, `features` and `shared` unstaged. The owner is handling git directly.
- `README.md` is still Angular CLI boilerplate.

**Security & operations**
- **No Content-Security-Policy and no security headers.** There is no host config file in the repo
  to carry them. For an app holding a live API key in memory, a `script-src` policy is the main
  defence against a supply-chain injection exfiltrating it.
- **No error boundary and no 404 route.** An unknown URL silently lands on the landing page; an
  unexpected throw mid-flow blanks the router outlet with no recovery path.
- Gemini receives the API key as a query parameter. It is Google's documented pattern, but the
  most interceptable placement of the five adapters.
- No `robots.txt` or `sitemap.xml`.

**Accessibility**
- No focus management or skip link on route change; no route-change announcement.
- The participant rename `<input>` and the merge `<select>` have no accessible label.
- The install banner uses `role="dialog"` for a passive, non-modal banner.
- A low-contrast focus border in `participant-preview-page.scss` (~1.3:1).

**Performance & correctness**
- **Chat parsing still runs on the main thread**, so a very large export freezes the UI. §6 calls
  for Web Worker parsing; the worker infrastructure exists for two other jobs but not this one.
- `reduced-motion.ts` leaks a `matchMedia` listener per visit to `/analysis`.
- `Continue` on the forensics screen is unguarded while a pass is running (Back now prompts).
- No `bundle` budget in `angular.json`, so the ~544 kB transformers chunk is unbudgeted.

**Tidiness**
- Two divergent `formatBytes` implementations; model sizes hardcoded in four places; roughly a
  dozen exported symbols never imported; `AnalysisMetadata.consentGivenAt` is populated but never
  surfaced.

### Open question carried forward

**The on-device input ceiling is not a settled number.** Prompts above roughly 8,000 tokens fail
with an onnxruntime `SafeIntOnOverflow` integer overflow on a large chat, while a few hundred
tokens succeed. The default is a conservative 2,000, and the worker logs the real tokenized length
of every pass so the true limit can be found on actual hardware. The arithmetic that suggests
~2,048 rests on three unverified assumptions and should not be treated as established — see the
docblock on `LOCAL_MAX_INPUT_TOKENS`.

---

## 1. Overview

The Dissector is a web app that ingests a raw WhatsApp chat export (.txt), runs it through a user-selected LLM using a pre-built forensic-psychology system prompt, and outputs a polished, shareable PDF report profiling the group dynamic and every participant in it — archetypes, motivations, "red flags," superlatives, and a closing verdict per person.

It's a BYOK (bring-your-own-key) tool: the user supplies their own API key for Gemini, GPT, Claude, or Grok, and the app is a thin, well-designed client around that model call plus a document renderer.

## 2. Goals

**Product goals**
- Turn a wall of chat text into a genuinely well-formatted, "worth screenshotting" PDF in under a couple of minutes.
- Support all four major model providers interchangeably behind one settings screen.
- Make the report generation feel deliberate and structured (not a raw LLM text dump) — the PDF should look like a designed artifact, not a ChatGPT export.

**Non-goals (v1)**
- No accounts, no server-side storage of chats or API keys, no multi-user collaboration.
- No mobile app — responsive web only.
- No claim to clinical accuracy. This is explicitly framed as entertainment/self-reflection, not diagnosis (see §9).

## 3. Target Users

- Individuals who want a novelty/insight report on their friend group chat, a situationship, or a relationship, to read for themselves or share with the group.
- Primary distribution channel is likely social (screenshots of superlatives, "the verdict quote"), similar to how whatbrandonthinks spread — worth designing the PDF with that virality in mind (shareable pull-quotes, clean pull-out cards).

## 4. Core User Flow

1. User lands on app → pastes/uploads WhatsApp `.txt` export.
2. App parses it locally (sender, timestamp, message) and shows a quick preview: participant list, message count, date range.
3. User goes to Settings → picks provider (Gemini / GPT / Claude / Grok), pastes API key, picks model.
4. User confirms a consent/scope checkbox (see §9) and hits "Dissect."
5. App chunks/sends the chat + system prompt to the selected model, shows a progress state (this can take a while on long chats).
6. Structured response is parsed into sections (Group Audit, Individual Dossiers, Superlatives).
7. App renders a live in-browser preview of the formatted report.
8. User clicks "Export PDF" → polished PDF is generated client-side and downloaded.

## 5. Functional Requirements

### FR-1: Chat Ingestion & Parsing — P0
- Accept `.txt` WhatsApp export (both Android and iOS export formats differ slightly in timestamp/line format — parser needs to handle both).
- Extract sender, timestamp, message body; group into a normalized internal format.
- Detect and list distinct participants; let the user rename/merge duplicate identifiers (WhatsApp exports sometimes show phone numbers instead of saved names).
- Handle media/omitted-message placeholders (`<Media omitted>`) gracefully — exclude or flag them, don't feed noise to the model.
- Show basic stats pre-analysis: message count, participants, date range, longest gap (useful both as UX polish and as a rough proxy for whether the chat is long enough to be worth analyzing).

### FR-2: Provider & Model Configuration — P0
- Settings panel with:
  - Provider selector: Gemini, OpenAI (GPT), Anthropic (Claude), xAI (Grok).
  - API key input (masked, stored client-side only — see §8).
  - Model dropdown scoped to the selected provider (e.g., don't hardcode one Claude model — providers rev their model lineup often).
  - Optional advanced fields: temperature, max output tokens.
- "Test connection" action that does a minimal validation call before the user commits to a full analysis run (avoids burning a large context-window call just to discover a bad key).
- Clear error surfacing per provider (invalid key, rate limit, context-length-exceeded, content-policy refusal — these are meaningfully different failure modes and the user needs to know which one happened, especially the last one, see §9).

### FR-3: Analysis Engine — P0
- Send the existing system prompt + the parsed chat as the analysis request.
- **Chunking strategy for long chats:** WhatsApp exports can run to tens of thousands of messages, easily exceeding context windows (this varies a lot by provider/model — plan for the smallest, not the largest). Options to design for:
  - Let the user select a date range or trim to the most recent N messages.
  - Map-reduce approach: summarize the chat in windows, then run the full analytical framework over the summaries — more complex, but needed for chats that meaningfully exceed a single context window.
  - MVP can start with hard truncation + a visible warning, and add smarter chunking in v2.
- Request structured output where the provider supports it (e.g., JSON mode / tool-call-style schema) rather than parsing free-form markdown — this makes PDF rendering far more reliable across four different providers with four different formatting habits.
- Have a lenient markdown-based fallback parser for providers/models where structured output isn't available or the model doesn't respect it perfectly.

### FR-4: Report Rendering (In-App Preview) — P0
- Render the parsed sections into a live preview matching the PDF's actual layout (WYSIWYG, not a separate "then export and hope" step):
  - Group Dynamic Audit
  - Individual Psychological Dossiers (one card per participant)
  - Superlatives & Awards
- Each individual dossier collapsible/expandable in the preview for long chats with many participants.

### FR-5: PDF Export — P0
- Client-side PDF generation (keeps chat data from ever touching your own backend — see §8) via a library such as `pdfmake` (better for structured, multi-section documents with headers/typography control than raw `jsPDF`).
- Branded template: cover page with "The Dissector" masthead, participant name, generation date; consistent typography for archetype titles, verdict quotes, superlative badges.
- Design pull-quote/verdict-quote elements to look good as a standalone cropped image — this is the artifact people will actually screenshot and share.

### FR-6: History & Local Persistence — P1
- Since there's no backend, persist recent reports in IndexedDB so users don't lose a report if they navigate away, with a clear "stored only on this device" indicator.
- Manual export/re-download of past reports; explicit delete.

### FR-7: Settings & Preferences — P1
- Remember last-used provider/model (not the key itself beyond the session, unless the user opts in — see §8).
- Toggle for anonymized mode (see §9).

### FR-11: Analysis Loading State — P1
- A dedicated in-progress state for the (potentially slow) analysis call — not a bare spinner. See design guidelines §5 for the concept (redaction-sweep reveal / rotating status line).
- Must be interruptible/skippable and respect `prefers-reduced-motion`.

### FR-12: Shareable Verdict Card Export — P1
- In addition to the full PDF (FR-5), let the user export a single participant's verdict card cropped to a social-share aspect ratio, directly from the report view. See design guidelines §5 (Export) — this is expected to be a bigger distribution driver than the full PDF.

## 6. Technical Architecture

```
Angular SPA
 ├─ Chat Parser Module        (pure TS, WhatsApp .txt → normalized messages)
 ├─ LLM Provider Layer        (adapter interface: send(prompt, chat) → structured result)
 │    ├─ GeminiAdapter
 │    ├─ OpenAIAdapter
 │    ├─ ClaudeAdapter
 │    └─ GrokAdapter
 ├─ Analysis Orchestrator     (chunking, retries, structured-output parsing/fallback)
 ├─ Report Renderer           (Angular components → live preview)
 ├─ PDF Export Service        (pdfmake, template + branding)
 └─ Local Storage Layer       (IndexedDB: keys session-only by default, reports persisted)
```

- **No backend — confirmed.** All provider calls go directly from the browser to the provider's own API using the user's own key. This is a deliberate privacy-by-design choice (see §8), not just a cost-saving one — it means you're never a party holding other people's private chat logs on a server.
- Recommend a strict adapter interface so adding/removing a provider (models change fast — expect Grok/Gemini model names to shift within months) doesn't touch the orchestrator or UI.
- CORS: confirm each provider's API allows direct browser calls with an API key (some providers historically required a backend proxy for browser-origin requests — verify current docs per provider before committing to the no-backend architecture, since this is the one thing that could force a backend into v1).

## 7. Non-Functional Requirements

- **Performance:** Parsing a chat with 50k+ messages should stay responsive (use a Web Worker for parsing if it blocks the main thread).
- **Reliability:** Distinguish and handle provider timeouts, rate limits, and context-length errors distinctly in the UI (see FR-2).
- **Portability:** Works on latest Chrome/Firefox/Safari; no dependency on server-side rendering.

## 8. Data Privacy & Security

This product's entire input is other people's private messages, plus a user-supplied API key — both are sensitive by default.

- **API keys:** never sent anywhere except directly to the provider's own API from the browser. Default to session-only storage (cleared on tab close); persistent storage only behind an explicit "remember this key on this device" opt-in, and even then keep it in IndexedDB, not `localStorage` in plaintext if avoidable.
- **Chat content:** never persisted server-side because there is no server. Be explicit about this in-product ("Your chat is sent only to [Provider] and never touches our servers") — it's both an honest privacy stance and a trust-building feature to surface in the UI itself.
- **Third-party data:** the friends/partner in the chat are not the user of your app, and their messages are being sent to a third-party AI provider without their knowledge. That's worth a plain-language notice to the person exporting the chat (see §9) — not just a legal CYA, but genuinely relevant since sharing someone else's private messages with a third party is legally sensitive in some jurisdictions (varies by region — not something to guess at without a lawyer if this grows beyond a hobby project).

## 9. Trust, Safety & Positioning

Worth treating as first-class requirements, not an afterthought, because they affect both legal exposure and API reliability:

- **FR-8 (P0): Consent gate immediately before any data leaves the browser.** Right before the API call fires — not earlier in the flow where it's easy to click through — the user must confirm they have the right to share this conversation and understand it's being sent directly to their chosen provider. The "Dissect" action is blocked until this is checked; log it locally as part of the report metadata. Per the design guidelines (§5), this screen should be visually plainer than the rest of the app — standard UI chrome, no case-file theming — so it reads as a real decision rather than part of the fun.
- **FR-9 (P0): Anonymization toggle, default off.** Before running the analysis, the user chooses whether to replace real names with "Participant A/B/C" — both in what's sent to the model and in the rendered report. Real names are shown by default; the user opts in to anonymize. Present it as a clear on/off choice at the same step as the consent gate (FR-8), not a buried setting. Anonymized mode also reduces the chance of the output reading as a defamatory character assessment of a real, named person if the PDF is shared further than intended, and tends to keep provider content-filters calmer.
- **FR-10 (P0): Cover-page disclaimer, not fine print.** The PDF's first page must carry a clear, prominent line: *"This report is AI-generated content, created for fun. It is not a clinical or professional psychological assessment and shouldn't be taken seriously."* Keep it on the cover page itself, not a footer, so it's still visible in a cropped or shared screenshot.
- **Provider ToS risk:** all four providers' usage policies restrict generating profiling/character content about identifiable real people without consent. Expect this system prompt — which explicitly asks for diagnostic-sounding labels like "covert narcissism" applied to a real, named person — to occasionally get refused or softened by providers' safety layers, especially Claude and GPT. Design the orchestrator to handle a refusal response gracefully (surface it as "this provider declined this request" and let the user retry with another provider) rather than treating it as a bug to route around. Multi-provider support is actually your best mitigation here already — lean into it rather than trying to "prompt-engineer past" refusals, which risks the account getting flagged.

## 10. Success Metrics

- Reports generated per week; PDF export completion rate (started analysis → downloaded PDF).
- Provider refusal/error rate by provider (signal for §9 risk above).
- Share/screenshot-driven signup or return-visit rate, if you add any tracking (v2+; none in a backend-less v1 by default).

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Provider refuses/softens output due to content policy | Multi-provider fallback (already in scope); graceful in-UI messaging |
| Long chats exceed context window | Date-range trimming (v1), map-reduce summarization (v2) |
| API key exposure | Client-only, session-scoped by default, no backend to leak from |
| Report shared out of context, harms a named third party | Anonymization mode, persistent non-clinical disclaimer, consent step |
| WhatsApp export format changes (Android/iOS diverge, or Meta changes format) | Isolate parsing in one module with format-version detection and tests against sample exports |
| CORS blocks direct browser→provider calls for one provider | Verify per-provider before build; fallback plan is a minimal serverless proxy per provider if needed |

## 12. Phased Roadmap

- **MVP (v1):** Single-chat upload, 4-provider BYOK settings, non-chunked analysis (with trimming for oversized chats), in-app preview, client-side PDF export, consent gate + anonymization toggle, cover-page disclaimer.
- **v2:** Map-reduce chunking for long chats, local report history, sharable pull-quote image export (not just full PDF).
- **v3:** Theming/branding options for the PDF, structured-output hardening per provider, participant name auto-detection improvements.

## 13. Design & UX Guidelines

Full detail lives in the companion document `the-dissector-design-guidelines.md`. Summary:

- **Governing metaphor: case file, not clinic.** Redacted-document/evidence-tag aesthetic — credible enough to sell the "forensic" bit, but never borrowing the visual authority of an actual mental-health tool. This directly supports the non-clinical positioning in §9.
- **Palette:** charcoal + warm off-white base, one accent color (crimson) doing all the emotional work — no second accent.
- **Typography:** slab-serif/typewriter for headers and data fields, clean sans for the actual analysis body copy, verdict quotes set apart and oversized as the designated shareable unit.
- **One deliberate exception:** the consent + anonymization screen (FR-8/FR-9) intentionally drops the theme and uses plain UI chrome, so it reads as a real decision rather than part of the bit.
- Adds FR-11 (analysis loading state) and FR-12 (shareable verdict card export) above, plus styling direction for the FR-10 cover-page disclaimer (a designed element, not small print) and the FR-4/FR-5 report/PDF template (dossier card hierarchy, superlative badge treatment).

## 14. Open Questions

- Any per-provider CORS blockers that force a lightweight backend proxy sooner than planned?
