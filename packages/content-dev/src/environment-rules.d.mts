import type { EnvironmentRules } from './content-workspace.mjs'

export function validateEnvironmentRules(rules?: unknown): EnvironmentRules
export function assertEnvironmentRequirements(requires?: unknown): void
export function assertEnvironmentTeam(rules: unknown, team: unknown): void
