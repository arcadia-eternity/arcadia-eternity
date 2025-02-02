import { BattleSystem } from './battleSystem'

export abstract class BattleUI {
  constructor(protected battle: BattleSystem) {}
}
