import type { PeerTransportMessage, PeerTransportState } from './peerTransport'

type Listener<T> = (value: T) => void

export class Listeners<T> extends Set<Listener<T>> {
  subscribe(listener: Listener<T>): () => void {
    this.add(listener)
    return () => this.delete(listener)
  }

  emit(value: T): void {
    this.forEach(listener => listener(value))
  }
}

export abstract class PeerTransportEvents {
  protected readonly messages = new Listeners<PeerTransportMessage>()
  private readonly stateChanges = new Listeners<PeerTransportState>()
  private state: PeerTransportState = 'idle'

  onMessage(handler: Listener<PeerTransportMessage>): () => void {
    return this.messages.subscribe(handler)
  }

  onStateChange(handler: Listener<PeerTransportState>): () => void {
    return this.stateChanges.subscribe(handler)
  }

  getState(): PeerTransportState {
    return this.state
  }

  protected setState(next: PeerTransportState): void {
    this.state = next
    this.stateChanges.emit(next)
  }
}
