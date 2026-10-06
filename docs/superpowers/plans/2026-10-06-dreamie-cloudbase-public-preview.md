# Dreamie CloudBase Public Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Dreamie to a fixed public CloudBase test URL while keeping anonymous-browser memory isolated and durable in PostgreSQL.

**Architecture:** A browser-created UUID scopes every web session and memory query. `MemoryStore` stays the business interface; SQLite remains its local implementation while a PostgreSQL implementation is selected through environment configuration. A Docker image packages the existing root-page assets and `dreamie-mvp` service, then CloudBase supplies HTTPS, port, secrets, and a default public domain.

**Tech Stack:** TypeScript, Node.js, `pg`, PostgreSQL, CloudBase Run, Docker, existing Node test runner, existing browser JavaScript tests.

**Spec:** `docs/superpowers/specs/2026-10-06-dreamie-cloudbase-public-preview-design.md`

## Global Constraints

- Preserve the existing visual page, long-press recording behavior, TTS, background audio catalogue, and Chinese user-facing copy unless a change is needed for user isolation or an error.
- Keep local development on SQLite by default; only `MEMORY_STORE=postgres` enables PostgreSQL.
- Treat `DATABASE_URL`, all model API keys, certificates, `.env.local`, local SQLite files, and recorded audio data as secrets; never commit, print, or bake them into an image.
- Use UUID validation for every browser-provided `userId` and session ID; do not fall back to the shared `local-user` identity for public requests.
- The CloudBase default domain is intentionally public for this MVP; do not add login, password, or account features in this plan.
- Run TypeScript tests with `/Users/liuxuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs --test test/**/*.test.ts`; run frontend tests from the workspace root with the same Node runtime and `node --test tests/app.test.js`.

## Review Focus

- A malformed or missing anonymous UUID must fail safely, rather than accidentally reading or writing a shared profile.
- A session ID copied from another browser must not be attached to that browser's in-memory session or database records.
- PostgreSQL connection errors must produce a safe Chinese response and never cause fallback to local disk or a shared null user.
- The CloudBase image must include the root web assets and registered audio files but exclude `.env.local`, private local HTTPS files, SQLite databases, and cache directories.
- A CloudBase-supplied `PORT` must override local port 3000 while local preview behavior remains unchanged when `PORT` is absent.

---

### Task 1: Add selectable PostgreSQL memory storage

**Files:**
- Modify: `dreamie-mvp/package.json`
- Modify: `dreamie-mvp/src/config.ts`
- Modify: `dreamie-mvp/src/memory-store.ts`
- Create: `dreamie-mvp/src/postgres-memory-store.ts`
- Create: `dreamie-mvp/src/memory-store-factory.ts`
- Modify: `dreamie-mvp/test/config.test.ts`
- Modify: `dreamie-mvp/test/memory-store.test.ts`
- Create: `dreamie-mvp/test/postgres-memory-store.test.ts`
- Create: `dreamie-mvp/test/memory-store-factory.test.ts`
- Modify: `dreamie-mvp/.env.example`

**Interfaces:**
- Consumes: `MemoryStore` and memory item types from `src/memory-store.ts`.
- Produces: `loadMemoryStoreConfig(environment) -> { kind: 'sqlite'; databasePath: string } | { kind: 'postgres'; databaseUrl: string }`, `createMemoryStoreFactory(config) -> { forUser(userId: string): MemoryStore; close(): Promise<void> }`, and `createPostgresMemoryStore(client, userId) -> Promise<MemoryStore>`.

- [ ] **Step 1: Write failing configuration tests**

In `test/config.test.ts`, assert that absent `MEMORY_STORE` resolves to SQLite, `MEMORY_STORE=postgres` plus `DATABASE_URL` returns a PostgreSQL configuration, and postgres mode without `DATABASE_URL` throws an error naming only `DATABASE_URL`.

