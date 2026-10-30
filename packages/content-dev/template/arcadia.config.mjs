// Demo and tests use these players. IDs and references describe this pack's example content.
export default {
  players: ({ namespace }) =>
    [0, 1].map(side => ({
      id: String(side).repeat(21),
      name: side === 0 ? 'Blue' : 'Orange',
      team: [
        {
          id: String(side + 2).repeat(21),
          name: 'Frostling',
          species: `${namespace}:pet`,
          level: 100,
          nature: 'Hardy',
          skills: [`${namespace}:strike`, `${namespace}:rest`],
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        },
      ],
    })),
}
