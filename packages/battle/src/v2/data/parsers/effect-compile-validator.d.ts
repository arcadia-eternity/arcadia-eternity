import { type EffectDslFieldTypingRule, type ExtractorValueType } from '@arcadia-eternity/schema';
import type { TSchema } from '@sinclair/typebox';
export type CompileOwner = string;
export type CompileScalarType = 'number' | 'string' | 'boolean' | 'unknown';
export type CompileObjectClass = `path:${string}:${string}` | 'dsl:operator' | 'dsl:condition' | 'dsl:evaluator' | 'dsl:selector' | 'dsl:effectDef' | 'json:array' | 'json:stringArray' | 'json:record';
export type CompileValueState = {
    kind: 'scalar';
    valueType: CompileScalarType;
} | {
    kind: 'object';
    objectClass: CompileObjectClass;
    owner?: CompileOwner;
    path?: string;
};
export type CompileState = {
    kind: 'owner';
    owner: CompileOwner;
} | {
    kind: 'id';
    target: CompileOwner;
} | CompileValueState | {
    kind: 'propertyRef';
};
type CompileNodeTypingRule = {
    selectorFields?: Record<string, EffectDslFieldTypingRule>;
    valueFields?: Record<string, EffectDslFieldTypingRule>;
};
export type EffectCompileExtractorRegistry = {
    attributes: Array<{
        key: string;
        owners: readonly string[];
        valueType: ExtractorValueType;
    }>;
    fields: Array<{
        path: string;
        owners: readonly string[];
        valueType: ExtractorValueType;
    }>;
    relations: Array<{
        key: string;
        owners: readonly string[];
        target: string;
        cardinality: 'one' | 'many';
    }>;
};
export type EffectCompileSchemaOwner = {
    owner: CompileOwner;
    schema: TSchema | unknown;
};
export type EffectCompileFieldSeed = {
    owner: CompileOwner;
    path: string;
    valueType: CompileValueState;
};
export type EffectCompileRelationSeed = {
    owner: CompileOwner;
    key: string;
    target: CompileOwner;
    cardinality: 'one' | 'many';
};
export type EffectCompileTypingEnvironment = {
    extractorRegistry: EffectCompileExtractorRegistry;
    baseSelectorKeys?: Iterable<string>;
    baseSelectorStates?: Readonly<Record<string, readonly CompileState[]>>;
    schemaOwners?: readonly EffectCompileSchemaOwner[];
    fieldSeeds?: readonly EffectCompileFieldSeed[];
    relationSeeds?: readonly EffectCompileRelationSeed[];
    conditionTypes?: Iterable<string>;
    evaluatorTypes?: Iterable<string>;
    operatorTypes?: Iterable<string>;
    conditionTypingRules?: Partial<Record<string, CompileNodeTypingRule>>;
    evaluatorTypingRules?: Partial<Record<string, CompileNodeTypingRule>>;
    operatorTypingRules?: Partial<Record<string, CompileNodeTypingRule>>;
};
export declare function createPathObjectState(owner: CompileOwner, path: string): CompileValueState;
export declare function createScalarValueState(valueType: CompileScalarType): CompileValueState;
export declare function createEffectCompileTypingValidator(environment: EffectCompileTypingEnvironment): (raw: Record<string, unknown>) => void;
export declare function validateEffectCompileTyping(raw: Record<string, unknown>, environment: EffectCompileTypingEnvironment): void;
export {};
//# sourceMappingURL=effect-compile-validator.d.ts.map