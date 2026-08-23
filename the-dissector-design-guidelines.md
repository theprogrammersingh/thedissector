# Design Philosophy & UI/UX Guidelines — "The Dissector"

**Companion to:** the-dissector-prd.md
**Status:** Draft v0.1

---

## 1. Design Philosophy

The product has to do two contradictory jobs at once:

1. Feel credible enough that the "forensic psychology" bit lands — sloppy or jokey UI undercuts the report itself.
2. Stay obviously, comfortably a joke — so nobody mistakes a superlative badge or an archetype label for an actual diagnosis of someone they know.

Almost every design decision below exists to hold that tension. When in doubt, resolve toward the second point — a product that's a little too convincing about diagnosing your friends is the actual failure mode here, not a design nitpick.

**Governing metaphor: case file, not clinic.** A redacted-document, evidence-tag aesthetic reads as playful-serious in a way a clean medical/wellness look doesn't. It fits a product whose entire hook is "we found things you weren't supposed to see," without borrowing the visual authority of an actual mental-health tool.

## 2. Brand Personality

- Confident, dry, a little theatrical — think case notes read aloud by someone enjoying themselves, not a clinical intake form.
- Never smug or mean-spirited in the chrome itself. The system prompt's content can be sharp; the surrounding UI should stay composed, almost deadpan, so the harshness reads as the AI's voice, not the product mocking the user.
- Confidential/classified framing ("evidence," "case file," "persons of interest") is a wink, used lightly — one or two touches per screen, not layered on every label. Overdoing it turns credible-but-fun into try-hard.

## 3. Visual Language

### Color
- Base palette: near-black charcoal + warm off-white/cream (report-paper tone). Quiet, mostly monochrome.
- One accent color carries all the emotional weight — crimson/red is the natural fit (verdict badges, redaction bars, superlative ribbons, the consent screen's one warning cue). Resist adding a second accent color; a single loud color against a quiet base is what makes a cropped verdict card read as one cohesive image when screenshotted.
- Exception: the consent/anonymization screen (see §4) intentionally underuses the case-file palette — see below.

### Typography
- Headers, section labels, and data fields (timestamps, participant IDs, stamps) use a slab-serif or typewriter-adjacent face — this is where the "case file" feel actually lives.
- Body copy — the actual psychological analysis paragraphs — uses a clean, highly readable sans. People are reading real paragraphs about themselves and their friends; the novelty font stays out of the way there.
- Verdict quotes get their own oversized treatment, set apart from body copy — visually the one line designed to be lifted out and shared on its own.

### Iconography & Motion
- Icons: minimal, outline-style, used sparingly (lock for security-related copy, a stamp/redaction mark motif for status, nothing more elaborate).
- Motion is a personality opportunity during the analysis wait (see §4) but must always be skippable and respect `prefers-reduced-motion` — never trap the user in an animation to sit through a joke.

## 4. Voice & Tone (product copy, not the AI's report copy)

- System/UI copy stays plain and honest even where the theme is playful — especially on privacy, consent, and disclaimer copy. The bit is for the report; the settings and consent screens are not the place for it.
- Error and status messages: say what happened, plainly, no persona. "This provider declined the request — try a different one," not an in-character "The file has been sealed."
- Never let branded copy ("case file," "evidence") appear inside privacy, consent, or API-key messaging — those need to read as unambiguously real.

## 5. Screen-by-Screen Guidelines

**Upload**
- One focal action, minimal chrome. A light "submit evidence" label is fine; don't build out the theme further here — frictionless upload matters more than atmosphere on this screen.

**Participant preview** (post-parse, pre-analysis)
- Chat parsed into a short "persons of interest" list: name, message count, before anything is sent anywhere. Gives the user a last, calm look at who's about to be profiled before they commit.

**Consent + anonymization step**
- Deliberately plainer and calmer than the rest of the app — this is the one screen where the case-file styling should back off. Standard UI chrome, no redaction motifs, no theatrical copy. This needs to register as a real decision, not part of the fun, or people will click through it on reflex. Anonymization toggle and consent confirmation live together here (see PRD FR-8/FR-9).

**Provider / API key settings**
- Reads as a security settings page, not a game screen: masked key field, explicit "stored only on this device, never sent to our servers" copy, a lock icon doing honest work rather than decoration.

**Analysis / loading state**
- This is the best opportunity for personality, and it's functionally necessary since generation can take a while on longer chats. A redaction-bar sweep revealing text, or a rotating status line ("cross-referencing message 340 of 812…", "building profile on [participant]…") gives the wait a reason to exist rather than reading as a stalled request.
- Must be skippable/interruptible and respect reduced-motion (see §3).

**Report view**
- Dossier-style cards per participant. Archetype is the headline; verdict quote is pulled out large and visually separated from the body analysis so it reads as the shareable unit even before export.
- Group Dynamic Audit and Superlatives sections use the same card language, kept visually distinct from individual dossiers (e.g., a different accent treatment) so the eye can tell "about the group" from "about a person" at a glance.

**Export**
- Full PDF export, plus a dedicated crop/export of just the verdict card sized for social sharing. That single-card export is more likely to drive people to try the product than the full PDF ever will — treat it as a first-class action, not a hidden extra.

## 6. Report / PDF Template

- Cover page: masthead, participant/chat name, generation date, and the required disclaimer (PRD FR-10) — treat the disclaimer as a designed element on the page, not small print, so it can't be cropped out accidentally and still reads as intentional if it's cropped in.
- Consistent typographic hierarchy across all individual dossiers so a reader can compare people at a glance: archetype title → verdict quote → behavioral summary → strengths/flaws.
- Superlative badges/ribbons use the single accent color consistently — this is the set most likely to get individually screenshotted, so they need to look complete cropped on their own, without surrounding page context.

## 7. Accessibility

- Respect `prefers-reduced-motion` everywhere motion is used for personality (loading state, redaction reveals).
- Maintain real contrast on the crimson-on-cream/charcoal pairing — verdict badges and disclaimer text need to pass standard contrast checks, not just look dramatic.
- Don't rely on the redaction/case-file visual metaphor alone to convey meaning (e.g., "this section is AI-generated") — pair it with plain text, not just a stamp graphic.

## 8. Quick Do / Don't

| Do | Don't |
|---|---|
| Keep the case-file theme confident but light-handed | Layer classified/evidence framing onto every single label |
| Make the consent + anonymization screen visually plain | Theme the consent screen — it needs to read as a real choice |
| Treat the cover-page disclaimer as a designed element | Bury the disclaimer in small-print footer styling |
| Design verdict quotes and superlatives to stand alone when cropped | Assume the full-page layout is the only way the content gets seen |
| Keep loading-state animation skippable and reduced-motion safe | Trap users in an animation to "sell" the wait |