- [ ] **Step 2: Run the configuration test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs --test test/config.test.ts`

Expected: FAIL because `loadMemoryStoreConfig` is not exported.

- [ ] **Step 3: Implement `loadMemoryStoreConfig` in `src/config.ts`**

Add a Zod-discriminated configuration parser. Never include the URL value in the error message. Update `.env.example` with blank `DATABASE_URL` and `MEMORY_STORE=sqlite` comments only.

- [ ] **Step 4: Run the configuration test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs --test test/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing store-contract tests**

In `test/postgres-memory-store.test.ts`, use an injected fake parameterized-query client to assert that initialization uses `CREATE TABLE IF NOT EXISTS`, every user-scoped query sends the supplied UUID as a parameter, event writes include that UUID, and no query string interpolates user input. In `test/memory-store-factory.test.ts`, assert SQLite remains local by default and factory-created stores are independently scoped for two user IDs.

- [ ] **Step 6: Run the store-contract tests to verify they fail**

Run: `node node_modules/tsx/dist/cli.mjs --test test/postgres-memory-store.test.ts test/memory-store-factory.test.ts`

Expected: FAIL because the PostgreSQL store and factory do not exist.

- [ ] **Step 7: Implement user-scoped stores**

Add runtime dependency `pg` and its TypeScript types. Refactor `openMemoryStore(databasePath, userId = 'local-user')` so its existing local callers preserve current behavior while public callers bind a store to a UUID. Implement `PostgresMemoryStore` with the same operations and table semantics as SQLite, parameterized SQL, idempotent initialization, and `pg.Pool` ownership in the factory. `clearAll` must delete only the bound user's data.

- [ ] **Step 8: Run memory-store tests to verify the implementation**

Run: `node node_modules/tsx/dist/cli.mjs --test test/memory-store.test.ts test/postgres-memory-store.test.ts test/memory-store-factory.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the storage layer**

```bash
git add dreamie-mvp/package.json dreamie-mvp/pnpm-lock.yaml dreamie-mvp/src/config.ts dreamie-mvp/src/memory-store.ts dreamie-mvp/src/postgres-memory-store.ts dreamie-mvp/src/memory-store-factory.ts dreamie-mvp/test/config.test.ts dreamie-mvp/test/memory-store.test.ts dreamie-mvp/test/postgres-memory-store.test.ts dreamie-mvp/test/memory-store-factory.test.ts dreamie-mvp/.env.example
git commit -m "feat: add PostgreSQL memory storage"
```

### Task 2: Scope browser sessions and memory to anonymous UUIDs

**Files:**
- Modify: `app.js`
- Modify: `tests/app.test.js`
- Modify: `dreamie-mvp/src/web-session.ts`
- Modify: `dreamie-mvp/src/web-server.ts`
- Modify: `dreamie-mvp/test/web-session.test.ts`
- Modify: `dreamie-mvp/test/web-server.test.ts`

**Interfaces:**
- Consumes: `MemoryStoreFactory.forUser(userId)` from Task 1 and the existing `/api/chat` API.
- Produces: `getOrCreateAnonymousUserId(storage, createUuid) -> string`; `/api/chat` accepts `{ userId, sessionId?, message }`; `WebSessionService.handleMessage({ userId, sessionId?, message })`.

- [ ] **Step 1: Write failing anonymous-ID frontend tests**

In `tests/app.test.js`, test that `getOrCreateAnonymousUserId` stores one generated UUID, returns it on subsequent calls, and does not overwrite an existing value. Add a send-request test that asserts the JSON body carries both the persisted `userId` and current `sessionId`.

- [ ] **Step 2: Run frontend tests to verify they fail**

Run: `node --test tests/app.test.js`

Expected: FAIL because no anonymous-ID helper or request field exists.

- [ ] **Step 3: Implement anonymous browser identity in `app.js`**

