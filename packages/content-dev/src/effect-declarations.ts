import ts from 'typescript'
import { runtimeId } from '@arcadia-eternity/pack-loader/native'

export interface AuthorEffectDeclaration {
  id: string
  sourceKind: 'skill' | 'petMark'
  file: string
  line: number
}

export interface AuthorEffectCatalog {
  definitions: AuthorEffectDeclaration[]
  issues: { file: string; message: string }[]
}

// Parse saved author text without importing the module or running its decorators.
export function inspectEffectDeclarations(file: string, text: string, namespace: string): AuthorEffectCatalog {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const options = { noResolve: true, noLib: true, types: [], target: ts.ScriptTarget.Latest }
  const program = ts.createProgram([file], options, {
    ...ts.createCompilerHost(options),
    getSourceFile: path => (path === file ? source : undefined),
    fileExists: path => path === file,
    readFile: path => (path === file ? text : undefined),
  })
  const result: AuthorEffectCatalog = { definitions: [], issues: [] }
  const issue = (message: string) => result.issues.push({ file, message })
  const [syntax] = program.getSyntacticDiagnostics(source)
  if (syntax) {
    issue(ts.flattenDiagnosticMessageText(syntax.messageText, '\n'))
    return result
  }
  const decorators = new Map<string, string>()
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !['@arcadia-eternity/content-sdk', '@arcadia-eternity/battle/effect-loading'].includes(
        statement.moduleSpecifier.text,
      ) ||
      statement.importClause?.isTypeOnly
    )
      continue
    const imports = statement.importClause?.namedBindings
    if (!imports) continue
    if (ts.isNamespaceImport(imports)) {
      for (const name of ['effect', 'on']) decorators.set(imports.name.text + '.' + name, name)
    } else
      for (const binding of imports.elements) {
        if (!binding.isTypeOnly) decorators.set(binding.name.text, (binding.propertyName ?? binding.name).text)
      }
  }
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(source)
  const exports = module ? checker.getExportsOfModule(module) : []
  const classes = new Set(
    exports
      .filter(symbol => !symbol.declarations?.some(ts.isTypeOnlyImportOrExportDeclaration))
      .map(
        symbol => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).valueDeclaration,
      ),
  )
  function calls(node: ts.ClassDeclaration | ts.MethodDeclaration, name: string) {
    return (ts.getDecorators(node) ?? [])
      .map(decorator => decorator.expression)
      .filter(
        (expr): expr is ts.CallExpression =>
          ts.isCallExpression(expr) && decorators.get(expr.expression.getText(source)) === name,
      )
  }
  function literal(options: ts.Expression, field: string) {
    const property = checker.getTypeAtLocation(options).getProperty(field)
    const declaration = property?.valueDeclaration
    if (!declaration) return
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(declaration)
      const type = symbol && checker.getTypeOfSymbolAtLocation(symbol, declaration.name)
      return type?.isStringLiteral() ? type.value : undefined
    }
    const value = ts.isPropertyAssignment(declaration) ? declaration.initializer : declaration
    const type = checker.getTypeAtLocation(value)
    if (type.isStringLiteral()) return type.value
  }
  for (const node of classes) {
    if (!node || !ts.isClassDeclaration(node)) continue
    for (const decorator of calls(node, 'effect')) {
      const options = decorator.arguments[0]
      const id = options && literal(options, 'id')
      const kind = options && literal(options, 'sourceKind')
      if (!id || (kind !== 'skill' && kind !== 'petMark')) {
        issue('无法从声明中确定效果 ID 和适用对象。')
        continue
      }
      try {
        runtimeId(namespace, id)
      } catch {
        issue(`效果 ID 或项目命名空间无效：${id}`)
        continue
      }
      const methods = node.members
        .filter(ts.isMethodDeclaration)
        .filter(
          method =>
            method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
            !ts.isPrivateIdentifier(method.name),
        )
      if (!methods.some(method => method.name.getText(source) === 'create' || calls(method, 'on').length)) {
        issue(`${id} 缺少静态 @on 方法或 create 方法。`)
        continue
      }
      result.definitions.push({
        id,
        sourceKind: kind,
        file,
        line: source.getLineAndCharacterOfPosition(decorator.getStart(source)).line + 1,
      })
    }
  }
  if (!result.definitions.length && !result.issues.length) issue('未识别到导出的 @effect 声明。')
  return result
}
