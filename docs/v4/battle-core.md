# Seir2 Battle Core vertical slice (#202–#204)

This package is a host-independent TypeScript foundation for Seer 2 battles. It intentionally lives beside the existing V2 engine while migration proceeds. It has no runtime dependencies and its package output uses only ECMAScript APIs, so Node and browser bundles import the same implementation.

## Public API

`@arcadia-eternity/battle-core` exports `createBattle`, `Battle`, `restoreBattle`, and `replayBattle`. A `Battle` instance provides `getState()`, `submitAction()`, `subscribe()`, `snapshot()`, and `createReplay()`. `BattleContent` contains plain species and skill records. The host owns files, UI, persistence, network and user identity.

The minimum vertical slice includes two players with Seir2 pets and skills, explicit selection / turn-resolution / forced-switch / ended phases, ordered turn actions, accuracy from an injected seed state, switch/rage handling, damage, fainting, turn rage and victory. Switching follows the V1 floor semantics (`floor(rage * 0.8)`), and skill targets are resolved at execution after a switch. Pet state reserves an explicit serializable `Mark` model for stable IDs, owner, stacks and duration; #205 must define effect execution and lifecycle before official mark behavior can move into this core.

## Persistence and replay

Snapshots contain a version, content records, battle state, RNG state, pending actions, event stream and action log. They contain only serializable data and stable content IDs; functions, DOM nodes, timers and host handles are not stored. Call `restoreBattle(snapshot)` with the saved snapshot to continue. The content records in the snapshot are an immutable data copy, not executable effects.

`createReplay()` records the initial state, submitted actions, and expected ordered events. `replayBattle(record)` re-executes the actions and rejects a different event sequence. A committed JSON replay at `packages/battle-core/src/fixtures/replay.json` is exercised directly by the package tests.

## Current boundary and follow-on work

This is an executable architecture slice, not an implementation of all official battle rules. Damage uses the package's explicitly basic power/attack/defense model; official formula coverage, mark lifecycle and effects, status phases, full V1 golden parity, and CLI wiring remain follow-on work. TS effect callbacks and EffectTemplate schemas are deliberately absent; #205/#223 can add stable IDs and validated parameters without serializing executable code or embedding a generic game engine here.

The package can be built with its `build` script and has no imports from Node, DOM, Electron, Socket.IO, Redis or Supabase. PR CI imports it from Node and produces an ESM browser bundle; a Chromium browser smoke import was also run during this change.
