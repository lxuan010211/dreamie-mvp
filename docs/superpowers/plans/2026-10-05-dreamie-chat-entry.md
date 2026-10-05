# Dreamie Chat Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-ready, mobile-first Dreamie Agent conversation entry page centered on the supplied lamb character and a dark sofa scene.

**Architecture:** A dependency-free static page will use semantic HTML for the app shell, CSS for the vertically layered mobile scene, and a small vanilla-JavaScript module for local chat state and DOM interaction. A pure state API keeps input, quick prompts, and sent messages testable through Node’s native test runner; the browser adapter renders that state into the page.

**Tech Stack:** HTML5, CSS custom properties, vanilla JavaScript (ES modules), Node.js native test runner, Python static-file server for local preview.

**Spec:** `docs/superpowers/specs/2026-10-05-dreamie-chat-entry-design.md`

## Global Constraints

- Prioritize a 375–430px-wide phone viewport; center the phone canvas in wider browser windows.
- Use `assets/mascots/dreamie-lamb-lavender-pillow-awake-v11.png` as the primary character asset.
- Render a dark navy/blue-black sofa behind the lamb with lavender moonlight highlights.
- Keep the page dependency-free; do not introduce a build system or external UI library.
- Do not implement a remote Agent API, durable chat history, real microphone/file upload, settings panel, or navigation.
- Quick prompts fill the composer and never auto-send; Enter sends and Shift+Enter inserts a newline.
- Meet keyboard, focus, text-label, and reduced-motion accessibility requirements.

## Review Focus

- Whitespace-only composer values keep Send disabled and never create an empty message.
- Long multilingual text wraps in the composer and message bubble without horizontal overflow.
- Shift+Enter retains a newline while Enter sends exactly the entered message.
- Narrow 375px viewport keeps the composer and send action visible without horizontal scrolling.
- `prefers-reduced-motion: reduce` suppresses decorative float and shimmer animation.

## File Structure

- `index.html` — semantic page structure, icon button labels, quick prompts, message region, and module entrypoint.
- `styles.css` — mobile-first color system, sofa scene, responsive layout, interaction states, and motion preference rules.
- `app.js` — exported pure `createChatState` state API and `mountChat` DOM binding for composer and quick prompts.
- `tests/app.test.js` — Node tests for the state API governing draft text, prompt fill, send behavior, and multi-line behavior.
- `package.json` — minimal `npm test` script invoking `node --test`; no runtime dependencies.

### Task 1: Create the testable local conversation state

**Files:**
- Create: `package.json`
- Create: `app.js`
- Create: `tests/app.test.js`

**Interfaces:**
- Produces: `createChatState()` from `app.js`, returning `{ getSnapshot, setDraft, choosePrompt, send }`.
- `getSnapshot()` returns `{ draft: string, messages: Array<{ role: 'user', text: string }>, status: string }`.
- `setDraft(value: string)` stores the supplied draft; `choosePrompt(prompt: string)` stores the prompt as the draft; `send()` returns `true` after appending a trimmed non-empty user message and clearing the draft, otherwise returns `false`.

- [ ] **Step 1: Write the failing state tests**

```js
import { createChatState } from '../app.js';

test('keeps send disabled for whitespace-only drafts', () => {
  const chat = createChatState();
  chat.setDraft('   ');
  assert.equal(chat.send(), false);
  assert.deepEqual(chat.getSnapshot().messages, []);
});

test('fills but does not send a quick prompt', () => {
  const chat = createChatState();
  chat.choosePrompt('陪我聊聊今天的心情');
  assert.equal(chat.getSnapshot().draft, '陪我聊聊今天的心情');
  assert.equal(chat.getSnapshot().messages.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app.test.js`

Expected: FAIL because `app.js` and `createChatState` do not exist.

- [ ] **Step 3: Implement `createChatState()` in `app.js`**

Implement the exact interface above. Preserve inner newlines in valid messages, trim only leading and trailing whitespace for the stored sent text, and set a short acknowledgement status after a successful send.

- [ ] **Step 4: Add tests for sending and multiline drafts**

