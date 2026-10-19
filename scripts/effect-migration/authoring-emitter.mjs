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
function root(s) {
  if (s === 'self') return 'targets.ownerPet'
  if (s === 'opponent') return 'targets.opponentActive'
  if (s === 'mark') return 'targets.sourceMark'
  if (s === 'selfMarks') return 'targets.ownerMarks'
}
function markFilter(step) {
  if (!fields(step, ['type', 'extractor', 'evaluator']) || step.type !== 'whereAttr') return
  const { extractor: e, evaluator: v } = step
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
function members(s) {
  if (!fields(s, ['base', 'chain']) || s.base !== 'selfMarks' || !Array.isArray(s.chain)) return
  let code = root(s.base)
  for (const step of s.chain) {
    const filter = markFilter(step)
    if (!filter) return
    code += `.where(${filter})`
  }
  return code
}
/** Static TS emitter for explicitly understood numeric steps; no runtime interpreter is emitted. */
function selectedNumber(s, parameters, path) {
  if (!fields(s, ['base', 'chain']) || !Array.isArray(s.chain)) return
  let code = root(s.base),
    numeric = false
  if (!code) return
  for (const [index, step] of s.chain.entries()) {
    if (!numeric && s.base === 'selfMarks') {
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
      if (step.type === 'select' && fields(e, ['type', 'arg']) && e.type === 'base') name = e.arg
      else if (
        step.type === 'select' &&
        fields(e, ['type', 'arg']) &&
        e.type === 'dynamic' &&
        e.arg === 'lastSkillUsedTimes'
      )
        name = e.arg
      else if (step.type === 'selectPath' && step.arg === 'stack') name = step.arg
      if (['mark', 'selfMarks'].includes(s.base) && name === 'stack') code += '.select(mark => mark.stack).first()'
      else if (['self', 'opponent'].includes(s.base) && ['currentHp', 'maxHp', 'lastSkillUsedTimes'].includes(name))
        code += `.select(pet => pet.${name === 'maxHp' ? 'stat.maxHp' : name}).first()`
      else return
      numeric = true
    } else {
      const parameter = !Number.isFinite(step.arg)
        ? rawParameter(step.arg, parameters, `${path}_step${index}`)
        : undefined
      if (!Number.isFinite(step.arg) && !parameter) return
      // A configured divisor may become zero. Keep it out until the zero contract is mapped.
      if (parameter && step.type === 'divide') return
      const n = parameter ? 'factor' : q(step.arg)
      const expression = {
        multiply: `Math.floor(n * ${n})`,
        divide: `Math.floor(n / ${n})`,
        add: `n + ${n}`,
        clampMin: `Math.max(n, ${n})`,
        clampMax: `Math.min(n, ${n})`,
      }[step.type]
      if (!expression || (step.type === 'divide' && step.arg === 0)) return
      code = parameter
        ? `values.combine(${code},${parameter.code},(n,factor) => ${expression})`
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
function number(v, parameters, path, domain = 'damage') {
  if (Number.isFinite(v)) return { code: q(v), literal: true }
  if (v?.type === 'raw:number') return rawParameter(v, parameters, path)
  if (fields(v, ['type', 'selector']) && v.type === 'dynamic') {
    const code = selectedNumber(v.selector, parameters, path)
    if (code) return { code, literal: false }
  }
  if (fields(v, ['type', 'condition', 'trueValue', 'falseValue']) && v.type === 'conditional') {
    // Legacy parsing treats a falsy false branch as absent, not numeric zero.
    if (!v.falseValue) return
    const c = condition(v.condition, domain),
      yes = number(v.trueValue, undefined, undefined, domain),
      no = number(v.falseValue, undefined, undefined, domain)
    // Keep optional-valued branches out until the public choose contract explicitly supports them.
    if (c && yes?.literal && no?.literal)
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
    if (c && yes && no && (yes.literal || yes.required) && (no.literal || no.required))
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
  }
}
function condition(c, domain = 'damage') {
  if (fields(c, ['type'])) {
    if (c.type === 'selfUseSkill') return 'conditions.selfUsesSkill'
    // This emitter accepts only the two DamageContext stages, where checkSelf is target ownership.
    if (c.type === 'checkSelf') return domain === 'skill' ? 'conditions.ownerUsesSkill' : 'conditions.selfBeDamaged'
    if (c.type === 'selfBeDamaged' && domain === 'damage') return 'conditions.selfBeDamaged'
  }
  if (
    fields(c, ['type', 'conditions']) &&
    ['every', 'some'].includes(c.type) &&
    Array.isArray(c.conditions) &&
    c.conditions.length
  ) {
    const items = c.conditions.map(item => condition(item, domain))
    if (items.every(Boolean)) return `conditions.${c.type === 'every' ? 'all' : 'any'}(${items.join(',')})`
  }
  if (fields(c, ['type', 'condition']) && c.type === 'not') {
    const inner = condition(c.condition, domain)
    if (inner) return `conditions.not(${inner})`
  }
  if (fields(c, ['type', 'baseId']) && typeof c.baseId === 'string') {
    if (c.type === 'selfHasMark')
      return `targets.ownerMarks.where(mark => mark.baseId === ${q(c.baseId)}).condition(checks.exists())`
    if (c.type === 'opponentHasMark')
      return `targets.opponentActive.condition((_ctx,pets) => pets.some(pet => pet.marks.some(mark => mark.baseId === ${q(c.baseId)})))`
  }
  if (domain === 'skill' && fields(c, ['type', 'target', 'evaluator']) && c.type === 'evaluate') {
    const t = c.target,
      e = c.evaluator
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
    const ms = members(c.target)
    if (ms) return `${ms}.condition(checks.exists())`
  }
  if (
    fields(e, ['type', 'operator', 'value']) &&
    e.type === 'compare' &&
    ['<', '>', '<=', '>=', '=='].includes(e.operator)
  ) {
    // Legacy compare checks every member with some(); only single-entity roots may use first().
    if (!['self', 'opponent', 'mark'].includes(c.target?.base)) return
    const left = selectedNumber(c.target),
      right = number(e.value, undefined, undefined, domain)
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

export { fields, normalize, number, condition }
