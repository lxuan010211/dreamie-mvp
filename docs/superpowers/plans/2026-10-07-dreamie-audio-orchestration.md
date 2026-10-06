# Dreamie Audio Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Dreamie choose voice-only, background-only, or mixed story/meditation playback from the user's actual intent, with natural low-frequency recommendations.

**Architecture:** Extend the validated sleep plan with an explicit audio mode and optional safe catalog track. Keep intent and recommendation decisions on the server, keep MiniMax credentials server-side, and use a browser playback controller to coordinate TTS and background layers. Session-level recommendation cooldown prevents repeated suggestions.

**Tech Stack:** TypeScript, Node.js HTTP server, Zod, MiniMax TTS, existing sleep-audio catalog, browser `Audio`/Web Audio API, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-dreamie-audio-orchestration-design.md`

## Global Constraints

- Ordinary chat defaults to `voice`; it must not attach a background recommendation.
- Background tracks must come from the existing safe audio catalog, never a model-generated file path.
- A declined recommendation enters cooldown for the current session.
- TTS and background failures must not discard the text reply.
- Existing MiniMax, DashScope, DeepSeek, anonymous-user, and memory behavior must remain compatible.

## Review Focus

- Explicit background request: selects a safe track and does not generate unrelated content.
- Story/meditation plus ambience: returns both script audio and track metadata for mixing.
- Ordinary emotional chat: returns TTS only with no background recommendation.
- Recommendation rejection: no repeated recommendation in the same session.
- Browser autoplay or Web Audio failure: text remains visible and a manual play state is available.

### Task 1: Extend the sleep-plan audio contract

**Files:**
- Modify: `dreamie-mvp/src/dreamie.ts`
- Modify: `dreamie-mvp/src/web-session.ts`
- Test: `dreamie-mvp/test/dreamie.test.ts`
- Test: `dreamie-mvp/test/web-session.test.ts`

**Interfaces:**
- Produces `audioMode: 'voice' | 'background' | 'voice_with_background'`, optional `backgroundTrackId`, optional `recommendation`, and `autoplay` on the parsed sleep plan and web response.

- [ ] Write failing parser tests for all three audio modes and the ordinary-chat default.
- [ ] Run `cd dreamie-mvp && node_modules/.bin/tsx --test test/dreamie.test.ts test/web-session.test.ts` and verify the new assertions fail.
- [ ] Extend the Zod schema, prompt contract, and web response typing with the exact fields above; default missing model fields to `voice`, no track, and `autoplay: true`.
- [ ] Run the focused tests and verify they pass.
- [ ] Run the existing Dreamie and web-session tests and commit `feat: add audio mode to sleep plans`.

### Task 2: Add intent-aware recommendation and session cooldown

**Files:**
- Modify: `dreamie-mvp/src/background-audio-session.ts`
- Modify: `dreamie-mvp/src/web-session.ts`
- Test: `dreamie-mvp/test/background-audio-session.test.ts`
- Test: `dreamie-mvp/test/web-session.test.ts`

**Interfaces:**
- Consumes Task 1's audio mode and optional track ID.
- Produces at most one soft recommendation per session and records explicit accept/reject outcomes through the existing memory event path.

- [ ] Write failing tests for ordinary chat without recommendation, a high-signal soft recommendation, explicit background selection, and rejection cooldown.
- [ ] Run the focused tests and verify the new behavior fails.
- [ ] Implement deterministic rules: explicit user media requests override; otherwise only high-signal fatigue/overthinking plus a matching preference can create a recommendation; rejection sets session cooldown.
- [ ] Run focused and full backend tests and verify all pass.
- [ ] Commit `feat: make background recommendations contextual`.

### Task 3: Return audio layers without breaking text responses

**Files:**
- Modify: `dreamie-mvp/src/web-server.ts`
- Modify: `dreamie-mvp/src/minimax-tts.ts`
- Test: `dreamie-mvp/test/minimax-tts.test.ts`
- Test: `dreamie-mvp/test/web-server.test.ts`

**Interfaces:**
- Web chat response returns `tts.dataUrl` for voice modes and optional `background.url`, `background.trackId`, and `background.autoplay` for background modes.

- [ ] Write failing route/serialization tests for voice-only and mixed responses, including TTS failure preserving the text reply.
- [ ] Run the focused tests and verify they fail.
- [ ] Reuse the existing MiniMax synthesis helper and safe catalog lookup; keep provider errors as non-fatal `ttsError`/`audioError` response fields.
- [ ] Run all backend tests and TypeScript checking.
- [ ] Commit `feat: expose audio layers in web chat responses`.

### Task 4: Coordinate voice, background, and mixed playback in the browser

**Files:**
- Create: `audio-player.js`
- Modify: `app.js`
- Modify: `index.html`
- Test: `tests/audio-player.test.js`
- Test: `tests/app.test.js`

**Interfaces:**
- `createAudioPlaybackController({ AudioCtor, AudioContextCtor })` exposes `loadVoice`, `loadBackground`, `play`, `stop`, and `getState`.
- `getAudioControlMode` continues to expose `send`, `play`, and `stop` button states.

- [ ] Write failing tests for voice-only playback, mixed-layer stop, autoplay rejection, and button state transitions.
- [ ] Run the focused frontend tests and verify they fail.
- [ ] Implement a single controller that stops previous layers, lowers background gain, and returns to idle when the voice layer ends.
- [ ] Connect API `tts` and optional background metadata to the controller; keep text rendering independent of audio errors.
- [ ] Run all frontend tests and syntax checks.
- [ ] Commit `feat: mix Dreamie voice and background audio`.

### Task 5: End-to-end local verification and deployment handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-10-07-dreamie-audio-orchestration.md` (checklist only)

- [ ] Run the full frontend and backend test commands plus TypeScript checking.
- [ ] Start the local preview on port 3001 with the existing local environment and verify ordinary chat, explicit background request, and story-plus-background request manually.
- [ ] Push the completed commits to `main`.
- [ ] Report the CloudBase redeploy action without deploying until the user confirms local behavior.
