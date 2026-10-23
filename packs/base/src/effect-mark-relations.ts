/** Presentation references for battle skill tooltips and the species encyclopedia. */
export interface EffectMarkRelation {
  readonly markId: string
  readonly relationType: 'adds' | 'removes' | 'consumes'
}

export const officialEffectMarkRelations: Readonly<Record<string, readonly EffectMarkRelation[]>> = {
  effect_ability_add_shoufashanghaizengjia_on_lead: [
    {
      markId: 'mark_shoufashanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_ability_add_shoufashanghaizengjia_on_switch_in: [
    {
      markId: 'mark_shoufashanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_ability_add_xukongtizhi_on_skill_hit: [
    {
      markId: 'mark_xukongtizhi',
      relationType: 'adds',
    },
  ],
  effect_ability_spa_skill_add_dadizhi_1_hit_or_miss: [
    {
      markId: 'mark_dadizhiyou',
      relationType: 'adds',
    },
  ],
  effect_ability_atk_skill_add_shabaozhi_1_hit_or_miss: [
    {
      markId: 'mark_shabaozhili',
      relationType: 'adds',
    },
  ],
  effect_ability_set_field_yemu_on_switch: [
    {
      markId: 'mark_global_yemu',
      relationType: 'adds',
    },
  ],
  effect_ability_add_mark_buxieanguang_on_switch: [
    {
      markId: 'mark_buxieanguang',
      relationType: 'adds',
    },
  ],
  effect_ability_shiguang_climax_add_mark_shiguangchongsheng: [
    {
      markId: 'mark_shiguangchongsheng',
      relationType: 'adds',
    },
  ],
  effect_ability_spa_skill_add_niliu_1: [
    {
      markId: 'mark_niliu',
      relationType: 'adds',
    },
  ],
  effect_ability_atk_skill_add_shunliu_1: [
    {
      markId: 'mark_shunliu',
      relationType: 'adds',
    },
  ],
  effect_ability_set_field_leibaotian_on_switch: [
    {
      markId: 'mark_global_leibaotian',
      relationType: 'adds',
    },
  ],
  effect_ability_set_field_leibaotian_on_lead: [
    {
      markId: 'mark_global_leibaotian',
      relationType: 'adds',
    },
  ],
  effect_ability_add_mark_opponent_xifamihuo_if_using_xifa_skill: [
    {
      markId: 'mark_xifamihuo',
      relationType: 'adds',
    },
  ],
  effect_emblem_add_mark_aideminyi: [
    {
      markId: 'mark_aideminyi',
      relationType: 'adds',
    },
  ],
  effect_emblem_destroy_meihuo_onturnend: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_emblem_add_xukongtizhi_when_opponent_hit_self: [
    {
      markId: 'mark_xukongtizhi',
      relationType: 'adds',
    },
  ],
  effect_emblem_add_mark_fenshenhying_when_use_fenshenshu: [
    {
      markId: 'mark_fenshenhying',
      relationType: 'adds',
    },
  ],
  effect_emblem_add_mark_switchinpet_shoudaoshanghaijianshao_25_on_switchout: [
    {
      markId: 'mark_shoudaoshanghaijianshao',
      relationType: 'adds',
    },
  ],
  effect_emblem_add_mark_shoudaoshanghaijianshao_15_on_switchin: [
    {
      markId: 'mark_shoudaoshanghaijianshao',
      relationType: 'adds',
    },
  ],
  effect_mark_onDamage_recovery: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_onCritDamage_recovery: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_onDamage_over100_recovery: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_reduce_damage_taken_once: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_increase_damage_taken_once: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_amplify_next_damage_skill_power_with_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_onDestroy_add_mark_tizhongjiangdi: [
    {
      markId: 'mark_tizhongjiangdi',
      relationType: 'adds',
    },
  ],
  effect_mark_when_attacked_add_opponent_mark_zhongdu_50_percent: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_mark_onDestroy_add_mark_shanghaizengjia: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_mark_amplify_next_physical_damage_with_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_amplify_next_special_damage_with_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_remove_after_use_skill: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_xukongtizhi_consume_on_evasion: [
    {
      markId: 'mark_xukongganying',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_paralyze_on_physical_50_percent: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_mark_reduce_deal_damage_once_per_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_fear_consume_stacks_at_3: [
    {
      markId: 'mark_kongju',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_mark_explode_on_stack_over_100: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_mark_reduce_accuracy_next_skill_with_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_block_next_special_damage: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_baiyapo_add_damage_based_on_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_heiyapao_add_damage_based_on_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_damage_increase_25_on_switch_in: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_mark_add_damage_taken_with_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_yingfeng_heal_50_on_evasion_in_yemu: [
    {
      markId: 'mark_huifu_50_per_turn',
      relationType: 'adds',
    },
  ],
  effect_mark_yingfeng_destroy_on_hit_or_miss: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_shandianluoyin_paralyze: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_crit_on_damage: [
    {
      markId: 'mark_huixin',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_damage_with_stack_and_consume: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_guanghudun_on_turn_end_with_stack: [
    {
      markId: 'mark_guanghudun',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_amplify_next_electric_skill: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_raise_def_1_when_hit_and_remove_self: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_on_duration_end_add_mark_penti: [
    {
      markId: 'mark_penti',
      relationType: 'adds',
    },
  ],
  effect_mark_on_duration_end_add_mark_qianglipenti: [
    {
      markId: 'mark_qianglipenti',
      relationType: 'adds',
    },
  ],
  effect_mark_prevent_rage_loss_on_switch: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_multihit_1_on_next_multihit_skill: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_hunluan_consume_stacks_at_2: [
    {
      markId: 'mark_hunluan',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_mark_self_damage_50_percent_once: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_self_damage_50_percent_once_when_special: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_mark_add_mark_zhongdu_if_using_physical_attack: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_ruodian: [
    {
      markId: 'mark_ruodianjihao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_ruodian_2: [
    {
      markId: 'mark_ruodianjihao',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_ruodian: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_yishang: [
    {
      markId: 'mark_yishang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yanggong: [
    {
      markId: 'mark_yanggong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_jizhong: [
    {
      markId: 'mark_bizhong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_busi: [
    {
      markId: 'mark_busi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_weilifanbei: [
    {
      markId: 'mark_weilifanbei',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_zhongzinengliang: [
    {
      markId: 'mark_zhongzinengliang',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_all_zhongzinengliang: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_mingzhongxiajiang_15: [
    {
      markId: 'mark_mingzhongxiajiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_jishengzhadan: [
    {
      markId: 'mark_jishengzhadan',
      relationType: 'adds',
    },
  ],
  effect_skill_ignite_opponent_mark_jishengzhadan: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_jisheng: [
    {
      markId: 'mark_jisheng',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_with_zhongzinengliang: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_nishui: [
    {
      markId: 'mark_nishui',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_nishui_10_percent: [
    {
      markId: 'mark_nishui',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huifu: [
    {
      markId: 'mark_huifu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mingzhongtisheng_10: [
    {
      markId: 'mark_mingzhongtisheng',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mingzhongtisheng_15: [
    {
      markId: 'mark_mingzhongtisheng',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_weilibianhua_50: [
    {
      markId: 'mark_weilibianhua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_meihuo: [
    {
      markId: 'mark_meihuo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanbi: [
    {
      markId: 'mark_shanbi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanbi_2: [
    {
      markId: 'mark_shanbi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_bizhong: [
    {
      markId: 'mark_bizhong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mihuo: [
    {
      markId: 'mark_mihuo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_kuihuazhongzi: [
    {
      markId: 'mark_kuihuazhongzi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_wulicao: [
    {
      markId: 'mark_wulicao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xishoucao: [
    {
      markId: 'mark_xishoucao',
      relationType: 'adds',
    },
  ],
  effect_skill_clear_status: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu_5_percent: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu_10_percent: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_qingtian: [
    {
      markId: 'mark_global_qingtian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu_duration_2: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_rouhua_50: [
    {
      markId: 'mark_rouhua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_zengzhong_1: [
    {
      markId: 'mark_zengzhong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_zhifanghudun_stack_with_weight: [
    {
      markId: 'mark_zhifanghudun',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_10_if_heavier_40: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_zengzhong_2: [
    {
      markId: 'mark_zengzhong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_tanhuan_10_percent: [
    {
      markId: 'mark_tanhuan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanghaizengjia_stack_with_zengzhong_stack_x75: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_all_zengzhong: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_exin_opponent_50: [
    {
      markId: 'mark_exin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_tanxingzhifang: [
    {
      markId: 'mark_tanxingzhifang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yinghua_25: [
    {
      markId: 'mark_yinghua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_fanshe: [
    {
      markId: 'mark_fanshe',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_double_mark_liuxie_stack: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mianyiruohua: [
    {
      markId: 'mark_mianyiruohua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shiming_10_percent: [
    {
      markId: 'mark_shiming',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_hunzhuoshuiyu: [
    {
      markId: 'mark_hunzhuoshuiyu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_manxingduyao_1_stack: [
    {
      markId: 'mark_manxingduyao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_manxingduyao_70_percent: [
    {
      markId: 'mark_manxingduyao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_manxingduyao_5_stack: [
    {
      markId: 'mark_manxingduyao',
      relationType: 'adds',
    },
  ],
  effect_skill_destroy_mark_zhongdu: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_all_opponent_manxingduyao: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_judushenti: [
    {
      markId: 'mark_judushenti',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_kongqichuliang_100: [
    {
      markId: 'mark_kongqichuliang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_kongqihudun_stack_with_kongqichuliang_stack: [
    {
      markId: 'mark_kongqihudun',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_all_kongqichuliang: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_zhixi: [
    {
      markId: 'mark_zhixi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_self_yuansuzhufu_increase_on_consecutive_hits_10_max_20: [
    {
      markId: 'mark_yuansuzhufu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xingzhili: [
    {
      markId: 'mark_xingzhili',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shuiwenzhenji: [
    {
      markId: 'mark_shuiwenzhenji',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_shuiwenzhenji: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_shuiwenpingzhang: [
    {
      markId: 'mark_shuiwenpingzhang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_nishui_30_percent: [
    {
      markId: 'mark_nishui',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_yutian: [
    {
      markId: 'mark_global_yutian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_fantan: [
    {
      markId: 'mark_fantan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mianyibuliang: [
    {
      markId: 'mark_mianyibuliang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_xuanyun: [
    {
      markId: 'mark_xuanyun',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shoudaoshanghaijianshao_50: [
    {
      markId: 'mark_shoudaoshanghaijianshao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanghaizengjia_75: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_teshushanghaizengjia_50: [
    {
      markId: 'mark_teshushanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_wulishanghaizengjia_50: [
    {
      markId: 'mark_wulishanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_teshushanghaizengjia_35: [
    {
      markId: 'mark_teshushanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_wulishanghaizengjia_35: [
    {
      markId: 'mark_wulishanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_teshushanghaizengjia_100: [
    {
      markId: 'mark_teshushanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_wulishanghaizengjia_100: [
    {
      markId: 'mark_wulishanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_yanre: [
    {
      markId: 'mark_global_yanre',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yanhuo: [
    {
      markId: 'mark_yanhuo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huoxing: [
    {
      markId: 'mark_huoxing',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_aideminyi: [
    {
      markId: 'mark_aideminyi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shiyanzhiyue: [
    {
      markId: 'mark_shiyanzhiyue',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanbi_if_first: [
    {
      markId: 'mark_shanbi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_xinlingzhiyue: [
    {
      markId: 'mark_xinlingzhiyue',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_jingyangshengxi: [
    {
      markId: 'mark_jingyangshengxi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huifu_1_16: [
    {
      markId: 'mark_huifu_1_16',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huifu_1_16_if_aideminyi: [
    {
      markId: 'mark_huifu_1_16',
      relationType: 'adds',
    },
  ],
  effect_skill_ignite_opponent_mark_shaoshang: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_xueruoshuipao: [
    {
      markId: 'mark_xueruoshuipao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_xuruoshuipao: [
    {
      markId: 'mark_xuruoshuipao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_guanghua: [
    {
      markId: 'mark_guanghua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_suijixianzhi: [
    {
      markId: 'mark_suijixianzhi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_xinzhiyinji: [
    {
      markId: 'mark_xinzhiyinji',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_xinzhiyinji_multihit_consume: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_mingzhongxiajiang_5: [
    {
      markId: 'mark_mingzhongxiajiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_xuehongyinji: [
    {
      markId: 'mark_xuehongyinji',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_zhunbeidongzuo: [
    {
      markId: 'mark_zhunbeidongzuo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_lingqiao: [
    {
      markId: 'mark_lingqiao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_maimaijinzhen: [
    {
      markId: 'mark_maimaijinzhen',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_maimaijinzhen_add_liuxie_50: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_jinzhenwayi: [
    {
      markId: 'mark_jinzhenwayi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_chongzhuangzhenci: [
    {
      markId: 'mark_chongzhuangzhenci',
      relationType: 'adds',
    },
  ],
  effect_skill_add_liuxie_50_opponent: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_maimaijinzhen_heal_self_50: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
    {
      markId: 'mark_huifu_50_per_turn',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_maimaijinzhen_add_maidijinzhen: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
    {
      markId: 'mark_maidijinzhen',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_maidijinzhen_add_jinzhenfenmo: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
    {
      markId: 'mark_jinzhenfenmo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_first_turn_mark_on_switch_in: [
    {
      markId: 'mark_first_turn_after_switch',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhixi_10_or_40_percent_if_has_xukongganying: [
    {
      markId: 'mark_zhixi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shoudaoshanghaijianshao_75: [
    {
      markId: 'mark_shoudaoshanghaijianshao',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yitelingyu: [
    {
      markId: 'mark_yitelingyu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_qiliuyongdong: [
    {
      markId: 'mark_qiliuyongdong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shandianwaiyi: [
    {
      markId: 'mark_shandianwaiyi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_bingdong_40_percent: [
    {
      markId: 'mark_bingdong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_bingningzhiqi: [
    {
      markId: 'mark_bingningzhiqi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_bingshuangzhixing: [
    {
      markId: 'mark_bingshuangzhixing',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mianyiyichang: [
    {
      markId: 'mark_mianyiyichang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_hanbingjia: [
    {
      markId: 'mark_hanbingjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mabi_70_percent: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_dianhe_1: [
    {
      markId: 'mark_dianhe',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_kongjuzhinian: [
    {
      markId: 'mark_kongjuzhinian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_anyingzhiguang: [
    {
      markId: 'mark_anyingzhiguang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shiming_if_first: [
    {
      markId: 'mark_shiming',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_guanghuizhiying: [
    {
      markId: 'mark_guanghuizhiying',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_houkongfan: [
    {
      markId: 'mark_houkongfan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_5_percent: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_10_percent: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xingzhihui_50: [
    {
      markId: 'mark_xingzhihui',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_15_percent: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xingzhihui_20: [
    {
      markId: 'mark_xingzhihui',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yinbo_45: [
    {
      markId: 'mark_yinbo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yinbo_40: [
    {
      markId: 'mark_yinbo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yinbo_35: [
    {
      markId: 'mark_yinbo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yinbo_30: [
    {
      markId: 'mark_yinbo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yinbo_10: [
    {
      markId: 'mark_yinbo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_30_30_percent: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_opponent_yinbo_heal_self_2x: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_opponent_yinbo_add_zaoyin: [
    {
      markId: 'mark_zaoyin',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_opponent_yinbo_add_yinbopingzhang: [
    {
      markId: 'mark_yinbopingzhang',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_opponent_yinbo_damage_2x: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_yinzhiwang: [
    {
      markId: 'mark_yinzhiwang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_pofang_50: [
    {
      markId: 'mark_pofang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_40_if_pofang: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_lanbaoshi: [
    {
      markId: 'mark_lanbaoshi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_hongbaoshi: [
    {
      markId: 'mark_hongbaoshi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_liuxingdun: [
    {
      markId: 'mark_liuxingdun',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shahezhili: [
    {
      markId: 'mark_shahezhili',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yinghua_50: [
    {
      markId: 'mark_yinghua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shazhiwang: [
    {
      markId: 'mark_shazhiwang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mingzhongxiajiang_25: [
    {
      markId: 'mark_mingzhongxiajiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xuli_1: [
    {
      markId: 'mark_xuli',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xuli_5: [
    {
      markId: 'mark_xuli',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shazhidanke: [
    {
      markId: 'mark_shazhidanke',
      relationType: 'adds',
    },
  ],
  effect_skill_add_multihit_1_consume_shazhidanke: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_power_10_consume_shazhidanke: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_sure_hit_consume_shazhidanke: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_priority_plus_1_consume_shazhidanke: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_wuzhezhixin_1: [
    {
      markId: 'mark_wuzhezhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_jueying: [
    {
      markId: 'mark_jueying',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_yingzhidouqi: [
    {
      markId: 'mark_yingzhidouqi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuangrenzhuiji_if_damage_less_100: [
    {
      markId: 'mark_shuangrenzhuiji',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_baiya_equal_damage_max_800: [
    {
      markId: 'mark_baiya',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_gongshoujianbei: [
    {
      markId: 'mark_gongshoujianbei',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_renzhezhixin_1: [
    {
      markId: 'mark_renzhezhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_jiguang: [
    {
      markId: 'mark_jiguang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shanguangboji: [
    {
      markId: 'mark_shanguangboji',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuangpozhuiji_if_damage_less_100: [
    {
      markId: 'mark_shuangpozhuiji',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_heiya_equal_damage_max_800: [
    {
      markId: 'mark_heiya',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xulichongji: [
    {
      markId: 'mark_xulichongji',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_chenmo: [
    {
      markId: 'mark_chenmo',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_fenshen: [
    {
      markId: 'mark_fenshen',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yinghua_65_hit_or_miss: [
    {
      markId: 'mark_yinghua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_60_hit_or_miss: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_mianyiyichang_hit_or_miss: [
    {
      markId: 'mark_mianyiyichang',
      relationType: 'adds',
    },
  ],
  effect_skill_clear_status_hit_or_miss: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_dadizhiyou_1: [
    {
      markId: 'mark_dadizhiyou',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shabaozhili_1: [
    {
      markId: 'mark_shabaozhili',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_jieli_hit_or_miss: [
    {
      markId: 'mark_jieli',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_taitanzhihu: [
    {
      markId: 'mark_taitanzhihu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huafenmiman_1: [
    {
      markId: 'mark_huafenmiman',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuimian_10_percent: [
    {
      markId: 'mark_shuimian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu_consecutive_2_times: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuimian: [
    {
      markId: 'mark_shuimian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_longlinjia: [
    {
      markId: 'mark_longlinjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_50_if_hp_above_half: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_hunmi_5_percent: [
    {
      markId: 'mark_hunmi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_heianwuzhi_1: [
    {
      markId: 'mark_heianwuzhi',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_heianwuzhi_reduce_opponent_spd_1_stage: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_set_field_yemu: [
    {
      markId: 'mark_global_yemu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_power_50_consume_heianwuzhi: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_50_if_field_yemu: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_heimowuzhi_2_sure_crit: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_yingfeng: [
    {
      markId: 'mark_yingfeng',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shoudaoshanghaizengjia_50: [
    {
      markId: 'mark_shoudaoshanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanghaizengjia_150: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mabi_10_percent: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xudian: [
    {
      markId: 'mark_xudian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shandianshoushu: [
    {
      markId: 'mark_shandianshoushu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_hunmi_50_percent_if_opponent_has_mark_mabi: [
    {
      markId: 'mark_hunmi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_hunmi_10_percent: [
    {
      markId: 'mark_hunmi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_jingshencuoluan: [
    {
      markId: 'mark_jingshencuoluan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shihua: [
    {
      markId: 'mark_shihua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huanxiang: [
    {
      markId: 'mark_huanxiang',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_huanxiang_multihit_2: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_consume_huanxiang_raise_spa_1_stage: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_consume_huanxiang_add_mark_opponent_dongshang: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
    {
      markId: 'mark_dongshang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_wanan: [
    {
      markId: 'mark_wanan',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_huanxiang_set_sure_hit: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_consume_huanxiang_raise_def_1_stage: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_zhenshihuanxiang: [
    {
      markId: 'mark_zhenshihuanxiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_taobi: [
    {
      markId: 'mark_taobi',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_huanxiang_multihit_4_to_5: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_consume_huanxiang_raise_spd_1_stage: [
    {
      markId: 'unknown',
      relationType: 'consumes',
    },
  ],
  effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_has_jinbao: [
    {
      markId: 'mark_mingzhongxiajiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_xunjie_1: [
    {
      markId: 'mark_xunjie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_chihuan_1: [
    {
      markId: 'mark_chihuan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_qianggong_1_stack: [
    {
      markId: 'mark_qianggong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yurenfantan: [
    {
      markId: 'mark_yurenfantan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shijianfaze: [
    {
      markId: 'mark_shijianfaze',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shijianhudun: [
    {
      markId: 'mark_shijianhudun',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_chuansuoweilai: [
    {
      markId: 'mark_chuansuoweilai',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yuecuoyueyong: [
    {
      markId: 'mark_yuecuoyueyong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shuiliangchongzu: [
    {
      markId: 'mark_shuiliangchongzu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shuiliangbaohe: [
    {
      markId: 'mark_shuiliangbaohe',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_nishui_50_percent: [
    {
      markId: 'mark_nishui',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_mark_shuiliangbaohe: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_mark_shuiliangchongzu: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_huohuanzhixin_3: [
    {
      markId: 'mark_huohuanzhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huohuanzhixin_2: [
    {
      markId: 'mark_huohuanzhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huohuanzhixin_1: [
    {
      markId: 'mark_huohuanzhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_mark_huohuanzhixin: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_zhenkongzhixin: [
    {
      markId: 'mark_zhenkongzhixin',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_guangwushentong: [
    {
      markId: 'mark_guangwushentong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_guangwulingtong: [
    {
      markId: 'mark_guangwulingtong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_lingtongchuanda: [
    {
      markId: 'mark_lingtongchuanda',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_lache_35: [
    {
      markId: 'mark_lache',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_anhunqu: [
    {
      markId: 'mark_anhunqu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_self_hanshuangpingzhang: [
    {
      markId: 'mark_hanshuangpingzhang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_self_yihuopingzhang: [
    {
      markId: 'mark_yihuopingzhang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuanghunxuanlv: [
    {
      markId: 'mark_shuanghunxuanlv',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_nishui_50_percent_if_has_shunliu: [
    {
      markId: 'mark_nishui',
      relationType: 'adds',
    },
  ],
  effect_skill_clear_status_if_has_niliu: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_dianxizengqiang: [
    {
      markId: 'mark_dianxizengqiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_leishenjuexing: [
    {
      markId: 'mark_leishenjuexing',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_leibaotian: [
    {
      markId: 'mark_global_leibaotian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mabi: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mabi_15_percent: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mabi_20_percent: [
    {
      markId: 'mark_mabi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_dongqifuti: [
    {
      markId: 'mark_dongqifuti',
      relationType: 'adds',
    },
  ],
  effect_skill_consume_dongqifuti_heal_self_quarter_max_hp: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_consume_dongqifuti_sure_crit: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_dongshang_10_percent: [
    {
      markId: 'mark_dongshang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_dongshang_10_percent_if_consume_dongqifuti_70_percent: [
    {
      markId: 'mark_dongshang',
      relationType: 'adds',
    },
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_30_if_max_hp_gt_opponent: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_fansheguike: [
    {
      markId: 'mark_fansheguike',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_hanbinghujia_2x_self_max_hp_minus_500: [
    {
      markId: 'mark_hanbinghujia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_dongshang_when_reused: [
    {
      markId: 'mark_dongshang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_huijiachifan: [
    {
      markId: 'mark_huijiachifan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_rage_with_consume_yinbo_stack: [
    {
      markId: 'unknown',
      relationType: 'removes',
    },
  ],
  effect_skill_add_mark_penti: [
    {
      markId: 'mark_penti',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_qianglipenti: [
    {
      markId: 'mark_qianglipenti',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_chaojipenti: [
    {
      markId: 'mark_chaojipenti',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_fasibilei: [
    {
      markId: 'mark_fasibilei',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_cuimian: [
    {
      markId: 'mark_cuimian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shuimian_40_percent: [
    {
      markId: 'mark_shuimian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_niandongfanshe: [
    {
      markId: 'mark_niandongfanshe',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_50_if_has_cuimian: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_jingshenshikong: [
    {
      markId: 'mark_jingshenshikong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shuimian: [
    {
      markId: 'mark_shuimian',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanghaizengjia_100: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_if_has_cuimian_10_percent: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_haipa_if_has_cuimian_15_percent: [
    {
      markId: 'mark_haipa',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_feixuanzhen: [
    {
      markId: 'mark_feixuanzhen',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhixi_40_percent: [
    {
      markId: 'mark_zhixi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shabaozhen: [
    {
      markId: 'mark_shabaozhen',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanbiwugong_if_shabaolingyu: [
    {
      markId: 'mark_shanbiwugong',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_chongqunzhen: [
    {
      markId: 'mark_chongqunzhen',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhongdu_if_3_hits: [
    {
      markId: 'mark_zhongdu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_lianji: [
    {
      markId: 'mark_lianji',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_chongqun: [
    {
      markId: 'mark_global_chongqun',
      relationType: 'adds',
    },
  ],
  effect_skill_set_field_guzhanchang: [
    {
      markId: 'mark_global_guzhanchang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_both_shanghaizengjia_50: [
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
    {
      markId: 'mark_shanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shanbi_below_1_8_hp: [
    {
      markId: 'mark_shanbi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_rouhua_50_if_female: [
    {
      markId: 'mark_rouhua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yinghua_50_if_male: [
    {
      markId: 'mark_yinghua',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zisun: [
    {
      markId: 'mark_zisun',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shadu: [
    {
      markId: 'mark_shadu',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_shaduzhixue: [
    {
      markId: 'mark_shaduzhixue',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shaduhongxue: [
    {
      markId: 'mark_shaduhongxue',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_tongjiling: [
    {
      markId: 'mark_tongjiling',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_tanhuan_30_percent: [
    {
      markId: 'mark_tanhuan',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_kongju_20_percent: [
    {
      markId: 'mark_kongju',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_yingyongyizhi: [
    {
      markId: 'mark_yingyongyizhi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_kaowen: [
    {
      markId: 'mark_kaowen',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_shoudaoshanghaizengjia_50_if_opponent_has_kaowen: [
    {
      markId: 'mark_shoudaoshanghaizengjia',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_opponent_has_kaowen_and_last: [
    {
      markId: 'mark_mingzhongxiajiang',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_liuxie_40_if_last: [
    {
      markId: 'mark_liuxie',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_taobi_60_percent_if_opponent_has_kaowen: [
    {
      markId: 'mark_taobi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_opponent_zhixi_5_percent: [
    {
      markId: 'mark_zhixi',
      relationType: 'adds',
    },
  ],
  effect_skill_add_mark_bileiyanshen: [
    {
      markId: 'mark_bileiyanshen',
      relationType: 'adds',
    },
  ],
}
