import { BattleSystem } from '@core/battleSystem'

export abstract class BattleUI {
  constructor(protected battle: BattleSystem) {}
}
