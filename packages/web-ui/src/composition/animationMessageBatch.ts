/** A snapshot may cover only the prefix of a skill group, not its later damage. */
export function planAnimationMessages<T extends { sequenceId?: number }>(messages: T[], snapshotSequence: number) {
  const pending = messages.filter(message => message.sequenceId === undefined || message.sequenceId > snapshotSequence)
  return { pending, animate: pending.length > 0 && pending[0] === messages[0] }
}