```js
test('sends a trimmed multiline draft and clears the composer', () => {
  const chat = createChatState();
  chat.setDraft('  想慢一点聊\n今晚的心情  ');
  assert.equal(chat.send(), true);
  assert.deepEqual(chat.getSnapshot().messages, [
    { role: 'user', text: '想慢一点聊\n今晚的心情' },
  ]);
  assert.equal(chat.getSnapshot().draft, '');
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/app.test.js`

Expected: PASS with all state tests green.

- [ ] **Step 6: Commit the testable state feature**

```bash
git add package.json app.js tests/app.test.js
git commit -m "feat: add local Dreamie chat state"
```

### Task 2: Build the accessible phone-first conversation scene

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Modify: `app.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `createChatState()` from Task 1.
- Produces: `mountChat(root: HTMLElement): void` from `app.js`; it binds `[data-composer]`, `[data-send]`, `[data-prompt]`, `[data-messages]`, and `[data-status]` elements in `index.html`.

- [ ] **Step 1: Write the failing DOM-contract test**

```js
test('exports a mount function for the browser conversation shell', async () => {
  const { mountChat } = await import('../app.js');
  assert.equal(typeof mountChat, 'function');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/app.test.js`

Expected: FAIL because `mountChat` is not yet exported.

- [ ] **Step 3: Create the semantic page shell in `index.html`**

Use a `main` application landmark; labeled top-bar buttons; an image with meaningful alt text; a live status region; three buttons marked `data-prompt`; a messages list marked `data-messages`; and a labeled `textarea` marked `data-composer`. Reference `styles.css` and `app.js` as a module.

- [ ] **Step 4: Add the mobile-first visual system in `styles.css`**

Create a 375–430px phone canvas with deep indigo-to-lavender gradient, star/moon ambience, the lamb image, and a CSS-drawn dark sofa with lavender edge highlights. Style the bottom glass composer, visible focus rings, disabled/enabled send states, wrapped long text, desktop centering, and a `prefers-reduced-motion` media query that removes decorative animation.

- [ ] **Step 5: Implement `mountChat(root)` in `app.js`**

Bind input events to draft state and button disabled state. Bind prompt click to `choosePrompt`, send click to `send`, and composer keydown so unmodified Enter sends while Shift+Enter preserves the browser newline. On successful send, render the new user bubble, reset the textarea, and update the live status text.

- [ ] **Step 6: Run the full automated test suite**

Run: `npm test`

Expected: PASS with state and DOM-contract tests green.

- [ ] **Step 7: Commit the visual page feature**

```bash
git add index.html styles.css app.js tests/app.test.js
git commit -m "feat: build Dreamie conversation entry page"
```

### Task 3: Verify the browser experience

**Files:**
- Modify: `index.html`, `styles.css`, or `app.js` only if verification exposes a defect.

**Interfaces:**
- Consumes: `mountChat(document)` and the static page files from Tasks 1–2.
- Produces: a browser-verified page served from the project root.

- [ ] **Step 1: Start a local static server**

Run: `python3 -m http.server 4173`

Expected: server responds with `index.html` from the project root.

- [ ] **Step 2: Verify the 375px visual layout in a browser**

Open `http://localhost:4173` at 375px viewport width. Confirm the lamb is visibly seated in front of the dark sofa, the composer is visible, no horizontal scrollbar exists, and text remains legible over the background.

- [ ] **Step 3: Verify conversation controls in a browser**

Confirm an empty/whitespace composer cannot send; clicking a quick prompt fills it without sending; Enter sends one bubble and updates the status; Shift+Enter keeps a newline; and a long Chinese message wraps in the composer and bubble.

- [ ] **Step 4: Verify reduced motion and keyboard usability**

Enable reduced motion emulation and confirm decorative animation stops. Tab through the top controls, prompt buttons, composer, and send button; confirm visible focus and meaningful accessible labels.

- [ ] **Step 5: Run final automated verification**

Run: `npm test`

Expected: PASS with all tests green.

- [ ] **Step 6: Commit any verification fixes**

```bash
git add index.html styles.css app.js tests/app.test.js
git commit -m "fix: polish Dreamie chat entry verification"
```
