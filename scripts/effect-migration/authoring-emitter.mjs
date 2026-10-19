const fields = (v, keys) =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const q = JSON.stringify
function normalize(v) {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize(v[k])]),
        )
      : v
}
function root(s, domain = 'damage') {
  if (domain === 'skill' && s === 'selfPlayer') return 'targets.selfPlayer'
  if (domain === 'skill' && s === 'battle') return 'contexts.battle'
  if (s === 'self') return 'targets.ownerPet'
  if (s === 'opponent') return 'targets.opponentActive'
  if (s === 'mark') return 'targets.sourceMark'
  if (s === 'selfMarks') return 'targets.ownerMarks'
  if (s === 'damageContext') return 'contexts.damage'
  if (s === 'usingSkillContext') return 'contexts.skillUse'
  if (s === 'opponentMarks') return 'targets.opponentMarks'
}
function markFilter(step, domain = 'damage') {
  if (!fields(step, ['type', 'extractor', 'evaluator']) || step.type !== 'whereAttr') return
  const { extractor, evaluator: v } = step
  const e = domain === 'skill' && typeof extractor === 'string' ? { type: 'base', arg: extractor } : extractor
  if (
    domain === 'skill' &&
    fields(e, ['type', 'arg']) &&
    e.type === 'base' &&
    e.arg === 'baseId' &&
    fields(v, ['type', 'value']) &&
    v.type === 'anyOf' &&
    Array.isArray(v.value) &&
    v.value.every(x => typeof x === 'string')
  )
    return `mark => (${q(v.value)} as string[]).includes(mark.baseId)`
  if (
    fields(e, ['type', 'arg']) &&
    e.type === 'base' &&
    e.arg === 'baseId' &&
    fields(v, ['type', 'value']) &&
    v.type === 'same' &&
    typeof v.value === 'string'
  )
    return `mark => mark.baseId === ${q(v.value)}`
  if (
    fields(e, ['type', 'arg']) &&
    e.type === 'base' &&
    e.arg === 'tags' &&
    fields(v, ['type', 'tag']) &&
    v.type === 'contain' &&
    typeof v.tag === 'string'
  )
    return `mark => mark.tags.includes(${q(v.tag)})`
}
function members(s, domain = 'damage') {
  if (!fields(s, ['base', 'chain']) || !Array.isArray(s.chain)) return
  let code = root(s.base, domain)
  let steps = s.chain
  if (domain === 'skill' && s.base === 'battle') {
    const [select, flat, ...rest] = steps
    if (
      !fields(select, ['type', 'arg']) ||
      select.type !== 'select' ||
      !fields(select.arg, ['type', 'arg']) ||
      select.arg.type !== 'base' ||
      select.arg.arg !== 'marks' ||
      !fields(flat, ['type']) ||
      flat.type !== 'flat'
    )
      return
    code = 'contexts.battle.flatMap(battle => battle.marks)'
    steps = rest
  } else if (!(s.base === 'selfMarks' || (domain === 'skill' && s.base === 'opponentMarks'))) return
  for (const step of steps) {
    const filter = markFilter(step, domain)
    if (!filter) return
    code += `.where(${filter})`
  }
  return code
}
/** Static TS emitter for explicitly understood numeric steps; no runtime interpreter is emitted. */
function selectedNumber(s, parameters, path, consumption = 'first', domain = 'damage', options = {}) {
  const collection = consumption === 'all'
  const terminal = collection ? '.all()' : '.first()'
  if (!fields(s, ['base', 'chain']) || !Array.isArray(s.chain)) return
  let code = root(s.base, domain),
    numeric = false,
    optional = false
  if (!code) return
  for (const [index, step] of s.chain.entries()) {
    if (!numeric && ['selfMarks', 'opponentMarks'].includes(s.base)) {
      const filter = markFilter(step)
      if (filter) {
        code += `.where(${filter})`
        continue
      }
    }
    if (!fields(step, ['type', 'arg'])) return
    if (!numeric) {
      const e = step.arg
      let name
      if (
        step.type === 'select' &&
        fields(e, ['type', 'arg']) &&
        e.type === 'base' &&
        ['stack', 'currentHp', 'maxHp', 'rage'].includes(e.arg)
      )
        name = e.arg
      else if (
        step.type === 'select' &&
        fields(e, ['type', 'arg']) &&
        e.type === 'dynamic' &&
        (e.arg === 'lastSkillUsedTimes' ||
          (domain === 'skill' && ['weight', 'height', 'level', 'maxRage', 'currentTurn', 'duration'].includes(e.arg)))
      )
        name = e.arg
      else if (
        step.type === 'selectPath' &&
        (step.arg === 'stack' ||
          (s.base === 'damageContext' && step.arg === 'damageResult') ||
          (['skill', 'damage'].includes(domain) && s.base === 'usingSkillContext' && step.arg === 'multihitResult') ||
          (domain === 'skill' &&
            ['self', 'opponent'].includes(s.base) &&
            ['stat.spa', 'stat.atk'].includes(step.arg)) ||
          (collection && s.base === 'usingSkillContext' && step.arg === 'power'))
      )
        name = step.arg
      if (
        ['mark', 'selfMarks', 'opponentMarks'].includes(s.base) &&
        (name === 'stack' || (domain === 'skill' && name === 'duration'))
      )
        code += `.select(mark => mark.${name})${terminal}`
      else if (
        ['self', 'opponent'].includes(s.base) &&
        ['currentHp', 'maxHp', 'lastSkillUsedTimes', ...(domain === 'skill' ? ['stat.spa', 'stat.atk'] : [])].includes(
          name,
        )
      )
        code += `.select(pet => pet.${name === 'maxHp' ? 'stat.maxHp' : name})${terminal}`
      else if (
        domain === 'skill' &&
        ['self', 'opponent'].includes(s.base) &&
        ['weight', 'height', 'level'].includes(name)
      ) {
        code += `.select(pet => pet.${name})${terminal}`
        optional = name !== 'level'
        if (collection && optional) return
      } else if (domain === 'skill' && s.base === 'selfPlayer' && ['rage', 'maxRage'].includes(name))
        code += `.select(player => player.${name === 'rage' ? 'currentRage' : name})${terminal}`
      else if (domain === 'skill' && s.base === 'battle' && name === 'currentTurn')
        code += `.select(battle => battle.currentTurn)${terminal}`
      else if (s.base === 'damageContext' && name === 'damageResult')
        code += `.select(event => event.damageResult)${terminal}`
      else if (['skill', 'damage'].includes(domain) && s.base === 'usingSkillContext' && name === 'multihitResult')
        code += `.select(event => event.multihitResult)${terminal}`
      else if (collection && s.base === 'usingSkillContext' && name === 'power')
        code += `.select(event => event.power)${terminal}`
      else return
      numeric = true
    } else {
      if (optional) return
      if (
        options.dynamicClamp &&
        ['clampMin', 'clampMax'].includes(step.type) &&
        fields(step.arg, ['type', 'selector']) &&
        step.arg.type === 'dynamic'
      ) {
        const limits = selectedNumber(step.arg.selector, parameters, `${path}_step${index}`, 'all', domain, options)
        if (!limits) return
        const operation = step.type === 'clampMax' ? 'min' : 'max'
        code = collection
          ? `values.combine(${code},${limits},(items,limits) => items.map((n,index) => Math.${operation}(n,limits[index] ?? 0)))`
          : `values.combine(${code},${limits},(n,limits) => Math.${operation}(n,limits[0] ?? 0))`
        continue
      }
      if (options.conditionalDivisor && step.type === 'divide' && !collection) {
        const v = step.arg
        if (fields(v, ['type', 'condition', 'trueValue', 'falseValue']) && v.type === 'conditional') {
          const c = v.condition
          const selected =
            fields(c, ['type', 'target', 'evaluator']) &&
            c.type === 'evaluate' &&
            fields(c.evaluator, ['type']) &&
            c.evaluator.type === 'exist' &&
            c.target?.base === 'opponentMarks'
              ? members(c.target, 'skill')
              : undefined
          if (!selected || ![v.trueValue, v.falseValue].every(n => Number.isFinite(n) && n !== 0)) return
          const divisor = `values.choose(${selected}.condition(checks.exists()),${q(v.trueValue)},${q(v.falseValue)})`
          code = `values.combine(${code},${divisor},(n,divisor) => Math.floor(n / divisor))`
          continue
        }
      }
      const parameter = !Number.isFinite(step.arg)
        ? rawParameter(step.arg, parameters, `${path}_step${index}`)
        : undefined
      if (!Number.isFinite(step.arg) && !parameter) return
      // A configured divisor may become zero. Keep it out until the zero contract is mapped.
      if (parameter && step.type === 'divide') return
      // Literal numeric sources contain one item; legacy pairs by index and uses zero for missing RHS.
      // Multi-member division therefore produces nonfinite values and needs a separate decision.
      if (collection && ['selfMarks', 'opponentMarks'].includes(s.base) && step.type === 'divide') return
      const n = parameter
        ? collection
          ? '(index === 0 ? factor : 0)'
          : 'factor'
        : collection
          ? `(index === 0 ? ${q(step.arg)} : 0)`
          : q(step.arg)
      const expression = {
        multiply: `Math.floor(n * ${n})`,
        divide: `Math.floor(n / ${n})`,
        add: `n + ${n}`,
        clampMin: `Math.max(n, ${n})`,
        clampMax: `Math.min(n, ${n})`,
      }[step.type]
      if (!expression || (step.type === 'divide' && step.arg === 0)) return
      code = parameter
        ? collection
          ? `values.combine(${code},${parameter.code},(items,factor) => items.map((n,index) => ${expression}))`
          : `values.combine(${code},${parameter.code},(n,factor) => ${expression})`
        : collection
          ? `${code}.map(items => items.map((n,index) => ${expression}))`
          : `${code}.map(n => ${expression})`
    }
  }
  return numeric ? code : undefined
}
function rawParameter(v, parameters, name) {
  if (!parameters || !v || typeof v !== 'object' || v.type !== 'raw:number') return
  if (!Object.keys(v).every(k => ['type', 'value', 'configId', 'tags'].includes(k)) || !Number.isFinite(v.value)) return
  if ('configId' in v && (typeof v.configId !== 'string' || !v.configId)) return
  if ('tags' in v && (!Array.isArray(v.tags) || !v.tags.every(t => typeof t === 'string'))) return
  // Repeated legacy aliases share configuration, so reject them pending an explicit shared declaration mapping.
  if (v.configId && parameters.some(p => p.configId === v.configId)) return
  parameters.push({
    name,
    value: v.value,
    ...(v.configId ? { configId: v.configId } : {}),
    ...(v.tags ? { tags: [...v.tags] } : {}),
  })
  return { code: `parameters.${name}`, literal: false, required: true }
}
function number(v, parameters, path, domain = 'damage', options = {}) {
  if (Number.isFinite(v)) return { code: q(v), literal: true }
  if (v?.type === 'raw:number') return rawParameter(v, parameters, path)
  if (fields(v, ['type', 'selector']) && v.type === 'dynamic') {
    const code = selectedNumber(v.selector, parameters, path, 'first', domain, options)
    if (code) return { code, literal: false }
  }
  if (fields(v, ['type', 'condition', 'trueValue', 'falseValue']) && v.type === 'conditional') {
    // Legacy parsing treats a falsy false branch as absent, not numeric zero.
    if (!v.falseValue) return
    const c = condition(v.condition, domain, undefined, 'condition', options),
      yes = number(v.trueValue, undefined, undefined, domain, options),
      no = number(v.falseValue, undefined, undefined, domain, options)
    // Keep optional-valued branches out until the public choose contract explicitly supports them.
    if (c && yes?.literal && no?.literal)
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
    if (c && yes && no && (yes.literal || yes.required) && (no.literal || no.required))
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
  }
}
function condition(c, domain = 'damage', parameters, path = 'condition', options = {}) {
  if (fields(c, ['type'])) {
    if (domain === 'switch' && c.type === 'selfSwitchOut') return 'conditions.ownerSwitchesOut'
    if (domain === 'switch' && c.type === 'selfSwitchIn') return 'conditions.ownerSwitchesIn'
    if (domain === 'skill' && c.type === 'petIsActive') return 'conditions.ownerIsActive'
    if (domain === 'skill' && c.type === 'isFirstSkillUsedThisTurn') return 'conditions.firstSkillThisTurn'
    if (domain === 'skill' && c.type === 'isLastSkillUsedThisTurn') return 'conditions.lastSkillThisTurn'
    if (domain === 'skill' && options.defensiveSkill && c.type === 'opponentUseSkill')
      return 'conditions.skillActorDiffersFromOwner'
    if (c.type === 'selfUseSkill') return 'conditions.selfUsesSkill'
    // checkSelf refers to a different event subject in each supported stage family.
    if (c.type === 'checkSelf')
      return options.eventOwnership
        ? 'conditions.sourceOwnsEvent'
        : domain === 'switch'
          ? 'conditions.ownerSwitchesIn'
          : domain === 'skill'
            ? 'conditions.ownerUsesSkill'
            : 'conditions.selfBeDamaged'
    if (domain === 'skill' && c.type === 'selfBeSkillTarget') return 'conditions.ownerIsSkillTarget'
    if (c.type === 'selfBeDamaged' && domain === 'damage') return 'conditions.selfBeDamaged'
  }
  if (
    domain === 'skill' &&
    fields(c, ['type', 'times', 'strategy']) &&
    c.type === 'continuousUseSkill' &&
    c.strategy === 'Periodic' &&
    Number.isSafeInteger(c.times) &&
    c.times > 0
  )
    return `conditions.everyNthUse(${c.times})`
  if (
    domain === 'skill' &&
    c?.type === 'continuousUseSkill' &&
    Object.keys(c).every(key => ['type', 'times', 'strategy'].includes(key)) &&
    (!Object.hasOwn(c, 'times') || Number.isSafeInteger(c.times)) &&
    (c.times ?? 2) > 0 &&
    (!Object.hasOwn(c, 'strategy') || ['Once', 'Continuous'].includes(c.strategy))
  ) {
    const comparison = c.strategy === 'Once' ? '===' : '>='
    return `conditions.all(conditions.ownerUsesSkill,contexts.skillUse.condition((_ctx,events) => (events[0]?.skill.owner?.lastSkillUsedTimes ?? 0) ${comparison} ${c.times ?? 2}))`
  }
  if (
    fields(c, ['type', 'conditions']) &&
    ['every', 'some'].includes(c.type) &&
    Array.isArray(c.conditions) &&
    c.conditions.length
  ) {
    const items = c.conditions.map((item, index) => condition(item, domain, parameters, `${path}_${index}`, options))
    if (items.every(Boolean)) return `conditions.${c.type === 'every' ? 'all' : 'any'}(${items.join(',')})`
  }
  if (fields(c, ['type', 'condition']) && c.type === 'not') {
    const inner = condition(c.condition, domain, parameters, `${path}_not`, options)
    if (inner) return `conditions.not(${inner})`
  }
  if (fields(c, ['type', 'baseId']) && typeof c.baseId === 'string') {
    if (c.type === 'selfHasMark')
      return `targets.ownerMarks.where(mark => mark.baseId === ${q(c.baseId)}).condition(checks.exists())`
    if (c.type === 'opponentHasMark')
      return `targets.opponentActive.condition((_ctx,pets) => pets.some(pet => pet.marks.some(mark => mark.baseId === ${q(c.baseId)})))`
  }
  if (
    fields(c, ['type', 'target', 'evaluator']) &&
    c.type === 'evaluate' &&
    c.target === 'self' &&
    fields(c.evaluator, ['type', 'percent']) &&
    c.evaluator.type === 'probability'
  ) {
    const percent = number(c.evaluator.percent, parameters, `${path}_percent`, domain, options)
    if (percent && (percent.literal || percent.required)) return `conditions.chance(${percent.code})`
  }
  if (
    (domain === 'skill' || (domain === 'damage' && c?.target?.base === 'usingSkillContext')) &&
    fields(c, ['type', 'target', 'evaluator']) &&
    c.type === 'evaluate'
  ) {
    const target = c.target,
      evaluator = c.evaluator
    if (
      fields(target, ['base', 'chain']) &&
      ['self', 'opponent'].includes(target.base) &&
      Array.isArray(target.chain) &&
      target.chain.length === 1
    ) {
      const step = target.chain[0]
      if (
        fields(step, ['type', 'arg']) &&
        step.type === 'selectPath' &&
        step.arg === 'gender' &&
        fields(evaluator, ['type', 'operator', 'value']) &&
        evaluator.type === 'compare' &&
        evaluator.operator === '==' &&
        ['Male', 'Female', 'NoGender'].includes(evaluator.value)
      )
        return `${root(target.base)}.condition((_ctx,pets) => pets.some(pet => pet.gender === ${q(evaluator.value)}))`
      if (
        fields(step, ['type', 'arg']) &&
        step.type === 'select' &&
        fields(step.arg, ['type', 'arg']) &&
        step.arg.type === 'base' &&
        step.arg.arg === 'element' &&
        fields(evaluator, ['type', 'value']) &&
        ['same', 'notSame'].includes(evaluator.type) &&
        typeof evaluator.value === 'string'
      )
        return `${root(target.base)}.condition((_ctx,pets) => pets[0]?.element ${evaluator.type === 'same' ? '===' : '!=='} ${q(evaluator.value)})`
      if (
        fields(step, ['type', 'arg']) &&
        step.type === 'select' &&
        fields(step.arg, ['type', 'arg']) &&
        step.arg.type === 'base' &&
        step.arg.arg === 'element' &&
        fields(evaluator, ['type', 'value']) &&
        evaluator.type === 'anyOf' &&
        Array.isArray(evaluator.value) &&
        evaluator.value.every(x => typeof x === 'string')
      )
        return `${root(target.base)}.condition((_ctx,pets) => pets.some(pet => (${q(evaluator.value)} as string[]).includes(pet.element)))`
    }

    const t = c.target,
      e = c.evaluator
    if (fields(t, ['base', 'chain']) && t.base === 'usingSkillContext' && Array.isArray(t.chain)) {
      const [skill, property, flat] = t.chain
      if (fields(skill, ['type', 'arg']) && skill.type === 'selectPath' && skill.arg === 'skill') {
        if (
          options.skillCategory &&
          t.chain.length === 2 &&
          fields(property, ['type', 'arg']) &&
          property.type === 'selectPath' &&
          property.arg === 'category' &&
          fields(e, ['type', 'value']) &&
          ['same', 'notSame'].includes(e.type) &&
          ['Physical', 'Special', 'Status'].includes(e.value)
        )
          return `contexts.skillUse.condition((_ctx,events) => events[0]?.skill.category ${e.type === 'same' ? '===' : '!=='} ${q(e.value)})`
        if (
          t.chain.length === 2 &&
          fields(property, ['type', 'arg']) &&
          property.type === 'select' &&
          (property.arg === 'baseId' ||
            (fields(property.arg, ['type', 'arg']) && property.arg.type === 'base' && property.arg.arg === 'baseId')) &&
          fields(e, ['type', 'value']) &&
          ['same', 'notSame'].includes(e.type) &&
          typeof e.value === 'string'
        )
          return `contexts.skillUse.condition((_ctx,events) => events[0]?.skill.baseId ${e.type === 'same' ? '===' : '!=='} ${q(e.value)})`
        if (
          t.chain.length === 3 &&
          fields(property, ['type', 'arg']) &&
          property.type === 'select' &&
          fields(property.arg, ['type', 'arg']) &&
          property.arg.type === 'base' &&
          property.arg.arg === 'tags' &&
          fields(flat, ['type']) &&
          flat.type === 'flat' &&
          fields(e, ['type', 'tag']) &&
          e.type === 'contain' &&
          typeof e.tag === 'string'
        )
          return `contexts.skillUse.condition((_ctx,events) => events.some(event => event.skill.tags.includes(${q(e.tag)})))`
      }
    }
    if (
      fields(t, ['base', 'chain']) &&
      t.base === 'usingSkillContext' &&
      Array.isArray(t.chain) &&
      t.chain.length === 1
    ) {
      const step = t.chain[0]
      if (
        fields(step, ['type', 'arg']) &&
        ((step.type === 'select' && step.arg === 'element') ||
          (step.type === 'selectPath' && ['element', 'category'].includes(step.arg)))
      ) {
        if (fields(e, ['type', 'value']) && ['same', 'notSame'].includes(e.type) && typeof e.value === 'string')
          return `contexts.skillUse.condition((_ctx,events) => events[0]?.${step.arg} ${e.type === 'same' ? '===' : '!=='} ${q(e.value)})`
        if (
          fields(e, ['type', 'value']) &&
          e.type === 'anyOf' &&
          Array.isArray(e.value) &&
          e.value.every(x => typeof x === 'string')
        )
          return `contexts.skillUse.condition((_ctx,events) => events.some(event => (${q(e.value)} as string[]).includes(event.${step.arg})))`
      }
    }
  }
  if (!fields(c, ['type', 'target', 'evaluator']) || c.type !== 'evaluate') return
  const e = c.evaluator
  if (fields(e, ['type']) && e.type === 'exist') {
    const ms = members(c.target, domain)
    if (ms) return `${ms}.condition(checks.exists())`
  }
  if (
    fields(e, ['type', 'operator', 'value']) &&
    e.type === 'compare' &&
    ['<', '>', '<=', '>=', '=='].includes(e.operator)
  ) {
    if (options.collectionCompare && ['selfMarks', 'opponentMarks'].includes(c.target?.base)) {
      const left = selectedNumber(c.target, undefined, undefined, 'all', domain)
      const right = number(e.value, undefined, `${path}_value`, domain, options)
      if (left && right)
        return `((ctx: EffectFrame) => {const left=ctx.read(${left});const right=${right.literal ? right.code : `ctx.read(${right.code})`};return right!==undefined && left.some(value => value ${e.operator === '==' ? '===' : e.operator} right)})`
      return
    }
    // Legacy compare checks every member with some(); only single-entity roots may use first().
    if (
      ![
        'self',
        'opponent',
        'mark',
        'damageContext',
        ...(['skill', 'damage'].includes(domain) ? ['usingSkillContext'] : []),
        ...(domain === 'skill' ? ['selfPlayer', 'battle'] : []),
      ].includes(c.target?.base)
    )
      return
    const left = selectedNumber(c.target, undefined, undefined, 'first', domain),
      right = number(
        e.value,
        c.target.base === 'damageContext' ? parameters : undefined,
        `${path}_value`,
        domain,
        options,
      )
    // Existing optional fields may yield [undefined], distinct from an empty query; don't collapse equality.
    if (e.operator === '==' && [left, right?.code].some(code => code && /pet\.(weight|height)/.test(code))) return
    if (left && right)
      return `((ctx: EffectFrame) => {const left=ctx.read(${left});const right=${right.literal ? right.code : `ctx.read(${right.code})`};return left!==undefined && right!==undefined && left ${e.operator === '==' ? '===' : e.operator} right})`
  }
  if (
    fields(e, ['type', 'value']) &&
    e.type === 'same' &&
    typeof e.value === 'string' &&
    fields(c.target, ['base', 'chain']) &&
    c.target.base === 'damageContext' &&
    Array.isArray(c.target.chain) &&
    c.target.chain.length === 1
  ) {
    const step = c.target.chain[0]
    if (fields(step, ['type', 'arg']) && step.type === 'selectPath' && ['damageType', 'element'].includes(step.arg))
      return `contexts.damage.condition((_ctx,events) => events[0]?.${step.arg} === ${q(e.value)})`
  }
}

export { fields, normalize, number, condition, selectedNumber, members }
