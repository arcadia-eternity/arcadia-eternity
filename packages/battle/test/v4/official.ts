import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import {
  Battle,
  BattleMessageType,
  PhaseState,
  BattleStatus,
  BattlePhase,
  type PlayerSelection,
  type BattleMessage,
} from '@arcadia-eternity/battle/v4'
import {
  DataRepository,
  EffectParser,
  MarkParser,
  SkillParser,
  SpeciesParser,
  PlayerParser,
} from '@arcadia-eternity/battle/v4/legacy'
import input from '../../src/v2/__tests__/fixtures/baseline/official-switch.input.json'

/** All content uses the original V1 schemas, parsers and DSL. No effect reimplementation. */
export async function loadHistoricalContent() {
  const repository = DataRepository.getInstance()
  for (const category of ['effects', 'marks', 'skills', 'species'] as const) repository.clearCategory(category)
  const counts: Record<string, number> = {}
  const failures: string[] = []
  const groups = [
    {
      names: ['effect_global', 'effect_ability', 'effect_emblem', 'effect_mark', 'effect_skill'],
      category: 'effects' as const,
      parse: EffectParser.parse,
    },
    {
      names: ['mark_global', 'mark_ability', 'mark_emblem', 'mark'],
      category: 'marks' as const,
      parse: MarkParser.parse,
    },
    { names: ['skill'], category: 'skills' as const, parse: SkillParser.parse },
    { names: ['species'], category: 'species' as const, parse: SpeciesParser.parse },
  ]
  for (const group of groups) {
    let count = 0
    for (const name of group.names) {
      const raw = parse(await readFile(new URL(`./fixtures/v1-data/${name}.yaml`, import.meta.url), 'utf8'), {
        merge: true,
      }) as { id: string }[]
      for (const record of raw) {
        try {
          // Each original parser preserves its constructor return type; no semantic conversion.
          const value = group.parse(record)
          if (group.category === 'effects' && 'triggers' in value) repository.effects.set(record.id, value)
          else if (group.category === 'marks' && 'config' in value) repository.marks.set(record.id, value)
          else if (group.category === 'skills' && 'power' in value) repository.skills.set(record.id, value)
          else if (group.category === 'species' && 'baseStats' in value) repository.species.set(record.id, value)
          else throw new Error('Parser returned unexpected object')
          count++
        } catch (error) {
          failures.push(`${name}/${record.id}: ${error instanceof Error ? error.message : 'Unknown parser failure'}`)
        }
      }
    }
    counts[group.category] = count
  }
  return { counts, failures }
}

export async function createHistoricalOfficialBattle() {
  const content = await loadHistoricalContent()
  // Huanli was added after V1. Feed its unchanged current species definition
  // through the original V1 parser; skills/effects still come from pinned V1 YAML.
  const currentSpecies = parse(
    await readFile(new URL('../../../../packs/base/data/species.yaml', import.meta.url), 'utf8'),
    { merge: true },
  ) as { id: string; ability: string[]; emblem: string[] }[]
  const huanli = currentSpecies.find(s => s.id === 'pet_huanli')
  if (!huanli) throw new Error('Missing #201 Huanli definition')
  // No ability/emblem is selected by #201's V2 factory; preserve that roster.
  DataRepository.getInstance().species.set(huanli.id, SpeciesParser.parse({ ...huanli, ability: [], emblem: [] }))
  const players = input.teams.map(team => PlayerParser.parse(team))
  const battle = new Battle(players[0], players[1], { rngSeed: 201, timerConfig: { enabled: false }, showHidden: true })
  return { battle, players, content }
}

export async function runHistoricalOfficial() {
  const { battle, players, content } = await createHistoricalOfficialBattle()
  const indexes = [0, 0]
  const events: BattleMessage[] = []
  const checkpoints: { turn: number; hp: number[]; rage: number[]; marks: string[] }[] = []
  const actions: PlayerSelection[] = []
  const errors: string[] = []
  const submit = (side: number) => {
    const player = players[side]
    const plan = input.actions[side === 0 ? 'A' : 'B'][indexes[side]++]
    if (!plan) throw new Error(`Official script exhausted: ${side}, turn ${battle.currentTurn}`)
    const phase = battle.currentPhase === BattlePhase.SelectionPhase ? 'selection' : 'switch'
    if (plan.phase !== phase)
      throw new Error(`Wrong official script phase: ${plan.phase} vs ${phase}, turn ${battle.currentTurn}`)
    const selection = battle.getAvailableSelection(player.id).find(s => {
      if (s.type !== plan.type) return false
      if (s.type === 'use-skill') return battle.getSkillByID(s.skill).base.id === ('skill' in plan ? plan.skill : null)
      if (s.type === 'switch-pet') return battle.getPetByID(s.pet).name === ('pet' in plan ? plan.pet : null)
      return true
    })
    if (!selection || !battle.setSelection(selection))
      throw new Error(`Official action rejected: ${JSON.stringify(plan)}`)
    actions.push(selection)
  }
  battle.registerListener(message => {
    events.push(message)
    try {
      if (message.type === BattleMessageType.TurnAction) {
        submit(0)
        submit(1)
      }
      if (message.type === BattleMessageType.ForcedSwitch)
        message.data.player.forEach(id => submit(players.findIndex(p => p.id === id)))
      if (message.type === BattleMessageType.FaintSwitch) submit(players.findIndex(p => p.id === message.data.player))
      if (message.type === BattleMessageType.TurnEnd)
        checkpoints.push({
          turn: battle.currentTurn,
          hp: players.flatMap(p => p.team.map(pet => pet.currentHp)),
          rage: players.map(p => p.currentRage),
          marks: players.flatMap(p => p.team.flatMap(pet => pet.marks.map(m => m.baseId))),
        })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown parser failure')
      throw error
    }
  })
  try {
    await battle.startBattle()
    const phases = battle.phaseManager.getPhasesByState(PhaseState.Failed)
    if (phases.length || errors.length)
      throw new Error([...errors, ...phases.map(p => `${p.constructor.name}: ${p.result?.error}`)].join('\n'))
    if (
      events.some(m =>
        ([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(m.type),
      )
    )
      throw new Error('Official battle emitted an execution failure')
    if (battle.status !== BattleStatus.Ended || indexes.some(n => n !== 8))
      throw new Error('Official battle incomplete')
    return {
      content,
      turn: battle.currentTurn,
      winner: battle.victor?.name,
      checkpoints,
      indexes,
      effects: events.filter(m => m.type === BattleMessageType.EffectApply).map(m => m.data),
      eventTypes: events.map(m => m.type),
      actions: actions.map(s => s.type),
    }
  } finally {
    await battle.cleanup()
  }
}
