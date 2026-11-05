# Unified server-management integration review

Date: 2026-11-05

Scope: ongoing implementation for the unified server/workspace management work, with emphasis on durable transactions, publication semantics, authorization, workspace ownership, and desktop/CLI integration. The worktree is actively changing; this is not a completion approval.

## Result

- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE** (for the re-reviewed persistence and P2P lifecycle fixes; final integrated verification remains pending)
- `reportPath`: `.omo/evidence/unified-server-management-code-review.md`

## Findings

### CRITICAL

None found in this pass.

### HIGH

None found in the refreshed pass.

#### Open finding: normal private P2P completion is treated as an unexpected server closure

`RoomRegistry.finish()` sends the generic socket `roomClosed` for a non-matchmaking room after its five-second cleanup window ([`rooms.ts`](../../packages/server/src/standalone/rooms.ts:524)). P2P battle events travel through `privateRoomPeerSignal`, not the client's ordinary `battleEvent` listener, so [`BattleClient`](../../packages/client/src/client.ts:1197) has no recent `BATTLE_END` timestamp when that socket event arrives and calls `markBattleEnded()`. The battle page watches that state and immediately leaves the battle route ([`battlePage.vue`](../../packages/web-ui/src/pages/battlePage.vue:2283)).

The recorded two-browser trace contains peer events 0 through 18, including `BATTLE_END`, followed by `roomClosed` for both clients five seconds later, and records repeated `INVALID_STATE` selection-signal failures. The latter follows because the host reports `finishPrivateRoomBattle()` as soon as it sees the terminal event ([`privateRoom.ts`](../../packages/web-ui/src/stores/privateRoom.ts:1115)), while the P2P relay sends its event/selection work fire-and-forget ([`p2pBattleSystem.ts`](../../packages/web-ui/src/p2p/p2pBattleSystem.ts:95)) and the server rejects all peer signals once the room becomes `ended` ([`rooms.ts`](../../packages/server/src/standalone/rooms.ts:1187)).

Do not solve this by lengthening the timeout. The fix must retain the result/animation lifecycle for normal private P2P completion, allow only round-bound terminal delivery during the short cleanup grace, and suppress terminal selection/recovery traffic. It must _not_ blindly remove `roomClosed` from matchmaking/server completion: the private-room event handler intentionally does not route `MATCH_FINISHED`, so the generic terminal state is currently what makes that battle page exit ([`privateRoom.ts`](../../packages/web-ui/src/stores/privateRoom.ts:1580)). This is an active implementation blocker until the scoped behavior and regression coverage land.

**Remediation verdict (current source): fixed.** The cleanup path now withholds generic `roomClosed` only for normal P2P private completion while preserving it for server mode and matchmaking ([`rooms.ts`](../../packages/server/src/standalone/rooms.ts:545)). Peer signals after a result require the exact captured battle room ID, accept only the bounded P2P relay message set, and are rejected once cleanup deletes that ID ([`rooms.ts`](../../packages/server/src/standalone/rooms.ts:1193)). The new real-socket regression test covers matching-round ACK delivery, missing/stale IDs, rejected offer/action traffic, actual cleanup with preserved room/result and no raw close, and stale rematch frames ([`standalonePersonalEnvironment.test.ts`](../../packages/server/test/standalonePersonalEnvironment.test.ts:137)). I inspected the test and implementation; the reported 18/18 execution belongs to the owning/root test run, not this reviewer's independent execution.

#### Open finding: peer message callbacks can reorder behind asynchronous ACKs

The peer transport invokes `handleMessage()` without serializing its returned promise ([`p2pBattleSystem.ts`](../../packages/web-ui/src/p2p/p2pBattleSystem.ts:328)); for every event, `handleMessage()` awaits the server ACK before invoking battle callbacks ([`p2pBattleSystem.ts`](../../packages/web-ui/src/p2p/p2pBattleSystem.ts:607)). Thus ordered transport receipt does not ensure ordered callback delivery under varying ACK latency. The UI animation pipeline depends on event order, especially for the terminal event queued after a skill batch. The fix should serialize peer event dispatch by sequence (or invoke callbacks before non-critical ACK I/O while retaining reliable ACK delivery), and include a latency-controlled ordering test.

**Remediation verdict (current source): fixed.** Peer callbacks are now delivered synchronously before best-effort asynchronous ACK transmission ([`p2pBattleSystem.ts`](../../packages/web-ui/src/p2p/p2pBattleSystem.ts:709)); terminal delivery clears recovery/selections and makes outstanding animation work locally completable. Targeted unit coverage deliberately stalls an ACK and verifies receive-order callback delivery, terminal delivery despite an ACK rejection, and no post-terminal recovery/selection traffic ([`p2pBattleSystem.test.ts`](../../packages/web-ui/src/p2p/__tests__/p2pBattleSystem.test.ts:828)).

#### Remediated finding: committed-but-unpublished import

The prior HIGH finding is fixed in the current source. `ContentWorkspace.importVersion()` now writes an immutable per-operation import receipt before the database cancellation boundary ([`content-workspace.mjs`](../../packages/content-dev/src/content-workspace.mjs:745)), and `recoverImport()` deterministically finishes a rename/draft write from that receipt ([`content-workspace.mjs`](../../packages/content-dev/src/content-workspace.mjs:628)). `ManagementTransfers` automatically retries recovery on startup/cleanup and explicitly routes a failed or interrupted committed import through that recovery ([`transfers.ts`](../../packages/server/src/standalone/management/transfers.ts:414)). `OperationService.recoverCommitted()` only changes a terminal committed operation after the domain owner supplies the recovered result ([`operations.ts`](../../packages/server/src/standalone/management/operations.ts:270)).

