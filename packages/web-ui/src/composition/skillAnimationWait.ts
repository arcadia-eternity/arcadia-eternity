type Side = 'left' | 'right'
type Event = 'attack-hit' | 'animation-complete'
interface SpriteEvents {
  on(event: Event, handler: (side: Side) => void): void
  off(event: Event, handler: (side: Side) => void): void
}

/** Register before starting the sprite, so even synchronous hit events are retained. */
export function waitForSkillAnimation(
  events: SpriteEvents,
  side: Side,
  duration: number,
  onDone: () => void = () => {},
) {
  let resolveHit!: () => void
  let resolveComplete!: () => void
  const hit = new Promise<void>(resolve => {
    resolveHit = resolve
  })
  const complete = new Promise<void>(resolve => {
    resolveComplete = resolve
  })
  const onHit = (eventSide: Side) => {
    if (eventSide === side) resolveHit()
  }
  const cancel = () => {
    clearTimeout(timer)
    events.off('attack-hit', onHit)
    events.off('animation-complete', onComplete)
    resolveHit()
    resolveComplete()
    onDone()
  }
  const onComplete = (eventSide: Side) => {
    if (eventSide === side) cancel()
  }
  const timer = setTimeout(cancel, duration)
  events.on('attack-hit', onHit)
  events.on('animation-complete', onComplete)
  return { hit, complete, cancel }
}
