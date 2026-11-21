import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

const str = { type: 'string' } as const
const text = { ...str, required: true } as const
const bool = { type: 'boolean' } as const
const strings = { type: 'array', items: str } as const
const object = { type: 'object', additionalProperties: true } as const
const objects = { type: 'array', items: object } as const
const routeAuth = { ...object, properties: {
  evidence: { ...strings, description: '该路由的认证源码位置，使用源码读取工具返回的文件路径和行号' },
} } as const

export function deliveryDataStrategies(updating: boolean): string[] {
  return updating ? ['reuse', 'postgres_copy'] : ['initialize']
}

export function proposalParameters(port: number, portLocked: boolean, updating: boolean) {
  // Keep fields optional at the top level for the legacy proposal string.
  return {
    summary: { ...str, description: '中文改造摘要；使用结构化参数时必填' },
    skill_markdown: { ...str, description: '按当前改造技能要求生成可用的应用 SKILL.md，含 YAML 名称与说明，记录真实业务操作与调用方式，通过配置键引用部署值' },
    issues: { ...objects, items: { ...object, properties: {
      id: text, evidence: text, impact: text, recommendation: text,
    } } },
    unresolved: { ...strings, description: '仅填写必须由用户处理的部署阻塞。鉴权阻塞项与 contract.auth_blockers 的 question 保持一致。' },
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
        port: {
          type: 'integer',
          required: true,
          description: portLocked
            ? `必须是向导已锁定的数字 ${port}，不是字符串或宿主机端口`
            : `优先填写应用自身默认监听端口（整数 1-65535）；若应用无默认端口，填写 OPC 默认端口 ${port}`,
        },
      } },
      build_context: { ...strings, required: true },
      data_plan: { ...object, required: true, properties: {
        strategy: { ...text, enum: deliveryDataStrategies(updating) },
        summary: text, recovery: text,
        ...(updating ? {
          source_resource_id: str, target_resource_id: str, rehearsal_resource_id: str,
          migration_files: strings,
        } : {}),
      } },
      health: { ...object, description: '可选。仅用于标识源码已有的健康入口，业务验证不得使用该入口。没有则省略。', properties: { path: text, status: { type: 'integer' }, json_contains: object } },
      configs: { ...objects, description: '填写应用实际使用的配置键。默认值必须能从源码确认，不能使用示例占位符。用户给定的实际值写 value。由平台注入时写资源 ID 和资源字段名。', items: { ...object, properties: {
        key: text, default: text, value: { ...str, description: '本次部署已确定的实际值，包括用户给出的口令或连接串。未确定时省略。' }, secret: { ...bool, required: true }, required: { ...bool, required: true }, description: str,
        app_default: { ...str, description: '填写源码中的兜底默认值（只读展示参考，不会自动注入）' },
        source: { ...object, description: '使用 path 和 keys 定位源配置' },
        resource_id: str,
        resource_key: str,
        preserve_on_upgrade: { ...bool, description: '该值用于读取历史数据时设为 true，例如字段加密密钥或查询盐。' },
        value_plan: { ...object, description: '每个必填项声明取值方式。generate 由系统按规格生成；input 由用户在部署会话或配置表单填写。', properties: {
          kind: { ...text, enum: ['default', 'source', 'resource', 'input', 'generate', ...(updating ? ['inherit'] : [])] },
          bytes: { type: 'integer', description: 'generate 时必填，随机字节数（16–128）' },
          encoding: { ...str, enum: ['base64', 'base64url', 'hex'] },
        } },
      } } },
      resources: objects,
      storage_mounts: { ...objects, required: true, description: '完整挂载清单，没有挂载时为 []。' },
      credential_sources: { ...object, description: '用于业务技能的已有凭据源码引用。键是登录凭据的引用名，值为 {path,keys} 或 {path,line,name}。不创建部署环境变量，不填写实际账密。' },
      auth_profile: { ...object, description: '保留原认证；凭据只写运行时环境变量名', properties: {
        page_auth_required: bool, api_auth_required: bool, username_env: str, password_env: str,
        token_env: str, login_url: str, login_method: str, token_json_path: str,
      } },
      auth_profiles: { ...object, description: '按 ID 保存登录方式。例：{"account":{"login_url":"/api/session","login_method":"POST","username_env":"APP_USER","password_env":"APP_PASSWORD"}}。profile ID 只出现一层，接口通过 auth.profile 引用。非标准登录字段用 login_body_template，仅允许账号和密码占位符。' },
      auth_rules: { ...objects, description: '共用鉴权写一条 prefix 规则；公开登录等例外用 path 和 method。登录方式写在受保护规则的 auth.profile，不能只写在公开登录接口上。evidence 在规则顶层。', items: { ...object, properties: {
        target: { ...text, enum: ['api', 'page'] }, path: str, prefix: str, method: str,
        auth: { ...object, required: true, properties: { type: { ...text, enum: ['none', 'header', 'bearer'] }, profile: str, header: str, env: str } },
        evidence: { ...strings, required: true, description: '读取工具返回的源码位置数组，例如 ["server.mjs:42"]' },
      } } },
      auth_blockers: { ...objects, description: '只填确实阻塞改造的外部授权或角色决定。', items: { ...object, properties: {
        question: text, evidence: { ...strings, required: true }, affected: { ...strings, required: true }, action: text,
        reason: { ...text, enum: ['external_authorization', 'missing_credential', 'role_change'] },
      } } },
      apis: { ...objects, required: true, description: '填写技能可使用的真实接口，没有时为 []。', items: { ...object, properties: {
        id: text, method: text, path: text, purpose: text,
        evidence: { ...strings, required: true }, parameters: { ...objects, required: true },
        request_body: { oneOf: [{ type: 'null' }, object], required: true },
        responses: { ...object, required: true }, auth: { ...routeAuth, required: true },
        effect: { ...text, enum: ['read', 'write', 'destructive', 'external'] },
        confirmation_required: { ...bool, required: true, description: 'effect 为 write、destructive 或 external 时必须为 true' },
      } } },
      pages: { ...objects, required: true, description: '填写技能可使用的真实页面，没有时为 []。',
        items: { ...object, properties: { auth: routeAuth } } },
      verification: { ...object, description: '说明 AI 部署验收的业务目标和可取得的证据。' },
      unresolved: { ...strings, description: '仅保留阻塞部署且需用户决定的问题。可选集成配置、改密建议、部署后才能确认的事项放在摘要。' },
    } },
    decisions: { ...objects, items: { ...object, properties: {
      id: text, question: text, impact: text, options: { ...strings, required: true },
    } } },
    proposal: { ...str, description: '旧版完整提案 JSON 字符串，仅在没有结构化参数时使用' },
  } satisfies ParameterSchemaSpec
}
