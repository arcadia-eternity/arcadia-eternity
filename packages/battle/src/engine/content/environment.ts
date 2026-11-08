/** Supplied by the trusted host build, never selected by a received content pack. */
export interface EnvironmentBuildIdentity {
  readonly formatVersion: 1
  readonly coreBuildId: string
  readonly registryBuildId: string
}
