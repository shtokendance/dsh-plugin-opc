import ts from 'typescript'
import { readFile } from 'node:fs/promises'
const original = ts.createSourceFile('source.ts', await readFile('src/host/remote-service.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const built = ts.createSourceFile('built.js', await readFile('lib/index.js', 'utf8'), ts.ScriptTarget.Latest, true)
const service = original.statements.find(ts.isClassDeclaration)
let runtime
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(built) === 'OpcRemoteService' && node.initializer && ts.isClassExpression(node.initializer)) runtime = node.initializer
  ts.forEachChild(node, visit)
}
visit(built)
if (!runtime) throw new Error('Built OPC Remote service not found')
for (const method of service.members) {
  if (!ts.isMethodDeclaration(method) || !ts.getDecorators(method)?.some(d => d.expression.getText(original).startsWith('Remote'))) continue
  const name = method.name.getText(original)
  const emitted = runtime.members.find(m => ts.isMethodDeclaration(m) && m.name.getText(built) === name)
  const expected = method.parameters.map(p => p.name.getText(original))
  const actual = emitted?.parameters.map(p => p.name.getText(built))
  // DSH's runtime reflection reads parameter names; minification or shadow-name
  // rewrites would silently diverge from the generated browser wire contract.
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`RPC parameter names changed in build: ${name}`)
}
