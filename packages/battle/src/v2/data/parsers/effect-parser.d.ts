import type { EffectDef } from '@arcadia-eternity/engine';
import { type EffectCompileTypingEnvironment } from './effect-compile-validator.js';
type EffectCompileTypingValidator = (raw: Record<string, unknown>) => void;
type TriggerAssertion = (trigger: string, path: string) => void;
export type EffectParserEnvironment = {
    compileTypingEnvironment?: EffectCompileTypingEnvironment;
    validateCompileTyping?: EffectCompileTypingValidator;
    assertTriggerRegistered?: TriggerAssertion;
};
/**
 * Convert a raw YAML effect object to an engine EffectDef.
 * - `trigger` (string | string[]) → `triggers` (string[])
 * - `apply` and `condition` are passed through as opaque DSL JSON.
 */
export declare function createEffectParser(environment?: EffectParserEnvironment): (raw: Record<string, unknown>) => EffectDef;
export declare function parseEffect(raw: Record<string, unknown>): EffectDef;
export {};
//# sourceMappingURL=effect-parser.d.ts.map