# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arcadia Eternity is a battle simulation system for the "Joseph Legend" (Seer 2) game, featuring online multiplayer battles, team editing, and game data editing capabilities.

## Architecture

**Monorepo Structure**: Uses pnpm workspaces with multiple packages:
- `@arcadia-eternity/battle` - Core battle system with phase-based mechanics
- `@arcadia-eternity/server` - Backend server with cluster support
- `@arcadia-eternity/web-ui` - Vue 3 frontend application
- `@arcadia-eternity/rules` - Battle rule validation system
- `@arcadia-eternity/schema` - Data schema definitions
- `@arcadia-eternity/effectBuilder` - Effect DSL and builder system
- `@arcadia-eternity/database` - Database access layer

**Key Technologies**:
- Frontend: Vue 3 + TypeScript + Element Plus + Vite
- Backend: Node.js + Express + Socket.IO + Redis
- Database: Supabase (PostgreSQL)
- Build: Rollup + TypeScript
- Testing: Japa (unit) + Vitest (integration)

## Development Commands

### Build Commands
```bash
# Build all packages
pnpm run build

# Build specific package
pnpm --filter @arcadia-eternity/battle run build

# Watch mode for development
pnpm run watch

# Build CLI tool
pnpm run build:cli
```

### Testing Commands
```bash
# Run all tests (types, units, integration)
pnpm run test

# Run type checking only
pnpm run test:types

# Run unit tests only
pnpm run test:units

# Run server integration tests
pnpm --filter @arcadia-eternity/server run test

# Run specific test file
pnpm --filter @arcadia-eternity/server run test -- test/file.test.ts
```

### Development Servers
```bash
# Start backend server
pnpm run cli server --port 8102

# Start frontend development server
pnpm run web:dev

# Start storybook
pnpm run storybook
```

### CLI Tools
```bash
# Run test battle between two teams
pnpm run cli -1 testteam.yaml -2 testteam.yaml

# Validate data files
pnpm run cli validate data/species.yaml

# Generate schema files
pnpm run generate
```

## Key File Locations

- **Data Definitions**: `data/` directory (YAML files for species, skills, effects)
- **Battle System**: `packages/battle/src/` with phase-based architecture
- **Server**: `packages/server/src/` with cluster support and Redis integration
- **Frontend**: `packages/web-ui/src/` Vue 3 components and stores
- **Rules System**: `packages/rules/src/` for battle rule validation

## Data Structure

The game uses YAML files for data definitions:
- `species.yaml` - Pet species definitions
- `skill.yaml` - Skill definitions
- `effect_skill.yaml` - Skill effect definitions
- `mark.yaml` - Mark (status effect) definitions

## Testing Approach

- **Unit Tests**: Japa framework with test files in `__tests__/` directories
- **Integration Tests**: Vitest for server and complex scenarios
- **Type Checking**: Strict TypeScript configuration with `test:types` script

## Deployment

- Docker-based deployment with `Dockerfile` and `docker-compose.yml`
- Fly.io deployment configuration in `fly.toml`
- Cluster architecture with Redis for distributed state management

## Development Patterns

- **Workspace Dependencies**: Use `workspace:*` for internal package references
- **ES Modules**: All code uses ES modules (`type": "module"`)
- **Strict TypeScript**: Enabled strict mode with comprehensive type checking
- **Phase-based Architecture**: Battle system uses discrete phases for turn processing
- **Rule System**: Extensible rule validation for competitive play