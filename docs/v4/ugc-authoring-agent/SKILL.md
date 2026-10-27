---
name: arcadia-content-authoring
description: Build or debug an Arcadia Eternity npm content pack with TypeScript effects and real-engine tests. Use when creating or modifying a content pack, its effects, or its local test and preview workflow.
---

# Arcadia content authoring

Work in the author's content project. Ask for the desired game behavior when its trigger, target or lifetime is ambiguous. Use the SDK and host version actually available to the project; `arcadia.sdkApi` is an API compatibility version, not an engine build identity.

1. Read the project's `package.json`, `content.json`, `src/effects.ts`, tests and build commands. If the host repository is available, consult `docs/v4/npm-content.md`, `docs/v4/effect-authoring.md` and `examples/ugc/slow`. For snapshot behavior consult `docs/v4/v1-snapshots.md`. Do not assume SDK packages have been published merely because a version is in a manifest.
2. Use `createEffects({ sdk, marks, id })` and `sdk.defineCodeEffect` for new behavior; use injected SDK objects and canonical prototypes. Keep `projectId`, namespace, use IDs and binding keys stable unless a breaking identity change is intended. Cross-package data references require npm dependencies.
3. Implement parameters with `numberParam`, `booleanParam` or `stringParam` when battle effects must read or modify them. Use the declared source scope and capture/follow semantics; do not require a parameter editing form. Keep per-battle state in engine instances, parameters and bindings rather than module-global mutable variables. Use the battle RNG instead of `Math.random()` for battle decisions.
4. Build and run the project's own scenario tests against the real engine. For a slow effect cover hit, miss, repeated application, removal and natural expiry; exercise supported waiting-point snapshot restoration if relevant. Preserve meaningful existing assertions and run independent host contract tests when available. The starter's `npm test` covers hit, miss, refresh, removal, natural expiry and restoration at a supported selection waiting point. Fix implementation failures rather than weakening unrelated tests.
5. Pack with `npm pack --ignore-scripts`, inspect the actual artifact and validate it in a separate npm installation. Installing, code admission and selecting a server environment are separate steps. Use the local development approval profile only for an explicitly approved local environment. Never treat a content hash, package install or client acknowledgement as permission to run code.
6. For preview, use a local development server that has prepared and approved the same build. Identify the environment revision in the result and keep active matches on their existing environment. If a preview command or SDK distribution is unavailable, report that limitation instead of inventing a successful preview. The browser consumes server metadata, resources and battle state; it does not execute downloaded effect code.

Report the behavior changed, tests actually run, build/environment identity when available and any unmet validation. Publishing, registry credentials and deployment remain under the author's control; do not publish or deploy as a side effect of testing.
