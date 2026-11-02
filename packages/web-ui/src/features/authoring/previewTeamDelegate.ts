import { computed, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import type { TeamEditorDelegate } from '@/components/team/delegate'

/** A test team belongs to its captured candidate, with no personal collection capabilities. */
export function createPreviewTeamDelegate(
  players: Ref<PlayerSchemaType[]>,
  side: number,
  defaults: PlayerSchemaType[],
  persist: () => void,
): TeamEditorDelegate {
  return {
    team: computed({
      get: () => players.value[side]!.team,
      set: team => {
        players.value[side]!.team = team
        persist()
      },
    }),
    name: computed(() => (side === 0 ? '我方测试队伍' : '对方测试队伍')),
    ready: computed(() => !!players.value[side]),
    persist,
    createPet: () => {
      const template = players.value[side]?.team[0] ?? defaults[side]?.team[0]
      return template ? { ...JSON.parse(JSON.stringify(template)), id: nanoid() } : undefined
    },
    removePet(id, done) {
      players.value[side]!.team = players.value[side]!.team.filter(pet => pet.id !== id)
      persist()
      done()
    },
    removeLabel: '移出测试队伍',
  }
}
