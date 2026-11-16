import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

const str = { type: 'string' } as const
const text = { ...str, required: true } as const
const bool = { type: 'boolean' } as const
const strings = { type: 'array', items: str } as const
const object = { type: 'object', additionalProperties: true } as const
const objects = { type: 'array', items: object } as const

export function proposalParameters(port: number) {
  // Keep fields optional at the top level for the legacy proposal string.
  return {
    summary: { ...str, description: '中文改造摘要；使用结构化参数时必填' },
    issues: { ...objects, items: { ...object, properties: {
      id: text, evidence: text, impact: text, recommendation: text,
    } } },
    unresolved: strings,
    changes: { ...objects, items: { ...object, properties: {
      id: text, path: text, reason: text, group: str,
      content: { ...str, description: '完整文件内容；已通过 opc_delivery_propose_file 暂存的文件省略该字段' },
      executable: bool,
    } } },
    contract: { ...object, description: '提交完整契约；修正其他字段时也保留已确定的运行配置', properties: {
      schema_version: { type: 'integer', required: true, description: '当前交付契约版本为 1' },
      slug: str, name: text, description: text, base_url: str,
      runtime: { ...object, required: true, properties: {
        language: text, version: text,
        port: { type: 'integer', required: true, description: `必须是向导已锁定的数字 ${port}，不是字符串或宿主机端口` },
      } },
      build_context: { ...strings, required: true },
      health: { ...object, required: true, properties: { path: text, status: { type: 'integer', required: true }, json_contains: { ...object, required: true } } },
      configs: { ...objects, items: { ...object, properties: {
        key: text, default: text, secret: { ...bool, required: true }, required: { ...bool, required: true }, description: str,
        source: { ...object, description: '使用 path 和 keys 引用源配置，禁止写入真实秘密值' },
      } } },
      resources: objects,
      storage_mounts: objects,
      auth_profile: { ...object, description: '保留原认证；凭据只写运行时环境变量名', properties: {
        page_auth_required: bool, api_auth_required: bool, username_env: str, password_env: str,
        token_env: str, login_url: str, login_method: str, token_json_path: str,
      } },
      auth_profiles: { ...object, description: '按 ID 保存登录方式，接口通过 auth.profile 引用' },
      auth_rules: { ...objects, description: '每条规则须二选一填写 path 或 prefix；精确规则优先', items: { ...object, properties: {
        target: { ...text, enum: ['api', 'page'] }, path: str, prefix: str, method: str,
        auth: { ...object, required: true, properties: { type: { ...text, enum: ['none', 'header', 'bearer'] } } },
        evidence: { ...strings, required: true, description: '读取工具返回的源码位置数组，例如 ["server.mjs:42"]' },
      } } },
      auth_blockers: { ...objects, description: '只填确实阻塞改造的外部授权或角色决定；普通验证凭据在部署后填写', items: { ...object, properties: {
        question: text, evidence: { ...strings, required: true }, affected: { ...strings, required: true }, action: text,
        reason: { ...text, enum: ['external_authorization', 'missing_credential', 'role_change'] },
      } } },
      apis: { ...objects, description: '扫描结果由插件合并，可以传 [] 或只补充需要定制的接口', items: { ...object, properties: {
        id: text, method: text, path: text, purpose: text,
        evidence: { ...strings, required: true }, parameters: { ...objects, required: true },
        request_body: { oneOf: [{ type: 'null' }, object], required: true },
        responses: { ...object, required: true }, auth: { ...object, required: true },
        effect: { ...text, enum: ['read', 'write', 'destructive', 'external'] },
        confirmation_required: { ...bool, required: true },
      } } },
      pages: { ...objects, description: '扫描结果由插件合并，可以传 [] 或只补充需要定制的页面' },
      verification: object,
      unresolved: strings,
    } },
    decisions: { ...objects, items: { ...object, properties: {
      id: text, question: text, impact: text, options: { ...strings, required: true },
    } } },
    four_step_report: object,
    proposal: { ...str, description: '旧版完整提案 JSON 字符串，仅在没有结构化参数时使用' },
  } satisfies ParameterSchemaSpec
}
