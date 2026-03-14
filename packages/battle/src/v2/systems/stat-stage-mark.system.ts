import type { World, AttributeSystem, ModifierDef } from '@arcadia-eternity/engine'
import { createEntity, setComponent, getComponent } from '@arcadia-eternity/engine'
import type { BaseMarkData } from '../schemas/mark.schema.js'
import type { MarkSystem } from './mark.system.js'

export type CleanStageStrategy = 'all' | 'positive' | 'negative'

const MIN_STAGE = -6
const MAX_STAGE = 6

const STAGE_MULTIPLIER_TABLE: Record<number, number> = {
  [-6]: 2 / 8, [-5]: 2 / 7, [-4]: 2 / 6, [-3]: 2 / 5,
  [-2]: 2 / 4, [-1]: 2 / 3, [0]: 1,
  [1]: 3 / 2, [2]: 4 / 2, [3]: 5 / 2,
  [4]: 6 / 2, [5]: 7 / 2, [6]: 8 / 2,
}

function clampStage(value: number): number {
  return Math.max(MIN_STAGE, Math.min(MAX_STAGE, value))
}

function toUpBaseMarkId(stat: string): string {
  return `stat_stage_${stat}_up`
}

function toDownBaseMarkId(stat: string): string {
  return `stat_stage_${stat}_down`
}

function parseStatStageBaseMarkId(baseMarkId: string): { stat: string; direction: 'up' | 'down' } | null {
  const match = /^stat_stage_(.+)_(up|down)$/.exec(baseMarkId)
  if (!match) return null
  return { stat: match[1], direction: match[2] as 'up' | 'down' }
}

export class StatStageMarkSystem {
  private static STAGE_MODIFIER_PREFIX = '__stage_'

  constructor(
    private attrSystem: AttributeSystem,
    private markSystem: MarkSystem,
  ) {}

  getStage(world: World, entityId: string, stat: string): number {
    const upMark = this.markSystem.findByBaseId(world, entityId, toUpBaseMarkId(stat))
    const downMark = this.markSystem.findByBaseId(world, entityId, toDownBaseMarkId(stat))
    const up = upMark ? this.markSystem.getStack(world, upMark.id) : 0
    const down = downMark ? this.markSystem.getStack(world, downMark.id) : 0
    return clampStage(up - down)
  }

  applyStage(world: World, entityId: string, stat: string, delta: number): number {
    const current = this.getStage(world, entityId, stat)
    const next = clampStage(current + delta)
    this.setStage(world, entityId, stat, next)
    return next - current
  }

  setStage(world: World, entityId: string, stat: string, value: number): void {
    const stage = clampStage(value)
    this.ensureBaseMarkEntity(world, toUpBaseMarkId(stat))
    this.ensureBaseMarkEntity(world, toDownBaseMarkId(stat))

    const upMark = this.markSystem.findByBaseId(world, entityId, toUpBaseMarkId(stat))
    const downMark = this.markSystem.findByBaseId(world, entityId, toDownBaseMarkId(stat))

    if (stage > 0) {
      if (downMark) this.markSystem.destroy(world, downMark.id)
      this.ensureMarkWithStack(world, entityId, toUpBaseMarkId(stat), stage, upMark?.id)
    } else if (stage < 0) {
      if (upMark) this.markSystem.destroy(world, upMark.id)
      this.ensureMarkWithStack(world, entityId, toDownBaseMarkId(stat), Math.abs(stage), downMark?.id)
    } else {
      if (upMark) this.markSystem.destroy(world, upMark.id)
      if (downMark) this.markSystem.destroy(world, downMark.id)
    }

    this.syncStageModifier(world, entityId, stat, stage)
  }

  clearStages(
    world: World,
    entityId: string,
    strategy: CleanStageStrategy = 'all',
    stats?: string[],
  ): void {
    const targetStats = stats ?? this.getTrackedStats(world, entityId)
    for (const stat of targetStats) {
      const stage = this.getStage(world, entityId, stat)
      const shouldClear =
        strategy === 'all'
        || (strategy === 'positive' && stage > 0)
        || (strategy === 'negative' && stage < 0)
      if (shouldClear && stage !== 0) {
        this.setStage(world, entityId, stat, 0)
      }
    }
  }

