import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { Nature } from '@arcadia-eternity/const'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import { createPreviewTeamDelegate } from '../previewTeamDelegate'

function example(): PlayerSchemaType[] {
  return [0, 1].map(side => ({
    id: String(side).repeat(21),
    name: `Side ${side}`,
    team: [
      {
        id: String(side + 2).repeat(21),
        name: 'Test',
        species: 'pack:pet',
        level: 100,
        nature: Nature.Hardy,
        skills: ['pack:strike'],
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      },
    ],
  }))
}

describe('test team delegate ownership', () => {
  it('keeps sides and the project defaults independent while supporting removal and re-adding', () => {
    const defaults = example(),
      initial = JSON.stringify(defaults)
    const players = ref(JSON.parse(initial) as PlayerSchemaType[]),
      persist = vi.fn()
    const left = createPreviewTeamDelegate(players, 0, defaults, persist)
    const right = createPreviewTeamDelegate(players, 1, defaults, persist)
    const copy = left.createPet()!
    copy.skills.push('pack:rest')
    expect(left.team.value[0]!.skills).toEqual(['pack:strike'])
    left.team.value = [copy]
    const removed = vi.fn()
    left.removePet(copy.id, removed)
    expect(removed).toHaveBeenCalledOnce()
    expect(left.team.value).toEqual([])
    left.team.value = [left.createPet()!]
    expect(left.team.value[0]!.id).not.toBe(defaults[0]!.team[0]!.id)
    expect(right.team.value).toEqual(defaults[1]!.team)
    expect(JSON.stringify(defaults)).toBe(initial)
    expect(persist).toHaveBeenCalled()
    expect(left.storageRoute).toBeUndefined()
    expect(left.moveToStorage).toBeUndefined()
    expect(left.importTeam).toBeUndefined()
    expect(left.save).toBeUndefined()
  })
})
