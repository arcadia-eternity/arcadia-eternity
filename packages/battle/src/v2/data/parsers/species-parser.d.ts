import type { SpeciesData } from '../../schemas/species.schema.js';
/**
 * Convert a raw YAML species object to a v2 SpeciesData.
 * - `ability` (string[]) → `abilityIds`
 * - `emblem` (string[]) → `emblemIds`
 * - Discards `learnable_skills` (not needed at battle runtime).
 */
export declare function parseSpecies(raw: Record<string, unknown>): SpeciesData;
//# sourceMappingURL=species-parser.d.ts.map