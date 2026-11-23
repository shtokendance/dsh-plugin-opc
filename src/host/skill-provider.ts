import { dirname } from 'node:path'
import type { SkillProvider, SkillProviderControl, SkillCandidate, SkillDefinition, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { OpcCore } from './core.ts'
import { identityHash } from './context.ts'

/** Installed enterprise skills enter both native slash commands and model skill loading. */
export class EnterpriseSkillProvider implements SkillProvider {
  readonly name = 'opc-enterprise'
  constructor(private readonly core: OpcCore, private readonly control: SkillProviderControl) {
    const invalidate = () => control.invalidate()
    core.on('skills-changed', invalidate)
    control.signal.addEventListener('abort', () => core.off('skills-changed', invalidate), { once: true })
  }
  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    if (!this.core.auth.contexts.current) return []
    const captured = this.core.auth.contexts.capture()
    await this.core.authz.session(); captured.assertCurrent()
    const spaceNames = new Map((captured.context.spacesDetail ?? []).map(item => [item.id, item.name]))
    const result: SkillCandidate[] = []
    const usedNames = new Set<string>()
    for (const record of await this.core.installer.listAll(captured.context)) {
      options.signal?.throwIfAborted(); captured.assertCurrent()
      if (!record.enabled) continue
      const path = this.core.installer.skillPath(captured.context, record)
      const skill = await this.core.installer.parseSkill(path)
      const spaceName = spaceNames.get(record.tenant_id) ?? record.tenant_id
      const spaceTag = captured.context.spaces.length > 1 ? ` · ${spaceName}` : ''
      const versionTag = record.version ? ` · ${record.version}` : ''
      const suffix = record.tenant_id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'space'
      const candidateName = usedNames.has(skill.name) ? `${skill.name}-${suffix}` : skill.name
      usedNames.add(candidateName)
      result.push({ name: candidateName, description: `[OPC${spaceTag}${versionTag}] ${skill.description}`, path,
        invocation: { modelInvocable: true, userInvocable: true }, source: 'opc-enterprise', provider: this.name, rank: 350,
        resourceBase: { kind: 'directory', path: dirname(path) },
        locator: { tenant: record.tenant_id, catalog: record.catalog_id, sha256: record.active_sha256, identity: identityHash(captured.context), epoch: captured.epoch },
      })
    }
    captured.assertCurrent()
    return result
  }
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (!this.core.auth.contexts.current) return undefined
    const captured = this.core.auth.contexts.capture()
    const locator = candidate.locator as { tenant: string; catalog: string; sha256: string; identity: string; epoch: number }
    if (locator.epoch !== captured.epoch || !captured.context.spaces.includes(locator.tenant) || locator.identity !== identityHash(captured.context)) return undefined
    await this.core.authz.catalog(locator.tenant, locator.catalog); captured.assertCurrent()
    const active = (await this.core.installer.list(captured.context, locator.tenant)).find(record => record.catalog_id === locator.catalog && record.enabled && record.active_sha256 === locator.sha256)
    if (!active) { this.control.invalidate(); return undefined }
    options.signal?.throwIfAborted()
    const skill = await this.core.installer.parseSkill(this.core.installer.skillPath(captured.context, active))
    captured.assertCurrent()
    return { ...candidate, content: skill.content }
  }
}
