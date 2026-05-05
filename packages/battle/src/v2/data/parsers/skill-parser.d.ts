import type { BaseSkillData } from '../../schemas/skill.schema.js';
/**
 * Convert a raw YAML skill object to a v2 BaseSkillData.
 * - `effect` (string[]) → `effectIds`
 * - Fills defaults for optional fields.
 */
export declare function parseSkill(raw: Record<string, unknown>): BaseSkillData;
//# sourceMappingURL=skill-parser.d.ts.map