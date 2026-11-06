import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', tsconfig: 'tsconfig.json' })
const result = await build({ entryPoints: ['src/client/index.tsx'], bundle: true, write: false, platform: 'browser', loader: { '.png': 'dataurl' }, target: 'es2022', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'], tsconfig: 'tsconfig.json' })
const code = result.outputFiles[0].text
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:'@opc/dsh-plugin-opc',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`)

await import('./verify-build.mjs')
