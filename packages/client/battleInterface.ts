import type { BattleState, PlayerSelection, BattleMessage } from '@test-battle/const'
import { SelectionParser } from '@test-battle/parser'
import type { IBattleSystem } from '@test-battle/interface'
import type { BattleClient } from 'client'

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
