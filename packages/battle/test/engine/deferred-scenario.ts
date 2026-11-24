import {
  BaseMark,
  BaseSkill,
  Category,
  Element,
  EffectTrigger,
  StackStrategy,
  TurnContext,
  executeTurnOperation,
  type Battle,
  type Player,
  type PlayerSelection,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'
import { compileEffect } from '../../src/engine/content/authoring'
import { conditions, contexts, ops } from '@arcadia-eternity/battle/authoring'
import { makeScenario } from './scenario'

export function makeDeferredScenario(
  options: {
    sourcePolicy?: 'any' | 'active' | 'alive'
    capturePower?: boolean
    stackStrategy?: StackStrategy
    hits?: number
  } = {},
) {
  const mark = new BaseMark('fixture/future-sight-mark' as baseMarkId, [], {
    persistent: false,
    duration: 1,
    destroyable: true,
    isShield: false,
    stackable: true,
    maxStacks: 3,
    stackStrategy: options.stackStrategy ?? StackStrategy.refresh,
    keepOnSwitchOut: false,
    transferOnSwitch: false,
    inheritOnFaint: false,
  })
  const effect = compileEffect({
    id: 'fixture/future-sight-cast',
    triggers: [EffectTrigger.BeforeHit],
    when: conditions.selfUsesSkill,
    apply: contexts.skillUse.apply(
      ops.deferSkillDamage(mark, {
        afterTurns: 2,
        sourcePolicy: options.sourcePolicy,
        capturePower: options.capturePower,
      }),
    ),
  })
  const skill = new BaseSkill.Builder()
    .withID('fixture/future-sight')
    .withType(Element.Fire)
    .withSkillType(Category.Special)
    .withPower(40)
    .withTag('fixture/foresight')
    .withRageCost(5)
    .withMultihit(options.hits ?? 1)
    .setSureHit()
    .addEffect(effect)
    .build()
  const scenario = makeScenario(207, undefined, false, undefined, undefined, undefined, skill)
  scenario.a.currentRage = scenario.a.maxRage
  return { ...scenario, mark, skill: scenario.a.activePet.skills[0] }
}

type DeferredTurnAction = 'cast' | 'wait' | 'switch'

function select(player: Player, action: DeferredTurnAction): PlayerSelection {
  switch (action) {
    case 'cast':
      return {
        player: player.id,
        type: 'use-skill',
        skill: player.activePet.skills[0].id,
        target: player.activePet.skills[0].target,
      }
    case 'switch':
      return { player: player.id, type: 'switch-pet', pet: player.team.find(pet => pet !== player.activePet)!.id }
    case 'wait':
      return { player: player.id, type: 'do-nothing' }
  }
}

export function advanceDeferredTurn(battle: Battle, a: DeferredTurnAction = 'wait', b: DeferredTurnAction = 'wait') {
  battle.playerA.selection = select(battle.playerA, a)
  battle.playerB.selection = select(battle.playerB, b)
  executeTurnOperation(new TurnContext(battle), battle)
}
