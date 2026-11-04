export {
  LocalBattleSystemV4,
  type NativeMessageView,
  type NativeBattleContent,
  type NativeBattleHostOptions,
} from './src/v4-host/local-battle'
/** Public host contract shared by the native reference and the dedicated Worker adapter. */
export type BattleHost = Pick<
  import('./src/v4-host/local-battle').LocalBattleSystemV4,
  keyof import('./src/v4-host/local-battle').LocalBattleSystemV4
>
