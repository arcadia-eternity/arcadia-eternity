# Native local CLI entry

The `local` command now uses `NativePackLoader` and `LocalBattleSystemV4` through `bin/native-local-battle.ts`. It loads the workspace's species/skill/mark metadata against compiled effects and the actual trusted build identity. Reference and lock validation happen on this native path, including `--strict` / `--validate-data`; it no longer creates a V2 effect repository before starting local play.

Player files remain YAML/JSON team drafts. A new session owns fresh URL-safe actor/pet IDs even when both arguments name the same file, while complete pet metadata and explicit HP survive. The helper captures inputs/configuration before asynchronous loading and creates the existing built-in AI by the selected `player1` / `player2` slots. The CLI's duplicate first-available-action AI loop is removed. The existing turn-limit surrender guard remains. The console renderer continues through its existing battle interface.

Four checks pass: native authority/identities/metadata, actual AI plus human commands through a full native turn, invalid seed/content cleanup, and the actual spawned CLI command with the same draft supplied twice, two AIs, strict/reference validation and a successful game end. Unit cases release all owned attribute systems. The existing console renderer still exits its process on BattleEnd; the command's process-level case checks that existing behavior rather than claiming a renderer lifecycle redesign.

Root TypeScript checking and scoped CLI lint pass. The root CLI bundle builds successfully. Repeat with `pnpm test:cli-native`, `pnpm typecheck`, `pnpm exec eslint bin/cli.ts bin/native-local-battle.ts` and `pnpm build:cli`. These source and execution checks are included in the native server/CLI workflow. Local evidence: `/tmp/effect-native-oct23/native-cli-{tests-final,types-final,lint-final,build-final}.log`. No push or deployment was performed.

The complete core/host regression is separately fixed to `fb610cb5`: 150 files and 27,463 tests pass. This CLI change does not alter that core or host build. Final per-effect acceptance reconciliation and real private-room recovery remain separate migration obligations.
