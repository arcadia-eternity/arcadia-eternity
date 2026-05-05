import type { World, AttributeSystem } from '@arcadia-eternity/engine';
import type { BattleState } from '@arcadia-eternity/const';
import type { PlayerSystem } from './player.system.js';
import type { PetSystem } from './pet.system.js';
import type { MarkSystem } from './mark.system.js';
import type { SkillSystem } from './skill.system.js';
export interface StateSerializerSystems {
    playerSystem: PlayerSystem;
    petSystem: PetSystem;
    markSystem: MarkSystem;
    skillSystem: SkillSystem;
    attrSystem: AttributeSystem;
}
export declare function worldToBattleState(world: World, systems: StateSerializerSystems, viewerId?: string, showHidden?: boolean): BattleState;
//# sourceMappingURL=state-serializer.d.ts.map