# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arcadia Eternity is a battle simulation and content-authoring platform for the "Joseph Legend" (Seer 2) game. It supports native V4 battles, multiplayer servers, team editing, and community content packages across web and Electron clients.

## Architecture

The pnpm workspace includes `packages/*` and `packs/*`:

| Location                                     | Responsibility                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/battle/src/v4/`                    | Native TypeScript battle engine, effects, phases, snapshots, and execution contracts             |
| `packages/battle/src/v4-host/`               | Battle host integration                                                                          |
| `packs/base/`                                | Official content package: manifest, YAML data, TypeScript effects, resources, and locales        |
| `packages/pack-loader/`                      | Shared content loading and installed-package assembly                                            |
| `packages/content-dev/`                      | Authoring tools, project management, content workspaces, environment preparation, CLI, and MCP   |
| `packages/server/src/standalone/`            | Single-process Express and Socket.IO server, rooms, sessions, environments, and account services |
| `packages/server/src/standalone/management/` | Scoped management access, operations, environment bindings, and server settings                  |
| `packages/database/`                         | Shared Kysely persistence using SQLite (`better-sqlite3`) or PostgreSQL (`pg`)                   |
| `packages/web-ui/src/`                       | Vue 3, Pinia, Element Plus, and Vite frontend, including shared management views                 |
| `packages/web-ui/electron/`                  | Trusted desktop bridge, local workspace ownership, and local server lifecycle                    |
| `packages/cli/`                              | Offline battle, replay, content, and project commands                                            |
| `bin/`                                       | CLI entry point and standalone server, storage, administration, and backup commands              |

`packages/protocol`, `interface`, `schema`, `const`, `client`, `console`, and `p2p-transport` provide supporting contracts, clients, and transports. V4 uses native TypeScript authoring; the old rules package, Effect Builder DSL, and Rule Graph are removed. The standalone runtime does not depend on Redis cluster coordination.

## Development Commands

Run commands from the repository root. Root scripts are defined in `package.json`; frontend scripts are in `packages/web-ui/package.json`.

```bash
# Install the workspace dependencies
pnpm install --frozen-lockfile

# Lint, build non-web packages, check root types, and build the CLI
pnpm build

# Build the server and its workspace dependencies
pnpm build:server

# Build the bundled CLI
pnpm build:cli

# Build the paired website distribution
pnpm build:web-distribution

# Watch non-web packages and the CLI
pnpm watch

# Start the standalone backend
pnpm cli server --port 8102 --data-dir .arcadia-server

# Start the frontend development server
pnpm web:dev

# Start the Electron development client
pnpm --filter @arcadia-eternity/web-ui dev:desktop

# Discover current CLI and server options
pnpm cli --help
pnpm cli server --help
```

`pnpm build` does not build the web application. Use `pnpm build:prod` for the production server/CLI and paired website build. Package builds use Rolldown or package-specific builders; the frontend uses Vite.

## Testing

```bash
# Root type checking plus package test:run scripts
pnpm test

# Root type checking only
pnpm test:types

# V4 battle tests and their dedicated type checking
pnpm test:battle-v4
pnpm typecheck:battle-v4

# Standalone server, account, and management tests
pnpm test:server-standalone
pnpm typecheck:server-standalone

# Shared SQLite/PostgreSQL storage contract tests
pnpm --filter @arcadia-eternity/database test:run

# Content workspace and authoring tests
pnpm test:content-dev

# Build and test the offline CLI
pnpm test:cli

# Frontend tests and type checking
pnpm --filter @arcadia-eternity/web-ui test:run
pnpm --filter @arcadia-eternity/web-ui type-check

# Browser battle/account scenarios
pnpm test:web-native:e2e
```

Battle, server, storage, CLI, and frontend suites use Vitest; content-development tests use Node's test runner. Browser scenarios use Playwright. Standalone tests live in `packages/server/test/`, V4 tests in `packages/battle/test/v4/`, and built server CLI lifecycle tests in `bin/__tests__/server-*.test.ts`.

The PostgreSQL storage cases require `TEST_DATABASE_URL` pointing to a disposable test database; cases are skipped when it is absent. SQLite coverage alone does not establish PostgreSQL compatibility. `.github/workflows/battle-baseline.yml` provides the PostgreSQL service and runs both storage and management coverage. Desktop native-driver and packaging validation has a separate workflow; configured jobs are not evidence of successful installed-app validation.

## Persistence and Management Boundaries

- Content packages, environment documents, lockfiles, and immutable prepared artifacts belong to the content workspace. The database stores server settings, environment bindings, accounts, permissions, operations, and audit records; it does not duplicate the authoritative environment documents.
- Each workspace has one write owner. When a desktop client starts its own server, the server shares the client's workspace and prepared content through the private host bridge. It must not create an independent writable copy of the same environment.
- Local and remote management reuse the same resource model and views. Local desktop access uses the trusted bridge; remote and web access use authenticated server APIs with resource-scoped permissions. A player login does not grant administration, and a remote window must not acquire local desktop privileges.
- SQLite and PostgreSQL implement the same storage contracts and account rules. Keep dialect-specific behavior in `packages/database`; Supabase can host an ordinary PostgreSQL database but is not an SDK, Auth, or Data API dependency.
- Persist the server data directory and stable server identity across restarts. Database migrations are explicit; `server db status` is read-only and `server db migrate` initializes or upgrades storage. Existing runtime rooms, seats, and battle sessions remain ephemeral.
- Account providers verify identity; the shared SQL account directory owns durable account identity and bindings. Do not implicitly merge accounts by matching email addresses.
- Acquiring content, preparing an environment, publishing a server binding, and executing third-party code are separate actions. Official services do not execute third-party-maintained code. Community execution requires explicit host policy, and content preparation must not run package lifecycle scripts or evaluate author modules.

## Deployment and Detailed References

`Dockerfile`, `docker-compose.yml`, and `fly.toml` describe deployment entry points. Use `.env.example` for current configuration, including the storage driver, persistent data directory, content sources, account providers, and trusted reverse proxies.

- [Server runtime](docs/v4/server-runtime.md): standalone runtime and account modes.
- [Unified management](docs/v4/unified-management.md): ownership, permissions, environment bindings, CLI operations, and backup/restore semantics.
- [Account providers](docs/v4/account-provider-design.md): durable identity and provider contracts.
- [Content presentation](docs/v4/content-presentation.md): resources, localization, and rich descriptions.

## Development Patterns

- Use the `workspace:` protocol for internal dependencies, following the existing package conventions.
- Use ES modules (`"type": "module"`) and strict TypeScript.
- Preserve the battle engine's discrete phase processing, deterministic inputs, and snapshot/restore semantics.
- Keep installed packages immutable; authoring changes belong to editable projects and prepared environment revisions.
- Keep transport and database details behind the shared resource/service contracts so desktop, standalone, and remote flows preserve the same behavior.
