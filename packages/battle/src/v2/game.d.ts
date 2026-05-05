import { type World, PhaseManager, EffectPipeline, EventBus, SchemaTypeChecker, AttributeSystem } from '@arcadia-eternity/engine';
import { DamageSystem } from '@arcadia-eternity/plugin-damage';
import type { TimerConfig, TeamSelectionConfig } from '@arcadia-eternity/const';
import type { DecisionProviderFactory, DecisionProviderSpec } from './decision/types.js';
import { PetSystem } from './systems/pet.system.js';
import { SkillSystem } from './systems/skill.system.js';
import { MarkSystem } from './systems/mark.system.js';
import { PlayerSystem } from './systems/player.system.js';
import { StatStageMarkSystem } from './systems/stat-stage-mark.system.js';
import { type OperatorHandler } from './systems/interpreter/operator-registry.js';
import { type ConditionHandler } from './systems/interpreter/condition-registry.js';
import { type SelectorBaseHandler, type SelectorChainHandler } from './systems/interpreter/selector-registry.js';
export interface BattleConfig {
    seed?: string;
    rngSeed?: number;
    allowFaintSwitch?: boolean;
    showHidden?: boolean;
    timerConfig?: Partial<TimerConfig>;
    teamSelection?: {
        enabled: boolean;
        config?: Partial<TeamSelectionConfig>;
    };
    ai?: {
        enabled?: boolean;
        players?: Array<'playerA' | 'playerB'>;
        strategy?: 'simple' | 'random';
    };
    decision?: {
        playerA?: DecisionProviderSpec;
        playerB?: DecisionProviderSpec;
        registry?: Record<string, DecisionProviderFactory>;
    };
    customConfig?: Record<string, unknown>;
    operatorHandlers?: Record<string, OperatorHandler>;
    conditionHandlers?: Record<string, ConditionHandler>;
    selectorBaseHandlers?: Record<string, SelectorBaseHandler>;
    selectorChainHandlers?: Record<string, SelectorChainHandler>;
}
export interface BattleInstance {
    world: World;
    phaseManager: PhaseManager;
    effectPipeline: EffectPipeline;
    eventBus: EventBus;
    schemaChecker: SchemaTypeChecker;
    config: BattleConfig;
    attrSystem: AttributeSystem;
    petSystem: PetSystem;
    skillSystem: SkillSystem;
    markSystem: MarkSystem;
    playerSystem: PlayerSystem;
    damageSystem: DamageSystem;
    statStageSystem: StatStageMarkSystem;
}
export declare function createBattle(config?: BattleConfig): BattleInstance;
//# sourceMappingURL=game.d.ts.map