import { readFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { domainFields, evaluationReads, projectedMethods, parameterMethods } from '../battle/src/sandbox/projection.ts'

const packages = fileURLToPath(new URL('../', import.meta.url))
const sourcePrefix = packages.replaceAll('\\', '/')
const enginePrefix = sourcePrefix + 'battle/src/engine/'
const entry = resolve(packages, 'content-dev/src/index.ts')
const template = resolve(packages, 'content-dev/template/src/effects/slow.effect.ts')

// Both the standalone Pages install and pnpm use the public source entry points.
// Resolve third-party types from the build's install when running outside the workspace.
export function generateSdkReference(ts, dependencyAnchor) {
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    paths: {
      '@arcadia-eternity/battle/*': [resolve(packages, 'battle/*')],
      '@arcadia-eternity/const': [resolve(packages, 'const/index.ts')],
      '@arcadia-eternity/interface': [resolve(packages, 'interface/index.ts')],
    },
  }
  const host = ts.createCompilerHost(options)
  const cache = ts.createModuleResolutionCache(dirname(entry), s => s, options)
  host.resolveModuleNames = (names, containing) =>
    names.map(name => {
      const lookup = from => ts.resolveModuleName(name, from, options, host, cache).resolvedModule
      return lookup(containing) ?? (name.startsWith('.') ? undefined : lookup(dependencyAnchor))
    })
  const program = ts.createProgram([entry], options, host)
  const checker = program.getTypeChecker()
  const entryFile = program.getSourceFile(entry)
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(entryFile))
  const dereference = sym => (sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym)
  const publicSymbols = new Map(exports.map(sym => [sym.name, dereference(sym)]))
  const typeOf = sym => checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration ?? sym.declarations[0])
  const declared = name => checker.getDeclaredTypeOfSymbol(publicSymbols.get(name))
  const injected = declared('EffectSdk')
  const events = declared('EventMap')
  const format = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
  const print = type => checker.typeToString(type, entryFile, format)
  const signatures = (type, construct = false) =>
    (construct ? type.getConstructSignatures() : type.getCallSignatures())
      .map(sig =>
        checker.signatureToString(
          sig,
          entryFile,
          format,
          construct ? ts.SignatureKind.Construct : ts.SignatureKind.Call,
        ),
      )
      .join('\n')
  const records = new Map()
  const owners = new Map()
  function location(node) {
    const file = node.getSourceFile()
    return {
      path: 'packages/' + relative(packages, file.fileName).split('\\').join('/'),
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    }
  }
  function record(symbol, group, kind, signature, sym, owner) {
    if (records.has(symbol)) throw Error('Duplicate SDK symbol: ' + symbol)
    const description = ts.displayPartsToString(sym.getDocumentationComment(checker))
    const declaration = sym.valueDeclaration ?? sym.declarations?.[0]
    const source = declaration && location(declaration)
    const item = {
      symbol,
      group,
      kind,
      signature,
      description,
      source: source ?? records.get(owner)?.source,
      ...(owner && { owner }),
    }
    records.set(symbol, item)
    return item
  }
  function projection(type) {
    const name = type.getSymbol()?.name
    if (!(type.flags & ts.TypeFlags.Object)) return
    if (name === 'MarkInstance') return 'MarkInstanceImpl'
    if (Object.hasOwn(projectedMethods, name)) return name
    for (const base of type.getBaseTypes?.() ?? []) {
      const rule = projection(base)
      if (rule) return rule
    }
  }
  for (const [name, sym] of publicSymbols) {
    const node = sym.valueDeclaration ?? sym.declarations?.[0]
    if (!node) throw Error('Missing declaration for ' + name)
    const generics = node.typeParameters ? '<' + node.typeParameters.map(t => t.getText()).join(', ') + '>' : ''
    const isType = !(sym.flags & ts.SymbolFlags.Value)
    const type = isType || ts.isClassDeclaration(node) ? checker.getDeclaredTypeOfSymbol(sym) : typeOf(sym)
    const injectedMember = injected.getProperty(name)
    const klass = ts.isClassDeclaration(node)
    const shape = type.flags & ts.TypeFlags.IndexedAccess ? checker.getApparentType(type) : type
    const rule = name === 'NativeEffectContext' ? 'Context' : projection(shape)
    const decoratorModule = node.getSourceFile().fileName.endsWith('/effect-loading.ts')
    let group, kind, signature
    if (klass) {
      const construct =
        injectedMember &&
        typeOf(injectedMember)
          .getConstructSignatures()
          .filter(sig => !(sig.flags & ts.SignatureFlags.Abstract))
      group = rule ? 'objects' : 'values'
      kind = construct?.length ? '可构造类' : '实例类型'
      signature = construct?.length ? signatures(typeOf(sym), true) : 'class ' + name
    } else if (isType) {
      group = rule ? 'objects' : 'types'
      kind = rule ? '实例类型' : '类型'
      signature = ts.isTypeAliasDeclaration(node)
        ? 'type ' + name + generics + ' = ' + node.type.getText()
        : 'interface ' + name + generics
    } else if (type.getCallSignatures().length) {
      group = injectedMember || decoratorModule ? 'functions' : 'host'
      kind = group === 'host' ? '宿主函数' : '函数'
      signature = signatures(type)
    } else {
      group = ts.isEnumDeclaration(node) ? 'enums' : 'values'
      kind = group === 'enums' ? '枚举' : '值'
      signature = ts.isEnumDeclaration(node) ? 'enum ' + name : (node.type?.getText() ?? print(type))
    }
    const item = record(name, group, kind, signature, sym)
    owners.set(name, { item, type: shape, node, rule, klass })
  }
  for (const [name, { item, type, node, rule, klass }] of owners) {
    // Primitive/array library members and dependency internals have their own reference.
    if (
      item.group === 'functions' ||
      item.group === 'host' ||
      !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection | ts.TypeFlags.Union))
    )
      continue
    for (const prop of type.getProperties()) {
      const p = prop.valueDeclaration ?? prop.declarations?.[0] ?? node
      if (!p.getSourceFile().fileName.startsWith(sourcePrefix) || p.getSourceFile().fileName.includes('/node_modules/'))
        continue
      if (
        !/^[A-Za-z$][\w$]*$/.test(prop.name) ||
        ts.getCombinedModifierFlags(p) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
      )
        continue
      const member = checker.getTypeOfPropertyOfType(type, prop.name)
      if (!member) continue
      const call = signatures(member)
      if (rule && !(call ? projectedMethods[rule] : domainFields).includes(prop.name)) continue
      if (
        klass &&
        !rule &&
        ts.isMethodDeclaration(p) &&
        !(name === 'ParameterCatalog' && parameterMethods.includes(prop.name))
      )
        continue
      if (klass && !rule && (ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))) continue
      // A namespace may also export types, which have no runtime value.
      const kind = ts.isEnumMember(p) ? '枚举值' : call ? '方法' : '字段'
      const childId = name + '.' + prop.name
      // For a mapped SDK property the standalone export already owns the full signature.
      const root = owners.get(prop.name)
      const signature = name === 'EffectSdk' && root?.type === member ? 'typeof ' + prop.name : call || print(member)
      record(childId, item.group, kind, signature, prop, name)
      if (p.type && ts.isTypeLiteralNode(p.type)) {
        for (const field of member.getProperties()) {
          if (!/^[a-zA-Z$][\w$]*$/.test(field.name)) continue
          const nested = checker.getTypeOfPropertyOfType(member, field.name)
          const nestedCall = signatures(nested)
          record(
            childId + '.' + field.name,
            item.group,
            nestedCall ? '方法' : '字段',
            nestedCall || print(nested),
            field,
            name,
          )
        }
      }
    }
  }

  const source = readFileSync(template, 'utf8')
  function exampleRegion(region) {
    const start = '// #region ' + region + '\n'
    const tail = source.split(start)[1]
    if (!tail?.includes('// #endregion')) throw Error('Missing frost-strike example: ' + region)
    return tail.split('// #endregion')[0].trim()
  }
  const special = {
    OnHit: exampleRegion('apply-slow'),
    OnMarkCreated: exampleRegion('speed-penalty'),
  }
  const dispatches = new Map()
  function findDispatch(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'applyEffects'
    ) {
      const trigger = node.arguments[1]
      if (
        trigger &&
        ts.isPropertyAccessExpression(trigger) &&
        checker.getSymbolAtLocation(trigger.name)?.parent === publicSymbols.get('EffectTrigger')
      ) {
        const sites = dispatches.get(trigger.name.text) ?? []
        sites.push(location(node))
        dispatches.set(trigger.name.text, sites)
      }
    }
    ts.forEachChild(node, findDispatch)
  }
  for (const file of program.getSourceFiles()) if (file.fileName.startsWith(enginePrefix)) findDispatch(file)

  // EventMap is keyed by NativeEffectTrigger, which is derived from the dispatch tuple.
  for (const event of events.getProperties()) {
    const name = event.name
    const symbol = 'EffectTrigger.' + name
    const item = records.get(symbol)
    const parent = checker.getTypeOfPropertyOfType(events, name)
    if (!item || !parent) throw Error('Missing native trigger: ' + symbol)
    const parentName = print(parent)
    if (!records.has(parentName)) throw Error('Missing parent type for ' + symbol + ': ' + parentName)
    item.kind = '触发器'
    item.group = 'triggers'
    item.context = 'NativeEffectContext<' + symbol + '>'
    item.parent = parentName
    item.dispatches = dispatches.get(name)
    if (!item.dispatches?.length) throw Error('Missing dispatch site: ' + symbol)
    const evaluatingDamage = ['OnBeforeCalculateDamage', 'OnDamageReplacement', 'Shield'].includes(name)
    const methods = []
    function methodsOf(receiver, target) {
      const owner = target.getSymbol()?.name
      for (const key of target.getProperties()) {
        const id = owner + '.' + key.name
        if (!owners.get(owner)?.rule || records.get(id)?.kind !== '方法') continue
        if (id === 'DamageContext.addModified') {
          if (name !== 'OnBeforeCalculateDamage' || receiver !== 'ctx.parent') continue
        } else if (evaluatingDamage && !evaluationReads.includes(key.name)) continue
        methods.push({ receiver, symbol: id })
      }
    }
    methodsOf('ctx.parent', parent)
    const fields = []
    for (const field of parent.getProperties()) {
      if (!domainFields.includes(field.name)) continue
      const id = parentName + '.' + field.name
      if (!records.has(id)) continue
      fields.push(id)
      const t = checker.getNonNullableType(checker.getTypeOfPropertyOfType(parent, field.name))
      methodsOf('ctx.parent.' + field.name, t)
    }
    if (parent.isUnion()) item.variants = parent.types.map(t => t.getSymbol()?.name).filter(n => owners.has(n))
    item.fields = fields
    item.methods = methods
    const eventRead = {
      Battle: 'currentTurn',
      TurnContext: 'battle.currentTurn',
      UseSkillContext: 'actualTarget?.id',
      DamageContext: 'target.currentHp',
      DefeatContext: 'killer?.id',
      HealContext: 'healResult',
      RageContext: 'target.currentRage',
      AddMarkContext: 'baseMark.id',
      RemoveMarkContext: 'mark.id',
      StackContext: 'stacksAfter',
      ConsumeStackContext: 'actualAmount',
      SwitchPetContext: 'switchInPet.id',
      TransformContext: 'target.id',
      AllContext: 'type',
    }
    const read = eventRead[parentName]
    if (read && !fields.includes(parentName + '.' + read.split(/[?.]/)[0]))
      throw Error('Unavailable example field: ' + parentName + '.' + read)
    item.example =
      special[name] ??
      ['function readEvent(ctx: ' + item.context + ') {', '  return ctx.parent' + (read ? '.' + read : ''), '}'].join(
        '\n',
      )
    if (special[name]) item.exampleSource = 'src/effects/slow.effect.ts'
  }
  if (!events.getProperties().length) throw Error('No native effect triggers resolved')
  for (const item of records.values()) {
    const related = new Set()
    for (const word of item.signature.match(/[A-Za-z_$][\w$]*/g) ?? [])
      if (word !== item.symbol && owners.has(word)) related.add(word)
    item.related = [...related]
  }
  return [...records.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : 1))
}
