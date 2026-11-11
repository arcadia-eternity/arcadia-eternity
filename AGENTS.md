# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Overview

Arcadia Eternity is a battle simulation and content-authoring platform for the "Joseph Legend" (Seer 2) game. It supports native battles, multiplayer servers, team editing, and community content packages across web and Electron clients.

## Architecture

The pnpm workspace includes `packages/*` and `packs/*`:

| Location                                  | Responsibility                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/battle/src/engine/`             | Native TypeScript battle engine, effects, phases, snapshots, and execution contracts             |
| `packages/battle/src/host/`               | Battle host integration                                                                          |
| `packs/base/`                             | Official content package: manifest, YAML data, TypeScript effects, resources, and locales        |
| `packages/pack-loader/`                   | Shared content loading and installed-package assembly                                            |
| `packages/content-dev/`                   | Authoring tools, project management, content workspaces, environment preparation, CLI, and MCP   |
| `packages/server/src/runtime/`            | Single-process Express and Socket.IO server, rooms, sessions, environments, and account services |
| `packages/server/src/runtime/management/` | Scoped management access, operations, environment bindings, and server settings                  |
| `packages/database/`                      | Shared Kysely persistence using SQLite (`better-sqlite3`) or PostgreSQL (`pg`)                   |
| `packages/web-ui/src/`                    | Vue 3, Pinia, Element Plus, and Vite frontend, including shared management views                 |
| `packages/web-ui/electron/`               | Trusted desktop bridge, local workspace ownership, and local server lifecycle                    |
| `packages/cli/`                           | Offline battle, replay, content, and project commands                                            |
| `bin/`                                    | CLI entry point and server, storage, administration, and backup commands                         |

`packages/protocol`, `interface`, `schema`, `const`, `client`, `console`, and `p2p-transport` provide supporting contracts, clients, and transports. The battle engine uses native TypeScript authoring; the old rules package, Effect Builder DSL, and Rule Graph are removed. The server runtime does not depend on Redis cluster coordination.

## Development Commands

Run commands from the repository root. Root scripts are defined in `package.json`; frontend scripts are in `packages/web-ui/package.json`.

```bash
# Install the workspace dependencies
pnpm install --frozen-lockfile

# Lint, build non-web packages, check types, and build the CLI
pnpm build

# Build the server and its workspace dependencies
pnpm build:server

# Build the bundled CLI
pnpm build:cli

# Build the paired website distribution
pnpm build:web-distribution

# Watch non-web packages and the CLI
pnpm watch

# Start the server backend
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
# Build fresh test artifacts, check types, then run package test:run scripts
pnpm test

# ESLint scopes and unused code/dependencies
pnpm lint
pnpm knip

# All workspace package types plus root CLI type checking
pnpm test:types

# battle tests and their dedicated type checking
pnpm test:battle
pnpm typecheck:battle

# Server, account, and management tests
pnpm test:server
pnpm typecheck:server

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

Battle, server, storage, CLI, and frontend suites use Vitest; content-development tests use Node's test runner. Browser scenarios use Playwright. Server tests live in `packages/server/test/`, tests in `packages/battle/test/engine/`, and built server CLI lifecycle tests in `bin/__tests__/server-*.test.ts`.

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

- [Server runtime](docs/guides/server-runtime.md): server runtime and account modes.
- [Unified management](docs/guides/unified-management.md): ownership, permissions, environment bindings, CLI operations, and backup/restore semantics.
- [Account providers](docs/guides/account-provider-design.md): durable identity and provider contracts.
- [Content presentation](docs/guides/content-presentation.md): resources, localization, and rich descriptions.

## Development Patterns

- Use the `workspace:` protocol for internal dependencies, following the existing package conventions.
- Use ES modules (`"type": "module"`) and strict TypeScript.
- Preserve the battle engine's discrete phase processing, deterministic inputs, and snapshot/restore semantics.
- Keep installed packages immutable; authoring changes belong to editable projects and prepared environment revisions.
- Keep transport and database details behind the shared resource/service contracts so desktop, server, and remote flows preserve the same behavior.

## UI Microcopy

Do not add explanatory microcopy, helper text, subtitles, descriptions, or instructional paragraphs to UI components unless they communicate non-obvious, actionable information.

Prefer self-explanatory controls and concise labels. Never narrate what a section or component does. Do not restate headings in descriptions. Preserve necessary warnings, validation feedback, and accessibility information.

When in doubt, omit the text.

## 工作区验证：依赖与构建产物

本仓库通过工作区包的 `dist` 产物及类型声明解析部分跨包导入。拉取代码、切换分支或更新依赖后，旧的声明文件可能导致 `TS2305`（缺少导出）、`TS2307`（找不到模块）及连带类型错误，即使源码已有正确导出。

遇到此类错误，先同步依赖并刷新相关包的构建产物，再判断是否需要修改源码。服务器与根目录 CLI 的验证顺序：

```sh
pnpm install --frozen-lockfile
pnpm build:server
pnpm typecheck:workspace
pnpm typecheck:server
```

其他包的类型检查同样需要先构建其工作区依赖。全仓检查使用 `pnpm build:package` 后运行 `pnpm typecheck`；该汇总命令递归执行 `packages/*`、`packs/*` 的 `typecheck`，再检查根 CLI。内容开发工具为 TypeScript 包，类型检查覆盖其实现与生成的 `.d.ts` 声明，运行逻辑由 Node 测试覆盖。`pnpm test` 会先执行 `test:prepare` 构建工作区包和根 CLI，避免离线集成测试使用旧 `dist`；单独执行 `test:run` 时需要先准备产物。以刷新产物后的检查结果为准，不要为过时的本地产物修改源码或放宽类型约束。

提交前若类型检查失败，应先按上述顺序排查；不要直接认定为既有错误并跳过提交钩子。
