import type { BattleState, PlayerSelection, BattleMessage } from '@arcadia-eternity/const'
import { SelectionParser } from '@arcadia-eternity/parser'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { BattleClient } from './client'

export class RemoteBattleSystem implements IBattleSystem {
  constructor(private client: BattleClient) {}

  async getState(): Promise<BattleState> {
    return this.client.getBattleState()
  }

  async getAvailableSelection(): Promise<PlayerSelection[]> {
    return (await this.client.getAvailableSelection()).map(s => SelectionParser.parse(s))
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    return this.client.sendplayerSelection(SelectionParser.serialize(selection))
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    const unsubscribe = this.client.on('battleEvent', callback)
    return () => unsubscribe()
  }
}
