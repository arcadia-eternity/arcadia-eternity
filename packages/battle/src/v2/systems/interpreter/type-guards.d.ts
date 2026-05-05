import type { ConditionDSL, EvaluatorDSL, ExtractorDSL, SelectorChain, SelectorDSL, SelectorValue } from '@arcadia-eternity/schema';
import type { DamageContextData, UseSkillContextData } from '../../schemas/context.schema.js';
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function isUseSkillContext(value: unknown): value is UseSkillContextData;
export declare function isDamageContext(value: unknown): value is DamageContextData;
export declare function isSelectorValue(value: unknown): value is SelectorValue;
export declare function isSelectorChain(value: unknown): value is SelectorChain;
export declare function isChainSelector(value: unknown): value is {
    base: string;
    chain?: SelectorChain[];
};
export declare function isConditionalSelector(value: unknown): value is {
    condition: ConditionDSL;
    trueSelector: SelectorDSL;
    falseSelector?: SelectorDSL;
};
export declare function isExtractorDsl(value: unknown): value is ExtractorDSL;
export declare function isSelectorDsl(value: unknown): value is SelectorDSL;
export declare function isConditionDsl(value: unknown): value is ConditionDSL;
export declare function isEvaluatorDsl(value: unknown): value is EvaluatorDSL;
//# sourceMappingURL=type-guards.d.ts.map