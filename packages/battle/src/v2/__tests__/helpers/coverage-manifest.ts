// v2 skill/mark test coverage manifest.
// Each id listed here means "has at least one dedicated unit/regression test case".

export interface CoverageManifest {
  skills: Record<string, string[]>
  marks: Record<string, string[]>
}

export const v2CoverageManifest: CoverageManifest = {
  skills: {
    // Core regression cases already covered.
    skill_qili: ['v2-effects-marks-regression: stat-stage raise'],
    skill_lingcaiguangxian: ['v2-effects-marks-regression: sand-poison heal reduction'],
    skill_hunzhuoshuiyu: ['v2-effects-marks-regression: double debuff'],
    skill_wanyouyinli: ['v2-effects-marks-regression: opponent debuff by mark'],
    skill_bumiezhixin: ['v2-effects-marks-regression: survive lethal'],
    skill_fenlitupo: ['v2-effects-marks-regression: yanggong consume and amplify'],
    skill_zhuixingquan: ['v2-effects-marks-regression: xingzhi probability behavior'],
    skill_quanlichongzhuang: ['v2-effects-marks-regression: xingzhili side-effect disable'],
  },
  marks: {
    mark_dianhe: ['v2-effects-marks-regression: stack affects crit bonus'],
    mark_shadu: ['v2-effects-marks-regression: sand-poison heal reduction'],
    mark_hunzhuoshuiyu: ['v2-effects-marks-regression: doubles debuff stage'],
    mark_busi: ['v2-effects-marks-regression: lethal damage keeps hp=1'],
    mark_yanggong: ['v2-effects-marks-regression: consumed after buff'],
    mark_mianyibuliang: ['v2-effects-marks-regression: blocks status marks'],
    mark_mianyiyichang: ['v2-effects-marks-regression: blocks exceptional marks'],
    mark_xingzhili: ['v2-effects-marks-regression: does not boost prob; disables side effect'],
    mark_xingzhihui: ['v2-effects-marks-regression: boosts skill effect probability'],
  },
}

