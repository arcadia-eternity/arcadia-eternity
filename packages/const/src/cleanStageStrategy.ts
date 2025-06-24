export enum CleanStageStrategy {
  all = 'all', // 清理所有能力等级
  positive = 'positive', //清理有利的能力等级
  negative = 'negative', //清理负面的能力等级
  reverse = 'reverse', //反转能力等级（正变负，负变正）
}
