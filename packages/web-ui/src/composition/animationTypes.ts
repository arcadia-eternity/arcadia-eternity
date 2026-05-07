export interface BattleStoreLike {
  isReplayMode: boolean
  isBattleEnd: boolean
  battleState: {
    status: string
    currentPhase?: string
    sequenceId?: number
    players?: Array<{
      team?: Array<{ id: string; currentHp?: number }>
    }>
  } | null
  availableActions: unknown[]
  waitingForResponse: boolean
  fetchAvailableSelection(): Promise<unknown[]>
  playerId: string
  lastProcessedSequenceId: number
  animateQueue: { complete(): void }
  battleInterface: {
    getState(playerId: string, showHidden: boolean): Promise<{ status: string; sequenceId?: number }>
  } | null
}
