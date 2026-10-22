# Native browser construction and preparation

The local battle page and P2P host now share `createNativeWebBattleSystem`. It captures the current species, skill and mark metadata before asynchronous construction, including unsaved metadata edits, and resolves effect IDs through compiled TypeScript. It never reads the store's legacy `effects` collection. `NativePackLoader.fromMetadata` supplies the same trusted build/content identity mechanism as filesystem/HTTP loading; its metadata-only revision includes the captured metadata and actual build identity.

The factory keeps actor identities, creates fresh pet identities for each battle, preserves complete pet metadata (including zero weight and explicit HP), and creates the existing AI by actor ID. It validates the RNG before allocating players and releases allocated Battle resources if host-option validation fails. The P2P store awaits construction before initializing its existing battle interface.

```ts
const system = await createNativeWebBattleSystem(first, second, dataStore, {
  rngSeed: 201,
  ai: { enabled: true, players: ['playerB'] },
  teamSelection: { enabled: true, config: { maxTeamSize: 3 } },
})
```

## Team preparation

The host's optional third constructor argument owns team preparation. Combat still starts on the existing Battle/Phase implementation. Preparation validates both choices before changing either roster, retains selected instances and skill IDs, and starts combat once both players confirm. FULL_TEAM, TEAM_SELECTION and VIEW_ONLY use the existing protocol. Invalid actors, members, sizes and starters fail without applying a roster. AI defaults respect the configured cap. Preview data respects the registered viewer and opponent-visibility option.

Preparation uses the existing decision timers with its own turn limit, preserving the total budget and resetting the normal turn limit when combat starts. Submitted players pause independently. Timeout chooses valid defaults once; surrender, total-time expiry and cleanup cancel preparation without battle-start effects. Active preparation snapshots are explicitly unsupported. A settled checkpoint after preparation restores the selected roster without opening preparation again.

## Message and input adaptation

The native core counter identifies the next message; the existing browser protocol's state counter identifies the last covered message. The host translates state views and their sequence deltas, keeping the core and snapshot representation unchanged. A real delta consumer verifies the first event after a checkpoint is applied once and that each patched public counter equals the covered message ID. Messages and state views are copied before publication.

Team-selection inputs copy their pet-ID array explicitly. Vue can supply a reactive collection even after the outer action is unwrapped; passing that collection to structuredClone rejected a real UI confirmation. A proxy-backed input regression reproduces this failure and verifies later caller mutations cannot change the accepted roster. Parameter lookup also stops at the Battle root instead of reporting Battle.battle as a false parent cycle; root modifiers retain their numeric behavior.

The animation health monitor starts after resource preparation. Cold native startup legitimately has no actions while portraits load; starting the monitor earlier falsely declared the preparation stuck at nine seconds and prevented the queued start state from being applied. The ten-second portrait-delay browser case fails before the change and passes afterward. The animation state machine itself is unchanged.

## Validation checkpoint

- Seven native core/content/host/timer/snapshot/parameter suites: **114 passed**. V4 types, scoped lint, declarations, provenance and historical source audit pass.
- Shared browser factory and existing P2P protocol suites: **20 passed**. The new native case drives an actual host, peer, transport and delta consumer through both actions and the next turn, comparing HP/rage and owned state. The peer continues to use the existing battle-store delta-consumer contract.
- Metadata loader: **11 passed**, including asynchronous capture, edited content revision and unchanged filesystem/HTTP identity. Its test types pass.
- The actual Node/Chrome HTTP probe completes timed/animated and untimed seven-turn games plus AI continuation, fresh-directory initial/selection restoration and reconnect deadlines: **1065 effects, 516 modules, zero effect-DSL requests**.
- The 59 native server factory/service regressions pass after the public message adaptation.
- All **8 real Chrome page cases pass**, covering the five existing local battle regressions, actual native runtime checkpoints, team confirmation and ten-second portrait loading. These use local background/portrait fixtures to avoid external CDN failures; gameplay, state, AI and snapshots use the actual native implementation. Earlier runs separately exposed ambiguous button/log selectors, remote scene failures and the cold-start monitor defect; those failed runs are not counted as acceptance.
- Browser factory/P2P test types and scoped lint pass. The production web build passes. The full web typecheck has exactly the same 13 source diagnostics as a complete independent archive of pre-change `8fe22447`; none are in changed production files. Baseline setup initially omitted the shared P2P source directory; that incomplete run is not the comparison result.

Temporary logs and browser artifacts are under `/tmp/effect-native-oct23/`; the full web baseline is `/tmp/effect-native-oct23-web-type-baseline/`. Root commands `test:web-native`, `typecheck:web-native`, `lint:web-native` and `test:web-native:e2e` provide the repeatable factory/transport/page gate, also wired into the battle workflow. The local page run used system Chrome because the bundled Playwright browser was not installed; CI explicitly installs Chromium. The workflow changes are locally validated commands, not a claimed remote CI result.

The complete private-room browser suite could not pass its lobby prerequisite: guest creation returned 500 because Supabase was not initialized, followed by AUTHENTICATION_ERROR before a battle existed. That run was stopped after establishing the prerequisite failure. It does not establish room creation, transport reconnect or page-reload acceptance. The native in-memory transport regression and actual local-page checks are separate evidence. No authentication bypass, push or deployment was introduced.
