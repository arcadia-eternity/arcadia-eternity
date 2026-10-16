import {
  createBattle,
  restoreBattle,
  replayBattle,
  defineEffect,
  EffectRegistry,
  EffectTrigger,
  Modifier,
  DurationType,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  computed,
  type BattleContent,
  type BattleOptions,
} from '@arcadia-eternity/battle/core'

/** Same transformation/expiry/restore/replay scenario executes in Node and the real Browser. */
export function verifyTransformations(input: BattleContent, initial: BattleOptions) {
  const content = JSON.parse(JSON.stringify(input)) as BattleContent
  const options = JSON.parse(JSON.stringify(initial)) as BattleOptions
  content.skills.forEach(skill => {
    skill.effects = []
    skill.sureHit = true
  })
  content.marks.forEach(mark => {
    mark.effects = []
  })
  const control = { ...content.marks[0], id: 'transform-control', effects: [{ id: 'forms', version: '1', params: {} }] }
  content.marks.push(control, { ...content.marks[0], id: 'transform-source', effects: [] })
  content.species.push({ ...content.species[0], id: 'transformed-species', abilityIds: [], emblemIds: [] })
  content.skills.push({ ...content.skills[0], id: 'transformed-skill', power: 40, rage: 0, effects: [] })
  options.players.forEach(player =>
    player.team.forEach(pet => {
      pet.skills = [content.skills[0].id]
      pet.maxHp = 1000
    }),
  )
  options.players[0].team[0].ability = control.id
  const effect = defineEffect({
    id: 'forms',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(ctx) {
      const pet = ctx.battle.playerA.activePet
      const source = ctx.battle.addMark(pet, 'transform-source')!
      source.config.persistent = false
      source.config.maxStacks = 3
      source.stack = 2
      source.duration = 1
      ctx.battle.transform(pet, ctx.battle.content.species('transformed-species'), { causedBy: source })
      ctx.battle.transform(pet.skills[0], ctx.battle.content.skill('transformed-skill'), { causedBy: source })
      pet.currentHp = 900
      pet.attributeSystem.addModifier(
        'currentHp',
        new Modifier(DurationType.binding, 'host-hp', 10, 'delta', 0, source),
      )
      ctx.battle.configSystem.registerConfig('damage', 5)
      ctx.battle.configSystem.addConfigModifier(
        'damage',
        new ConfigModifier(ConfigDurationType.binding, 'source-config', 2, ConfigModifierType.delta, 0, source),
      )
      pet.skills[0].attributeSystem.addModifier(
        'power',
        new Modifier(
          DurationType.binding,
          'source-stack',
          source.attributeSystem.reference('stack'),
          'delta',
          0,
          source,
        ),
      )
      pet.attributeSystem.addModifier(
        'atk',
        new Modifier(
          DurationType.binding,
          'host-computed',
          computed<number>('host-dynamic', '1', { pet: pet.id }),
          'delta',
          0,
          source,
        ),
      )
    },
  })
  const registry = new EffectRegistry(
      [effect],
      [
        {
          id: 'host-dynamic',
          version: '1',
          evaluate(battle, params) {
            return (
              battle.getPetByID(params.pet as string).marks.find(mark => mark.base.id === 'transform-source')!.stack * 3
            )
          },
        },
      ],
    ),
    battle = createBattle(options, content, registry)
  battle.start()
  if (battle.playerA.activePet.base.id !== 'transformed-species') throw new Error('Pet transformation did not execute')
  if (battle.playerA.activePet.skills[0].base.id !== 'transformed-skill')
    throw new Error('Skill transformation did not execute')
  if (
    battle.playerA.activePet.skills[0].power !== 42 ||
    battle.configSystem.get('damage', battle.playerA.activePet) !== 7
  )
    throw new Error('Dynamic values did not execute')
  const restored = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), content, registry)
  for (const instance of [battle, restored]) {
    for (const player of instance.players) {
      const action = instance.getAvailableActions(player.id).find(action => action.type === 'use-skill')
      if (!action || !instance.submitAction(action).accepted) throw new Error('Transformation action rejected')
    }
  }
  const identical = JSON.stringify(battle.snapshot()) === JSON.stringify(restored.snapshot())
  const replay = replayBattle(battle.exportReplay(), content, registry)
  const replayed = JSON.stringify(replay.snapshot()) === JSON.stringify(battle.snapshot())
  const endedForms = battle.getEvents().filter(event => event.type === 'transformEnd').length
  if (!identical || !replayed || endedForms !== 2) throw new Error('Transformation restore/expiry/replay mismatch')
  if (
    battle.playerA.activePet.skills[0].attributeSystem.snapshot() ||
    battle.configSystem.get('damage', battle.playerA.activePet) !== 5
  )
    throw new Error('Source modifier cleanup failed')
  return {
    identical,
    replayed,
    endedForms,
    modifiersCleaned: true,
    remainingForms: battle.getState().transformations!.targets.length,
  }
}
