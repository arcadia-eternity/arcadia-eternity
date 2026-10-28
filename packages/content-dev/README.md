# Content-pack development tool

`@arcadia-eternity/content-dev` owns the reusable author tooling in the main repository. Its `arcadia-content` executable is installed as a development dependency of a content pack; templates contain data, effects, scenario configuration and behavior tests.

```json
{
  "scripts": {
    "check": "arcadia-content check",
    "build": "arcadia-content build",
    "rename": "arcadia-content rename",
    "demo": "npm run build && arcadia-content demo",
    "pack": "arcadia-content pack"
  }
}
```

Commands use the caller's working directory. `check` checks `tsconfig.json` and recursive JSON/YAML sources in `data/{species,skills,marks,behaviors}`. `build` compiles TypeScript and generates `dist/content.json`. `rename --name ... --project-id ... --namespace ...` changes local structured references while preserving foreign references, content IDs and YAML comments. `pack` checks, builds and runs `npm pack --ignore-scripts`.

`demo` loads `arcadia.config.mjs`, whose default export supplies `players({ namespace, manifest })`: two ordinary player input records understood by the battle SDK. It packs the project, installs the artifact in a temporary npm project and runs a deterministic local battle using each player's first skill. It fails on effect errors or if the battle exceeds 40 turns. The configuration and behavioral assertions belong to the content pack.

Tests can import `prepareContentPack`, `attack`, `nextTurn`, `cancelled` and `runBattle` from `@arcadia-eternity/content-dev/testing`. `prepareContentPack(root = process.cwd(), { offline = true, cache })` loads that config and returns the installed `environment`, `manifest`, packed `files`, `createBattle(seed)`, `track(battle)` and async `dispose()`. The harness admits code only in the temporary local-development project. It uses the normal npm cache by default; `cache` selects an explicit cache directory. It defaults to offline artifact installation; packs with runtime dependencies need a populated cache or an explicit `{ offline: false }`.

## Before npm publication

The tool and SDK are not published npm releases. Build and stage them from a trusted checkout:

```sh
pnpm --filter @arcadia-eternity/content-dev... run build
node scripts/stage-author-sdk.mjs /new/author-sdk --dev-tools
cd /path/to/content-pack
node /path/to/main-repo/packages/content-dev/src/setup.mjs --sdk-dir /new/author-sdk
```

The installer checks the seven artifact checksums and API/build identities, installs the tool and SDK together without changing the pack's package metadata or creating a lockfile, and records the installation under `.arcadia/`. The default six-package SDK staging contract remains unchanged unless `--dev-tools` is specified.

The template's initial `setup` entry fetches this repository's `src/setup.mjs` from the exact revision in `arcadia-sdk.json`. This standalone installer uses only Node built-ins. It builds the pinned source with its lockfile, stages the development tool and SDK, and installs them. There is no copied installer in the template. After installation, `npm exec --offline -- arcadia-content setup --sdk-dir ... --offline` supports cached/offline updates. Once these packages are formally released, normal npm installation can replace the initial source bootstrap.
