import type { Action, Condition } from './effectBuilder'

export function createConditionAction(action: Action, condition: Condition, elseAction?: Action): Action {
  return ctx => {
    if (condition(ctx)) action(ctx)
    else if (elseAction) elseAction(ctx)
  }
}
