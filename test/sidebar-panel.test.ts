import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('client index registers left sidebar panellist and main panel for OPC workbench', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /sidebar\.panellist/)
  assert.match(source, /opc-workbench/)
  assert.match(source, /slots\.inject\('main'/)
})
