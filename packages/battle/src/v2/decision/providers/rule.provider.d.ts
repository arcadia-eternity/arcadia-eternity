import type { PlayerSelection } from '@arcadia-eternity/const';
import type { DecisionProvider, DecisionContext, AiStrategy } from '../types.js';
export declare class RuleDecisionProvider implements DecisionProvider {
    private strategy;
    readonly capabilities: readonly ['public'];
    constructor(strategy?: AiStrategy);
    decide(ctx: DecisionContext): Promise<PlayerSelection>;
}
//# sourceMappingURL=rule.provider.d.ts.map