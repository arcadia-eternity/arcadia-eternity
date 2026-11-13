import type { ProfileData } from '@arcadia-eternity/local-profile'
import { Gender, Nature } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'

export const getDefaultTeam = (): ProfileData['library']['teams'][number] => ({
  name: '默认队伍',
  ruleSetId: 'casual_standard_ruleset', // 默认使用休闲规则集
  pets: [
    {
      id: nanoid(),
      name: '休罗斯',
      species: 'pet_xiuluosi',
      level: 100,
      evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_dixiulazhinu', 'skill_lieyanjuexiji', 'skill_qili', 'skill_fenlitupo', 'skill_yanggong'],
      gender: Gender.Male,
      nature: Nature.Jolly,
      ability: 'mark_ability_yanhuo',
      emblem: 'mark_emblem_nuhuo',
      height: 77,
      weight: 39,
    },
    {
      id: nanoid(),
      name: '迪兰特',
      species: 'pet_dilante',
      level: 100,
      evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_wujindaxuanwo', 'skill_ruodianbiaoji', 'skill_feiliupubu', 'skill_yanmo', 'skill_shuihuajianshe'],
      gender: Gender.Male,
      nature: Nature.Modest,
      ability: 'mark_ability_zhongjie',
      emblem: 'mark_emblem_zhuiji',
      height: 102,
      weight: 31,
    },
    {
      id: nanoid(),
      name: '拉奥叶',
      species: 'pet_laaoye',
      level: 100,
      evs: { hp: 4, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_laaodehuhuan', 'skill_xueruo', 'skill_qianyesha', 'skill_jishengzhongzi', 'skill_jishengzhadan'],
      gender: Gender.Female,
      nature: Nature.Bold,
      ability: 'mark_ability_jianren',
      emblem: 'mark_emblem_zhiyu',
      height: 83,
      weight: 33,
    },
  ],
})
