import type { Battle, BattleSnapshot } from '@arcadia-eternity/battle/v4'
import type { BattleRuntimeSnapshot } from '@arcadia-eternity/interface'

/** Bind the saved effective inputs to the initial native checkpoint without comparing random instance IDs. */
export function initialFingerprint(battle: Battle, runtime: BattleRuntimeSnapshot): Record<string, unknown> {
  const saved = JSON.parse(runtime.payload) as { battle: BattleSnapshot; teamSelection: unknown; reconnect: unknown }
  const root = saved.battle.root as { ref: number }
  const rng = saved.battle.nodes[root.ref].fields.rngState as { ref: number }
  return {
    boundary: saved.battle.boundary,
    status: battle.status,
    phase: battle.currentPhase,
    turn: battle.currentTurn,
    allowFaintSwitch: battle.allowFaintSwitch,
    showHidden: battle.showHidden,
    rng: saved.battle.nodes[rng.ref],
    timer: battle.getTimerConfig(),
    teamSelection: saved.teamSelection,
    reconnect: saved.reconnect,
    players: [battle.playerA, battle.playerB].map(player => ({
      name: player.name,
      rage: player.currentRage,
      active: player.team.indexOf(player.activePet),
      team: player.team.map(pet => ({
        name: pet.name,
        species: pet.originalSpecies.id,
        level: pet.level,
        evs: pet.evs,
        ivs: pet.ivs,
        nature: pet.nature,
        gender: pet.gender,
        weight: pet.weight,
        height: pet.height,
        maxHp: pet.maxHp,
        hp: pet.currentHp,
        ability: pet.ability?.id,
        emblem: pet.emblem?.id,
        skills: pet.baseSkills.map(skill => skill.id),
      })),
    })),
  }
}