I checked the important crash points: before rename, after rename/before draft write, after draft write/before receipt completion, and after receipt completion/before task finalization. In each state the receipt supplies the fixed version ID/document/revision needed to finish idempotently; unfinished receipts also prevent staging cleanup. No new correctness defect was found in this recovery chain.

### MEDIUM

1. **No standalone transport proof was obtained in this sandbox.**

   The authenticated HTTP integration suite still cannot bind loopback here, so this pass could not independently execute the Origin/CSRF/TLS and download-stream transport paths. This is a verification limitation, not a source finding; retain a real-host transport run as an integration gate.

### LOW

None found in this pass.

## Verification evidence

- Passed: `node --test packages/content-dev/test/content-workspace.test.mjs packages/content-dev/test/environment-document.test.mjs packages/content-dev/test/managed-projects.test.mjs` — 26/26.
- Passed: `./node_modules/.bin/vitest run packages/database/test/storage.test.ts packages/server/test/standaloneManagementAuth.test.ts packages/server/test/standaloneManagementOperations.test.ts --maxWorkers=1` — 40 passed, 14 expected environment-gated skips.
- A subsequent `./node_modules/.bin/tsgo --noEmit` was temporarily blocked by stale generated package declarations while the source application option was being integrated. Do not treat that transient result as a source finding; a fresh server graph rebuild is required for final typecheck evidence.
- Refreshed source review: import receipt/recovery, online backup capture/stamp protocol, and unpublished personal-environment admission. The online backup flow captures workspace bytes under the sole owner, snapshots the database without holding a file/IPC lock, and validates the single-use workspace observation stamp afterward ([`server-backup.ts`](../../bin/server-backup.ts:292)). Personal environments are shape-bounded references, restricted to peer/private rooms, and never provide author modules or installation instructions to the server ([`personal-environments.ts`](../../packages/server/src/standalone/personal-environments.ts:25)). No concrete defect found in these paths.
- Passed: `git diff --check` at the time of inspection.
- Attempted: `vitest run packages/server/test/standaloneManagement.test.ts packages/server/test/standaloneManagementOperations.test.ts --maxWorkers=1`. The operation suite passed; HTTP integration could not bind `127.0.0.1` in this sandbox, and two fixture preparations were blocked by pre-existing root-owned files in `/Users/yuuinih/.npm`. These are verification-environment limits, not evidence that the integration scenario passed.

PostgreSQL behavior was not independently executed in this review pass; database-agent evidence is not treated as replacement for the above integration checks.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not available in the supplied skill catalog or local skill roots, so they could not be loaded. I applied their supplied review criteria directly: tests were checked for deletion-only, tautological, prompt-mirroring, and implementation-constant assertions; production code was checked for unnecessary parsing/normalization, untyped escape hatches, and needless abstraction. No separate slop violation was found. The missing publication-failure and follow-ready coverage remains a material test-relevance gap as recorded above.

## Required blockers before approval

- Re-run the full generated-type and real-host transport gates after the active integration settles.

## Final broad integration pass

Performed a further read-only audit of the current management backend/auth/accounts, credential issuance/list/revocation, durable operations/transfers/backups, UI management target generation handling, desktop IPC boundary, online snapshot capture, resource ownership, and unpublished personal peer challenges.

- Cross-scope control is anchored to the owned server/workspace pair before grant/credential routes reach the authorization layer; service credentials are public-ID listed but their token/storage digest is not exposed.
- Cookie writes enforce Origin+CSRF, bearer writes are restricted to service credentials, and transfer/backup retrieval reauthorizes the caller before opening the artifact.
- Management UI calls capture a target generation and gate late responses; the IPC client strips renderer-provided authentication headers.
- Online backup reads the workspace under its owner, takes the database snapshot without holding that owner lock, and consumes a one-use file-observation stamp after the DB capture. The retry protocol correctly rejects a changing workspace rather than mixing snapshots.
- Personal challenge references are fixed-size peer-only metadata. Server admission rejects code/resources and server or matchmaking execution; browser-owned blobs are only readable while explicitly registered and are revoked on release.

No concrete permission elevation, cross-target state write, credential export, post-await target race, backup/restore mismatch, or unintended server execution of personal/author content was found in the paths inspected. This was an evidence-backed source audit, not an assertion that every changed file or platform-deployment scenario was exhaustively reviewed.

## Final pre-commit release/CI pass

Performed a bounded read-only review of the lockfile/package coherence, changed battle baseline, new desktop runtime workflow, Docker exclusions, and untracked evidence inventory.

- Both workflow YAML files parse and every desktop workflow script name resolves from the current package manifests. The platform matrix labels—including `macos-15-intel`—are valid GitHub-hosted runner labels.
- The desktop job explicitly sets `shell: bash`; GitHub's documented explicit Bash invocation includes `-o pipefail`, so its `tee` pipelines retain command failures.
- `git diff --check` passed. No untracked test results, build output, archives, database files, keys, or token-shaped files were detected.
- `.omo/evidence` is deliberately not Git-ignored but is Docker-excluded. It contains compact review/verification records; the scan found no private-key or token patterns. One requirements artifact includes the local disposable PostgreSQL test URI/credentials. It is safe only if these evidence files are intentionally versioned; otherwise ignore `.omo/` before staging.

No release or CI blocker was found in this bounded pass. I did not independently execute dependency installation or the cross-platform CI matrix.
