import { resolve } from 'path'

import * as TJS from 'typescript-json-schema'

import { quicktype, JSONSchemaInput, FetchingJSONSchemaStore, InputData } from 'quicktype-core'
import * as fs from 'fs'

function GenerateSchemaFromTSType(path: string, type: string) {
  const program = TJS.getProgramFromFiles([resolve(path)], {})
  const generator = TJS.buildGenerator(program)
  const schema = generator!.getSchemaForSymbol(type)
  return schema
}

async function GenerateCSharpCodeFromSchema(type: string, schema: any) {
  const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore())
  await schemaInput.addSource({ name: type, schema: JSON.stringify(schema) })
  const inputData = new InputData()
  inputData.addInput(schemaInput)

  const csharp = quicktype({
    inputData,
    lang: 'csharp',
  })
  return await csharp
}

async function GenerateCSharpCodeFromTSType(path: string, type: string) {
  let schema = GenerateSchemaFromTSType(path, type)
  schema = CheckAndFixBrandSchema(schema)
  return await GenerateCSharpCodeFromSchema(type, schema)
}

function FixBrandSchema(schema: any) {
  if (schema.allOf) {
    const brand = schema.allOf.find((x: any) => x.properties?.__brand)
    if (brand) {
      schema.type = 'string'
      delete schema.allOf
    }
  }
  return schema
}

function CheckAndFixBrandSchema(schema: any) {
  if (schema.definitions) {
    Object.entries(schema.definitions).forEach(v => (schema.definitions[v[0]] = FixBrandSchema(v[1])))
  }
  return FixBrandSchema(schema)
}

const generateList = [
  ['packages/const/index.ts', 'BattleMessage', 'packages/csbind/message.cs'],
  ['packages/const/index.ts', 'PlayerSelection', 'packages/csbind/selection.cs'],
]

async function main() {
  generateList.forEach(async ([path, type, output]) => {
    const code = await GenerateCSharpCodeFromTSType(path, type)
    console.log(code.lines.join('\n'))
    fs.writeFileSync(output, code.lines.join('\n'))
  })
}

await main()
