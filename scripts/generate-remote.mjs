import ts from 'typescript'
import { readFile, writeFile } from 'node:fs/promises'
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const pkgName = pkg.name
const source = ts.createSourceFile('remote-service.ts', await readFile('src/host/remote-service.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const service = source.statements.find(node => ts.isClassDeclaration(node))
const codec = type => type === 'string' ? 'z.string()' : type === 'boolean' ? 'z.boolean()' : type === 'string | null' ? 'z.string().nullable()' : type === 'void' ? 'z.void()' : (() => { throw new Error(`Unsupported RPC type ${type}`) })()
const methods = []
for (const member of service.members) {
  if (!ts.isMethodDeclaration(member) || !ts.getDecorators(member)?.some(d => d.expression.getText(source).startsWith('Remote'))) continue
  const name = member.name.getText(source), result = member.type.getText(source)
  const stream = result.startsWith('AsyncIterable<')
  const parameters = member.parameters.filter(p => p.type.getText(source) !== 'AbortSignal').map(p => ({ name: p.name.getText(source), type: p.type.getText(source) }))
  const output = result.slice(result.indexOf('<') + 1, -1)
  methods.push(`{ id: '${pkgName}#opc/${name}', service: 'opc', namespace: 'opc', method: '${name}', invocation: {kind:'direct'}, ${stream ? "mode:'stream', cancellation:{parameter:'signal'}," : ''} parameters: [${parameters.map(p => `{name:'${p.name}',wire:'${p.name}',source:'json',codec:{mode:'strict',typeSymbol:'opc/${name}:${p.name}',create:()=>${codec(p.type)}}}`).join(',')}],result:{mode:'strict',typeSymbol:'opc/${name}:result',create:()=>${codec(output)}} }`)
}
await writeFile('src/remote-contract.ts', `// Generated from decorated Host signatures by scripts/generate-remote.mjs.\nimport {z} from 'zod'\nimport type {TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol'\nexport const contribution: TypertRemoteContribution = { package:'${pkgName}', descriptors:[${methods.join(',\n')}] }\nexport const TYPERT = { package: contribution.package, face:'host' as const, schemas:[], invocations:contribution.descriptors, model:{services:[],events:[],objects:[]} }\n`)