Create and export `getOrCreateAnonymousUserId`. Use `crypto.randomUUID()` only when `dreamie-user-id` is absent; retain the existing `dreamie-session-id` behavior. Include `userId` in every chat request. Do not send it to transcription because audio is not persisted.

- [ ] **Step 4: Run frontend tests to verify they pass**

Run: `node --test tests/app.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing backend isolation tests**

In `test/web-session.test.ts`, create two UUID users from the same store factory. Assert each receives its own session and records only its own events. Assert a request reusing user A's session ID under user B creates or returns no session for B rather than sharing A's dialogue. In `test/web-server.test.ts`, test that missing or non-UUID `userId` produces HTTP 400 and the public chat path passes a valid UUID through.

- [ ] **Step 6: Run backend isolation tests to verify they fail**

Run: `node node_modules/tsx/dist/cli.mjs --test test/web-session.test.ts test/web-server.test.ts`

Expected: FAIL because web sessions have no user ownership.

- [ ] **Step 7: Implement server-side UUID validation and per-user session ownership**

Change `createWebSessionService` to use a `forUser` memory-store factory. Key active sessions by a composite of user ID and session ID, store `userId` in each session, and reject invalid UUID input before calling a store or model. In `web-server.ts`, parse `userId` from `/api/chat`, map invalid input to a Chinese 400 JSON error, and wire the configured store factory into the service. Preserve the existing `/api/audio` and `/api/transcribe` contracts.

- [ ] **Step 8: Run the focused frontend and server tests**

Run: `node --test tests/app.test.js && node node_modules/tsx/dist/cli.mjs --test test/web-session.test.ts test/web-server.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit anonymous isolation**

```bash
git add app.js tests/app.test.js dreamie-mvp/src/web-session.ts dreamie-mvp/src/web-server.ts dreamie-mvp/test/web-session.test.ts dreamie-mvp/test/web-server.test.ts
git commit -m "feat: isolate anonymous Dreamie memories"
```

### Task 3: Make the web service cloud-port and container ready

**Files:**
- Modify: `dreamie-mvp/src/web-server.ts`
- Modify: `dreamie-mvp/test/web-server.test.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `dreamie-mvp/package.json`
- Create: `dreamie-mvp/docs/cloudbase-preview.md`

**Interfaces:**
- Consumes: CloudBase-provided `PORT`, CloudBase environment variables from the spec, and the service start module.
- Produces: a Docker image that starts `src/web-server.ts` on `process.env.PORT ?? 3000`, serves `/`, and keeps all existing API routes available.

- [ ] **Step 1: Write failing cloud-port tests**

In `test/web-server.test.ts`, extract and test `getListenPort(environment)` so it returns `3000` when `PORT` is absent, returns a valid numeric CloudBase value such as `8080`, and rejects invalid/out-of-range values without exposing environment contents.

- [ ] **Step 2: Run the web-server test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs --test test/web-server.test.ts`

Expected: FAIL because `getListenPort` is not exported.

- [ ] **Step 3: Implement `getListenPort` and use it only for the HTTP listener**

Keep local HTTP on 3000 by default. Start the optional local HTTPS listener only in local-preview mode; CloudBase must use its own HTTPS termination and one `PORT` listener. Preserve the exported local preview URL helpers for the existing local workflow.

