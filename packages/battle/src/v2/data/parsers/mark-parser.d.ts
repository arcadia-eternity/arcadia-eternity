import type { BaseMarkData } from '../../schemas/mark.schema.js';
/**
 * Convert a raw YAML mark object to a v2 BaseMarkData.
 * - `effect` (string[]) → `effectIds`
 * - `config` gets defaults filled via TypeBox Value.Default
 */
export declare function parseMark(raw: Record<string, unknown>): BaseMarkData;
//# sourceMappingURL=mark-parser.d.ts.map