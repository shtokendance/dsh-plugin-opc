import { readdir, readFile, mkdir, lstat, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const root = resolve(process.argv[2] ?? '../deepseek-harness')
await mkdir('node_modules/@deepseek-ai', { recursive: true })
const dirs = (await readdir(join(root, 'vendor'))).map(name => join(root, 'vendor', name))
for (const group of await readdir(join(root, 'packages'))) {
  const folder = join(root, 'packages', group)
  if (!(await lstat(folder)).isDirectory()) continue
  for (const name of await readdir(folder)) dirs.push(join(folder, name))
}
for (const dir of dirs) {
  let manifest
  try { manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) } catch { continue }
  if (!manifest.name?.startsWith('@deepseek-ai/')) continue
  const target = resolve('node_modules', manifest.name)
  try { await lstat(target) } catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(dir, target, 'dir') }
}