- [ ] **Step 4: Run the web-server test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs --test test/web-server.test.ts`

Expected: PASS.

- [ ] **Step 5: Add a minimal Docker build definition**

Create root `Dockerfile` using a supported Node image, copy root web assets and `dreamie-mvp`, install locked dependencies, expose `8080`, and run the existing TypeScript web service through its locally installed runner. Create root `.dockerignore` excluding `**/.env.local`, `**/.local-https`, `**/data`, `**/generated-audio`, `.git`, `.pnpm-store`, and `node_modules`, while retaining `assets/mascots` and `dreamie-mvp/assets/audio/background`.

- [ ] **Step 6: Write CloudBase deployment instructions**

In `dreamie-mvp/docs/cloudbase-preview.md`, document selecting environment `dreamie-d1gakfvvs849daf19`, deploying the repository root with the Dockerfile, setting the exact environment-variable names from the spec through the CloudBase console, obtaining database `DATABASE_URL` directly in the console, enabling public access, and opening the generated default domain. Explicitly state that secrets must be pasted in CloudBase, never the terminal transcript or Git.

- [ ] **Step 7: Verify the image definition without secrets**

Run: `docker build -t dreamie-cloudbase-preview .`

Expected: successful image build with no `.env.local`, `dreamie.db`, or `.local-https` content in `docker image save` file list. If Docker is unavailable, run `git check-ignore` for every excluded path and record that the final CloudBase console deployment is the image-build verification.

- [ ] **Step 8: Commit cloud packaging**

```bash
git add Dockerfile .dockerignore dreamie-mvp/src/web-server.ts dreamie-mvp/test/web-server.test.ts dreamie-mvp/package.json dreamie-mvp/docs/cloudbase-preview.md
git commit -m "feat: package Dreamie for CloudBase preview"
```

### Task 4: Verify locally and deploy the public preview

**Files:**
- Modify: `dreamie-mvp/docs/cloudbase-preview.md` only if the CloudBase console uses a different required field name or deployment path.

**Interfaces:**
- Consumes: image from Task 3, CloudBase environment `dreamie-d1gakfvvs849daf19`, and secrets entered only by the user in CloudBase.
- Produces: one CloudBase default public HTTPS test URL and an evidence-backed deployment record in the console.

- [ ] **Step 1: Run all automated verification before cloud deployment**

Run:

```bash
cd dreamie-mvp
node node_modules/tsx/dist/cli.mjs --test test/**/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
cd ..
node --test tests/app.test.js
node --check app.js
```

Expected: all tests pass, TypeScript emits no diagnostics, and frontend syntax validation passes.

- [ ] **Step 2: Enter production configuration in CloudBase without exposing secrets**

In the CloudBase console, choose the user-created environment, create a Cloud Run service from the Dockerfile, enable public network access, and set `MEMORY_STORE=postgres` plus the required model and database variables. The user pastes all key values and database URL directly into the console.

- [ ] **Step 3: Deploy and capture the default domain**

Wait for the CloudBase service revision to become healthy, copy only its default HTTPS domain, and open it from a phone on cellular or a different Wi-Fi network. Do not publish secrets, logs containing request payloads, or the database URL.

- [ ] **Step 4: Execute public acceptance checks**

From browser A, send a text message, accept an audio recommendation, and refresh; verify the next request still uses the same anonymous ID and stored preference. From browser B/private mode, send a message and verify it starts without browser A's preference. Hold the composer to record a short voice message and verify it returns text or a user-safe ASR error. Verify the page loads over HTTPS and an unknown audio ID returns 404.

- [ ] **Step 5: Record verification and commit documentation correction if needed**

If instructions changed based on the actual console flow, update only `dreamie-mvp/docs/cloudbase-preview.md`, then:

```bash
git add dreamie-mvp/docs/cloudbase-preview.md
git commit -m "docs: record CloudBase preview deployment"
```

Otherwise, report the public URL and acceptance-test result without committing a no-op change.

## Plan Self-Review

- Spec coverage: Task 1 implements selectable durable PostgreSQL storage; Task 2 implements anonymous isolation; Task 3 packages the precise assets and environment behavior; Task 4 enters user-owned secrets and validates the public CloudBase result.
- Interfaces: Task 1 provides the factory consumed by Task 2; Task 2 preserves the API routes packaged by Task 3; Task 4 uses only those outputs.
- High-risk inputs: all five items in Review Focus are assigned to Tasks 1–3 tests or Task 4 manual acceptance checks.
- Scope: database and identity changes are necessary for public anonymous memory; no authentication, domain purchase, production controls, or unrelated UI work is added.
