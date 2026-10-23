# Native CLI (#207)

The offline CLI uses the existing V4 native host and trusted content implementation. It needs Node 24, content files and the built CLI; no account, browser, database or running server is involved.

```sh
pnpm --filter '@arcadia-eternity/cli^...' run build
pnpm build:cli
node dist/cli.js content validate --strict --json
node dist/cli.js battle simulate --player1 testteam.yaml --player2 testteam2.yaml --seed example --runs 10 --json
node dist/cli.js battle simulate --player1 testteam.yaml --player2 testteam2.yaml --seed example --team-selection --replay-out example.replay.json --out example.result.json --json
node dist/cli.js battle replay example.replay.json --verify --json
node dist/cli.js battle local --player1 testteam.yaml --player2 testteam2.yaml --ai player2 --seed example
```

`local` and `validate` delegate to the corresponding new commands. Strict validation is always enabled; the old `--load-scripts` switch is rejected. `--pack-ref` selects a local manifest, `builtin:base`, `builtin:workspace` (default), or an installed `npm:` reference. Relative command paths use the caller's working directory; relative manifest paths use the manifest directory. Built-in discovery starts at the installed loader/CLI location; `ARCADIA_PACKS_DIR` can select an explicit pack directory. Each workspace entry and dependency retains its original lock validation; duplicate pack identities or duplicate definitions fail explicitly.

For offline relocation, copy `dist/` and the selected `packs/` metadata (manifest, lock, data, locales and asset manifests) together. The command tests run that layout in a temporary directory without `node_modules`, source files or network access. The bundled offline commands contain no service runtime dependencies. Existing `online`, `server` and P2P commands remain lazy legacy entries and require their existing service dependencies; the single-process server migration remains #210.

## Results and limits

`--format json` / `--json` writes one machine-readable document to stdout; diagnostics go to stderr. `--out` writes the same JSON to a new file. Output files must not exist and are published without overwriting inputs or symlinks. JSON formats carry version 1, content/build identity, the root seed, effective per-run seeds, statuses and counts. Runtime IDs and timing are excluded from comparable results; seats and roster slots are zero-based.

`--runs` must be a positive safe integer. Runs execute sequentially, preparing content once and allocating independent players, configuration, host, RNGs, controllers and subscriptions each time. A single run uses the supplied seed; a batch derives `${root}/run/${index}`. `legal-skills-v1` selects among legal skills, otherwise legal non-surrender inputs. Each seat has its own `${runSeed}/ai/${seat}` RNG, separate from the battle RNG. `--team-selection` enables deterministic preselection with no wall-clock timer.

`--max-turns` (default 300) counts completed turns and `--max-actions` (default 10000) counts accepted inputs. Hitting either limit produces `truncated` with a null winner. Native execution-budget faults produce `failed`. Cancellation produces `cancelled`; an interrupted batch writes its collected results, including the cancelled run, before returning. Cleanup is awaited for all outcomes. There is no promise-timeout claim of preempting an infinite trusted JavaScript loop.

| Exit | Meaning                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| 0    | Completed batch, valid content or verified replay; losing a battle is successful execution |
| 1    | Runtime failure or a batch containing truncation/failure                                   |
| 2    | Invalid arguments, content, team references or output conflicts                            |
| 3    | Invalid replay, mismatched environment, input, checkpoint or result                        |
| 130  | SIGINT/SIGTERM cancellation                                                                |

## Minimal replay

`--replay-out` is available for a single simulation. It saves the resolved teams, effective settings and seed, frozen pure content metadata and ordered package identities, trusted build identity, current native v3 initial checkpoint, accepted inputs and normalized expected result. Team selection, ordinary skills and forced/reward switches all cross the same host boundary. Inputs address seats, original roster slots and skill slots rather than random IDs.

Replay checks its protocol/build/content identity, binds the checkpoint to the effective initial setup, restores the current native checkpoint and submits recorded inputs without rerunning AI. Illegal, missing, extra or wrong-boundary inputs fail; result mismatches identify the first differing field. Original team or content files are not reread. Changing the installed trusted code fails identity validation. Completed and deterministically truncated runs can be verified; failed/cancelled runs retain diagnostic records but are not verifiable replays.

This format uses initial checkpoints produced by this CLI. It adds no old snapshot compatibility, arbitrary phase breakpoints, execution trace, phase lifecycle feed or user-script execution.

## Maintenance and checks

`bin/cli.ts` is the compatibility launcher. `packages/cli/src/commands` owns parsing and presentation, `application` owns preparation/run/replay orchestration, `io` owns files, and `reporting` owns errors. Application functions do not import Commander, print or exit the process. Console UI owns terminal adaptation, closes pending input on cleanup and reports input errors to its caller.

```sh
pnpm typecheck:cli
pnpm test:cli
pnpm test:cli-native
pnpm --filter @arcadia-eternity/pack-loader test:run
```

The `offline-cli` CI job builds the dependency graph and actual CLI before running command and lifecycle checks. Broader ContentStore/overrides/sharing features remain #214/#217.
