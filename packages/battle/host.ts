export {
  LocalBattleSystem,
  type NativeMessageView,
  type NativeBattleContent,
  type NativeBattleHostOptions,
} from './src/host/local-battle'
export type { TrainingCommand, TrainingState } from './src/host/training'
/** Public host contract shared by the native reference and the dedicated Worker adapter. */
export type BattleHost = Pick<
  import('./src/host/local-battle').LocalBattleSystem,
  keyof import('./src/host/local-battle').LocalBattleSystem
>
