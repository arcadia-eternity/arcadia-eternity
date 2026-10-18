/** Host policy, never an author-controlled rule parameter. */
export const executionBudgetPolicy = Object.freeze({ depth: 64, actions: 4096, turnActions: 50000 })
export type ExecutionBudgetDimension = keyof typeof executionBudgetPolicy

export class ExecutionBudgetExceeded extends Error {
  readonly name = 'ExecutionBudgetExceeded'
  constructor(
    readonly dimension: ExecutionBudgetDimension,
    readonly limit: number,
    readonly turn: number,
  ) {
    super(`Execution budget exceeded: ${dimension} (${limit}) at turn ${turn}`)
  }
}

/** One instance per Battle; scopes follow execution, not caller-supplied contexts. */
export class ExecutionBudget {
  private scopes = 0
  private depth = 0
  private actions = 0
  private turnActions = 0
  private turn = -1
  private failure?: ExecutionBudgetExceeded
  constructor(private readonly onFault: () => void) {}
  exportState(): { turn: number; turnActions: number } {
    this.assertActive()
    if (this.scopes !== 0) throw new Error('Cannot snapshot active execution budget')
    return { turn: this.turn, turnActions: this.turnActions }
  }
  restoreState(state: unknown): void {
    if (this.scopes !== 0 || this.turn !== -1 || this.failure) throw new Error('Budget already initialized')
    if (typeof state !== 'object' || state === null) throw new Error('Invalid execution budget state')
    const value = state as Record<string, unknown>
    if (
      Object.keys(value).some(key => key !== 'turn' && key !== 'turnActions') ||
      !Number.isSafeInteger(value.turn) ||
      (value.turn as number) < -1 ||
      !Number.isSafeInteger(value.turnActions) ||
      (value.turnActions as number) < 0 ||
      (value.turnActions as number) > executionBudgetPolicy.turnActions
    )
      throw new Error('Invalid execution budget state')
    this.turn = value.turn as number
    this.turnActions = value.turnActions as number
  }
  get fault(): ExecutionBudgetExceeded | undefined {
    return this.failure
  }
  assertActive(): void {
    if (this.failure) throw this.failure
  }
  run<T>(turn: number, operation: () => T): T {
    this.assertActive()
    if (this.scopes === 0) {
      this.actions = 0
      if (turn !== this.turn) {
        this.turn = turn
        this.turnActions = 0
      }
    }
    this.scopes++
    try {
      const result = operation()
      this.assertActive()
      return result
    } finally {
      this.scopes--
    }
  }
  dispatch<T>(turn: number, operation: () => T): T {
    return this.run(turn, () => {
      this.depth++
      try {
        if (this.depth > executionBudgetPolicy.depth) this.exhaust('depth')
        return operation()
      } finally {
        this.depth--
      }
    })
  }
  action<T>(turn: number, operation: () => T): T {
    return this.run(turn, () => {
      if (++this.actions > executionBudgetPolicy.actions) this.exhaust('actions')
      if (++this.turnActions > executionBudgetPolicy.turnActions) this.exhaust('turnActions')
      return operation()
    })
  }
  private exhaust(dimension: ExecutionBudgetDimension): never {
    this.failure ??= new ExecutionBudgetExceeded(dimension, executionBudgetPolicy[dimension], this.turn)
    this.onFault()
    throw this.failure
  }
}
