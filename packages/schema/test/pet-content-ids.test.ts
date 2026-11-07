import { expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { PetSchema } from '../src/pet'

it('accepts official and namespaced species identifiers without accepting arbitrary strings', () => {
  const species = PetSchema.properties.species
  for (const id of ['pet_dilan', 'example-slow:pet', 'other-pack:forms/alternate'])
    expect(Value.Check(species, id)).toBe(true)
  for (const id of ['dilan', 'EXAMPLE:pet', ':pet', 'example:', 'example:UPPER'])
    expect(Value.Check(species, id)).toBe(false)
})
