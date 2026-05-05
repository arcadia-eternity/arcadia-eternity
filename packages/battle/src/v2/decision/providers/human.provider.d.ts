import type { PlayerSelection } from '@arcadia-eternity/const';
import type { DecisionProvider, DecisionContext } from '../types.js';
export declare class HumanDecisionProvider implements DecisionProvider {
    readonly capabilities: readonly ['public'];
    decide(ctx: DecisionContext): Promise<PlayerSelection>;
}
//# sourceMappingURL=human.provider.d.ts.map