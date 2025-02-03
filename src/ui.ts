import { BattleSystem } from './simulation/battleSystem'

export abstract class BattleUI {
  constructor(protected battle: BattleSystem) {}
}
