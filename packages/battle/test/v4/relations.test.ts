import { afterEach, beforeAll, expect, it } from 'vitest'
import { derived, setGlobalLogger, type Battle } from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}

it('publishes each completed list method once, including a handle retained before any subscription', () => {
  const f = fixture()
  const pet = f.a.activePet
  const handle = pet.marks
  const first = f.debuff.createInstance(),
    second = f.debuff.createInstance()
  const states: string[][] = []
  const subscription = derived(() => pet.marks.map(mark => mark.id)).subscribe(ids => states.push(ids))
  handle.push(first, second)
  expect(states).toEqual([[], [first.id, second.id]])
  handle.splice(0, 1)
  expect(states).toEqual([[], [first.id, second.id], [second.id]])
  expect(handle.reverse()).toBe(handle)
  subscription.unsubscribe()
})

it('observes index writes and length changes, and isolates replaced collections', () => {
  const f = fixture()
  const pet = f.a.activePet
  const first = f.debuff.createInstance(),
    second = f.debuff.createInstance()
  const states: string[][] = []
  const subscription = derived(() => pet.marks.map(mark => mark.id)).subscribe(ids => states.push(ids))
  pet.marks[0] = first
  expect(states.at(-1)).toEqual([first.id])
  pet.marks[0] = second
  expect(states.at(-1)).toEqual([second.id])
  pet.marks.length = 0
  expect(states.at(-1)).toEqual([])
  const old = pet.marks
  const input = [first]
  pet.marks = input
  const notifications = states.length
  input.push(second)
  old.push(second)
  old[0] = first
  old.length = 0
  expect(states).toHaveLength(notifications)
  expect(pet.marks).toEqual([first])
  expect(states.at(-1)).toEqual([first.id])
  subscription.unsubscribe()
})

it.each(['pet', 'mark', 'skill'] as const)('observes %s ownership independently of the authoring adapter', kind => {
  const f = fixture()
  const pet = f.a.activePet
  const source = kind === 'pet' ? pet : kind === 'skill' ? pet.skills[0] : f.debuff.createInstance()
  const owners: unknown[] = []
  const subscription = derived(() => source.owner).subscribe(owner => owners.push(owner))
  if (kind === 'pet') pet.owner = f.b
  else if (kind === 'skill') pet.skills[0].owner = f.a.team[1]
  else source.owner = f.a.team[1]
  expect(owners).toHaveLength(2)
  expect(owners[1]).toBe(kind === 'pet' ? f.b : f.a.team[1])
  subscription.unsubscribe()
})
