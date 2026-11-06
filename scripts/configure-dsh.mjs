import ts from 'typescript'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(process.argv[2] ?? '../deepseek-harness')
const base = ts.parseConfigFileTextToJson('tsconfig.base.json', await readFile(`${root}/tsconfig.base.json`, 'utf8')).config
const paths = Object.fromEntries(Object.entries(base.compilerOptions.paths).map(([name, targets]) => [name, targets.map(path => {
  const declaration = path.replace(/\/src(?=\/|$)/, '/lib/types').replace(/(?<!\.d)\.tsx?$/, '.d.ts')
  return resolve(root, existsSync(resolve(root, declaration)) ? declaration : path)
})]))
await writeFile('tsconfig.dsh.json', JSON.stringify({ extends: './tsconfig.json', compilerOptions: { target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', paths }, include: ['src/**/*.ts'], exclude: ['src/client/**'] }, null, 2) + '\n')

const client = { extends: './tsconfig.json', compilerOptions: { target: 'ES2024', module:'ESNext', moduleResolution:'Bundler', jsx:'react-jsx', paths }, include:['src/client/**/*.ts','src/client/**/*.tsx','src/remote-contract.ts'], exclude:[] }
await writeFile('tsconfig.client.json', JSON.stringify(client, null, 2)+'\n')