  reverseStages(
    world: World,
    entityId: string,
    strategy: CleanStageStrategy = 'all',
    stats?: string[],
  ): void {
    const targetStats = stats ?? this.getTrackedStats(world, entityId)
    for (const stat of targetStats) {
      const stage = this.getStage(world, entityId, stat)
      const shouldReverse =
        strategy === 'all'
        || (strategy === 'positive' && stage > 0)
        || (strategy === 'negative' && stage < 0)
      if (shouldReverse && stage !== 0) {
        this.setStage(world, entityId, stat, -stage)
      }
    }
  }

  transferStages(
    world: World,
    sourceEntityId: string,
    targetEntityId: string,
    strategy: CleanStageStrategy = 'negative',
    stats?: string[],
  ): { stat: string; stage: number }[] {
    const moved: { stat: string; stage: number }[] = []
    const targetStats = stats ?? this.getTrackedStats(world, sourceEntityId)
    for (const stat of targetStats) {
      const stage = this.getStage(world, sourceEntityId, stat)
      const shouldTransfer =
        strategy === 'all'
        || (strategy === 'positive' && stage > 0)
        || (strategy === 'negative' && stage < 0)
      if (!shouldTransfer || stage === 0) continue

      const targetStage = this.getStage(world, targetEntityId, stat)
      this.setStage(world, targetEntityId, stat, targetStage + stage)
      this.setStage(world, sourceEntityId, stat, 0)
      moved.push({ stat, stage })
    }
    return moved
  }

  getTrackedStats(world: World, entityId: string): string[] {
    const marks = this.markSystem.getMarksOnEntity(world, entityId)
    const stats = new Set<string>()
    for (const mark of marks) {
      const parsed = parseStatStageBaseMarkId(mark.baseMarkId)
      if (parsed) stats.add(parsed.stat)
    }
    return [...stats]
  }

  private stageModifierId(stat: string): string {
    return `${StatStageMarkSystem.STAGE_MODIFIER_PREFIX}${stat}`
  }

  private syncStageModifier(world: World, entityId: string, stat: string, stage: number): void {
    this.attrSystem.removeModifier(world, entityId, stat, this.stageModifierId(stat))
    if (stage === 0) return
    const multiplier = STAGE_MULTIPLIER_TABLE[stage] ?? 1
    const percent = (multiplier - 1) * 100
    const mod: ModifierDef = {
      id: this.stageModifierId(stat),
      type: 'percent',
      value: { kind: 'static', value: percent },
      priority: 100,
      sourceId: `statStage:${entityId}`,
      durationType: 'binding',
    }
    this.attrSystem.addModifier(world, entityId, stat, mod)
  }

  private ensureBaseMarkEntity(world: World, baseMarkId: string): void {
    if (getComponent<BaseMarkData>(world, baseMarkId, 'baseMark')) return
    const baseMark: BaseMarkData = {
      type: 'baseMark',
      id: baseMarkId,
      config: {
        duration: -1,
        persistent: true,
        maxStacks: MAX_STAGE,
        stackable: true,
        stackStrategy: 'max',
        destroyable: true,
        isShield: false,
        keepOnSwitchOut: true,
        transferOnSwitch: false,
        inheritOnFaint: false,
      },
      tags: ['statStage'],
      effectIds: [],
    }
    createEntity(world, baseMarkId, ['baseMark'])
    setComponent(world, baseMarkId, 'baseMark', baseMark)
  }

  private ensureMarkWithStack(
    world: World,
    ownerId: string,
    baseMarkId: string,
    stack: number,
    existingMarkId?: string,
  ): void {
    if (existingMarkId) {
      const mark = this.markSystem.get(world, existingMarkId)
      if (!mark) return
      this.markSystem.setStack(world, existingMarkId, stack)
      return
    }
    const baseMark = getComponent<BaseMarkData>(world, baseMarkId, 'baseMark')
    if (!baseMark) return
    const created = this.markSystem.createFromBase(world, baseMark, { stack, duration: -1 })
    this.markSystem.attach(world, created.id, ownerId, 'pet')
  }
}
