import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { apps as zhApps } from '../src/client/locales/zh/apps.ts'
import { apps as enApps } from '../src/client/locales/en/apps.ts'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()

test('delivery skills reference China mirror rules and preserve private registries', async () => {
  const [skill, update, deliveryFiles] = await Promise.all([
    readFile(join(ROOT, 'runtime/app_delivery/SKILL.md'), 'utf8'),
    readFile(join(ROOT, 'runtime/app_delivery/UPDATE.md'), 'utf8'),
    readFile(join(ROOT, 'runtime/app_delivery/references/delivery-files.md'), 'utf8'),
  ])

  assert.match(skill, /references\/delivery-files\.md#构建镜像源/)
  assert.match(update, /references\/delivery-files\.md#构建镜像源/)
  assert.match(deliveryFiles, /^## 构建镜像源$/m)
  assert.match(deliveryFiles, /https:\/\/mirrors\.aliyun\.com\/pypi\/simple\//)
  assert.match(deliveryFiles, /https:\/\/registry\.npmmirror\.com/)
  assert.match(deliveryFiles, /https:\/\/goproxy\.cn,direct/)
  assert.match(deliveryFiles, /mirrors\.aliyun\.com/)
  assert.match(deliveryFiles, /https:\/\/maven\.aliyun\.com\/repository\/public/)
  assert.match(deliveryFiles, /私有|内网/)
})

test('fallback Dockerfile template configures China mirrors for Go, Python, and Node', async () => {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'runtime'))})`,
    'from app_delivery_migration import _fallback_template',
    'print(json.dumps({',
    '  "go": _fallback_template("go", "1.22")["template_content"],',
    '  "py": _fallback_template("python", "3.11")["template_content"],',
    '  "node": _fallback_template("node", "20")["template_content"],',
    '}))',
  ].join('\n')
  const { stdout } = await execFileAsync('python3', ['-c', script])
  const templates = JSON.parse(stdout) as { go: string; py: string; node: string }

  assert.match(templates.go, /GOPROXY=https:\/\/goproxy\.cn,direct/)
  assert.match(templates.py, /PIP_INDEX_URL=https:\/\/mirrors\.aliyun\.com\/pypi\/simple\//)
  assert.match(templates.node, /https:\/\/registry\.npmmirror\.com/)
})

test('app list URL label includes colon and copyUrl locale key exists', () => {
  assert.equal(zhApps['apps.url'], '内网地址：')
  assert.equal(enApps['apps.url'], 'URL:')
  assert.ok(zhApps['apps.copyUrl'].length > 0)
  assert.ok(enApps['apps.copyUrl'].length > 0)
})
