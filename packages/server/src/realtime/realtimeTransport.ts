export interface RealtimeTransport {
  sendToPlayer(playerId: string, event: string, data: unknown): Promise<boolean>
  sendToPlayerSession(playerId: string, sessionId: string, event: string, data: unknown): Promise<boolean>
  sendToRoom(roomId: string, event: string, data: unknown): Promise<void>
  joinPlayerToRoom(playerId: string, roomId: string): Promise<boolean>
  getLocalSessionIds(): Promise<Set<string>>
}
