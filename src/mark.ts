import { Pet } from './pet'

// 新增印记系统核心类
export enum TriggerCondition {
  ROUND_START = 'round-start', // 回合开始
  ROUND_END = 'round-end', // 回合结束
  BEFORE_ATTACK = 'before-attack', // 攻击前
  AFTER_ATTACK = 'after-attack', // 攻击后
  AFTER_DAMAGED = 'when-damaged', // 当受到伤害时
  ON_DEFEATED = 'when-defeated', // 当击败对手时
  ON_BEDEFATED = 'on-bedefated', // 当被击败时
  ON_MARKED = 'on-marked', // 当被印记时
  ON_MARK_REMOVED = 'on-mark-removed', // 当印记被移除时
  ON_MARK_STACKED = 'on-mark-stacked', // 当印记叠加时
}

export abstract class TriggerAndEffect {
  constructor(
    public readonly triggers: TriggerCondition[] = [],
    public readonly effect: EffectStrategy,
  ) {}
}

export abstract class Mark {
  public alive = true // 印记是否存在
  constructor(
    public readonly name: string, // 印记名称
    public readonly tags: string[] = [], // 标签
    public readonly description: string = '', // 描述
    public readonly triggerandEffects: TriggerAndEffect[] = [], // 触发效果
    public source?: Pet, // 印记来源
  ) {}
  get num(): number {
    return -1 //在gui中默认显示
  }
  get status(): string {
    return this.name
  } //用于在gui中显示的状态信息

  destroy() {
    this.alive = false
  }
}

export abstract class MarkDecorator extends Mark {
  constructor(protected readonly mark: Mark) {
    super(...mark)
  }
}

export class DurationDecorator extends MarkDecorator {
  readonly maxDuration: number
  constructor(
    mark: Mark,
    public duration: number = -1,
  ) {
    super(mark)
    // 最大持续回合数
    this.maxDuration = duration
    // 持续回合数, 默认-1表示永续
    this.duration = duration
  }
  get num(): number {
    return this.duration
  }
  get status(): string {
    return `${this.mark.status} ${this.duration}/${this.maxDuration}`
  }
}

export abstract class StackDecorator extends MarkDecorator {
  readonly maxStack: number
  constructor(
    mark: Mark,
    public stack: number = 1,
  ) {
    super(mark)
    // 最大叠加层数
    this.maxStack = stack
    // 叠加层数, 默认1
    this.stack = stack
  }
  get num(): number {
    return this.stack
  }
  get status(): string {
    return `${this.mark.status} ${this.stack}/${this.maxStack}`
  }
}

interface EffectStrategy {
  apply(target: Pet, ...args: any[]): void
  getStatModifiers?(): Partial<Record<StatType, LevelModifier>>
}

export enum StatType {
  atk = 'atk',
  def = 'def',
  spa = 'spa',
  spd = 'spd',
  spe = 'spe',
  hp = 'hp',
}
export type LevelModifier = number
