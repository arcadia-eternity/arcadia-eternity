import { createRequire } from 'node:module'

export interface CreatorPage {
  path: string
  title: string
  topic: string
  symbols: string[]
}

function page(path: string, title: string, topic: string, ...symbols: string[]): CreatorPage {
  return { path, title, topic, symbols }
}

export const creatorSections = [
  {
    title: '从工作台开始',
    outcome: '建立资料包，用霜团打一场可复现的对战，再连接 AI 助手。',
    reference: false,
    pages: [
      page('start/first-battle', '创建项目，打第一场对战', 'tutorials', 'first-battle'),
      page('start/project', '资料包、源文件与对战环境', 'authoring', 'project-layout'),
      page('start/assistant', '连接工作台和 AI 助手', 'tutorials', 'connect-assistant'),
    ],
  },
  {
    title: '实作课程 · 霜击',
    outcome: '把减速从两回合延长到三回合，验证再次命中只刷新持续时间。',
    reference: false,
    pages: [
      page('frost-strike', '把霜击的减速延长到三回合', 'tutorials', 'frost-strike'),
      page('tutorials/frost-strike/trace', '追踪命中后的减速效果', 'tutorials', 'frost-strike.trace'),
      page('tutorials/frost-strike/change', '修改印记的持续时间', 'tutorials', 'frost-strike.change'),
      page('tutorials/frost-strike/verify', '验证刷新与到期恢复', 'tutorials', 'frost-strike.verify'),
    ],
  },
  {
    title: '制作精灵与技能',
    outcome: '制作冰砾和雪芽，配置配招、立绘和技能描述。',
    reference: false,
    pages: [
      page('make/first-skill', '给霜团做一招新技能', 'tutorials', 'first-skill'),
      page('make/first-species', '制作第一只精灵', 'tutorials', 'first-species'),
      page('make/presentation', '替换立绘与编写技能描述', 'descriptions', 'presentation', 'locales'),
    ],
  },
  {
    title: '编排赛制',
    outcome: '举办单精灵杯，用两支队伍检查报名规则。',
    reference: false,
    pages: [page('make/singles-cup', '举办单精灵杯', 'tutorials', 'singles-cup')],
  },
  {
    title: '测试与发布',
    outcome: '把机制写成断言，安装到本机环境，生成可分享的发行归档。',
    reference: false,
    pages: [
      page('test/scenarios', '编写战斗场景测试', 'effects', 'prepareContentPack', 'attack'),
      page('test/troubleshooting', '排查保存、试玩和入场问题', 'authoring', 'troubleshooting'),
      page('publish/local', '把作品安装到本机环境', 'release', 'local-install'),
      page('publish/release', '用 Git 和发行归档分享作品', 'release', 'release-workflow', 'release_check'),
    ],
  },
  {
    title: '内容格式',
    reference: true,
    pages: [
      page(
        'api/species',
        '物种、属性与可学习技能',
        'species',
        'baseStats',
        'learnable_skills',
        'learnable_skills[].skill_id',
      ),
      page('api/skill-fields', '技能基础字段', 'skills', 'power', 'accuracy', 'rage', 'category', 'element'),
      page('api/skill-behaviors', '技能绑定 · behaviors', 'skills', 'behaviors', 'behaviors[].definitionId'),
      page(
        'api/mark-duration',
        '印记持续与刷新 · duration',
        'marks',
        'config.duration',
        'config.stackStrategy',
        'config.maxStacks',
      ),
      page('api/team', '队伍、首发与配招', 'team', 'team', 'team_list', 'team_save'),
      page(
        'api/environment',
        '环境规则与队伍校验',
        'environment',
        'rules.team.maxSize',
        'environment_list',
        'environment_save',
        'team_validate',
      ),
    ],
  },
  {
    title: '效果用法',
    reference: true,
    pages: [
      page(
        'api/effect-lifecycle',
        '效果声明与触发时机',
        'effects',
        'effect',
        'on',
        'NativeEffectContext',
        'HealContext',
      ),
      page('api/on-hit', '命中后施加印记 · OnHit', 'effects', 'EffectTrigger.OnHit', 'Pet.addMark', 'AddMarkContext'),
      page(
        'api/bind-attribute',
        '绑定速度 · bindAttribute',
        'effects',
        'ops.bindAttribute',
        'EffectTrigger.OnMarkCreated',
      ),
      page(
        'api/effect-state',
        '参数、随机数与跨回合状态',
        'effects',
        'numberParam',
        'defineEffectState',
        'getEffectState',
        'setEffectState',
      ),
    ],
  },
  {
    title: 'MCP 与命令行',
    reference: true,
    pages: [
      page('api/author-reference', '按符号查询 · author_reference', 'mcp', 'author_reference'),
      page(
        'api/workspace',
        '项目上下文、内容查询与保存',
        'mcp',
        'workspace_describe',
        'workspace_context',
        'content_query',
        'content_apply',
        'source_read',
        'source_apply',
      ),
      page(
        'api/battle-test',
        '测试与试战 · battle_create',
        'mcp',
        'test_start',
        'job_get',
        'preview_start',
        'battle_create',
        'battle_read',
        'battle_action',
        'battle_events',
        'battle_close',
      ),
      page('api/cli', '创作 CLI 命令', 'authoring', 'arcadia-content'),
    ],
  },
]

export const creatorPages = creatorSections.flatMap(section => section.pages)

export const creatorDocsOrigin = 'https://arcadia-creator-docs.pages.dev'
export const creatorSdkVersion: string = createRequire(import.meta.url)('../package.json').version
