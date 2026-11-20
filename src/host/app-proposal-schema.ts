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

export function proposalParameters(port: number, portLocked = true) {
  // Keep fields optional at the top level for the legacy proposal string.
  return {
    summary: { ...str, description: '中文改造摘要；使用结构化参数时必填' },
    issues: { ...objects, items: { ...object, properties: {
      id: text, evidence: text, impact: text, recommendation: text,
    } } },
    unresolved: { ...strings, description: '若涉及令牌/登录/账密/凭据/授权码等阻塞问题，必须在 contract.auth_blockers 中添加 question 完全一致的条目（管理员登录通过 admin_account 处理，不要写入 unresolved）' },
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
      health: { ...object, required: true, properties: { path: text, status: { type: 'integer', required: true }, json_contains: { ...object, required: true } } },
      configs: { ...objects, description: '仅填写源码真实存在的配置键（参考 inventory.source_configuration）；default 必须为空字符串 ""；source 仅支持 YAML/JSON/TOML/.env/properties 文件，不支持代码文件；不要将 *.example/*.sample/*.template 示例文件里的 PORT 或占位密钥作为真实运行值绑定；如应用存在代码兜底默认值（仅非敏感），可写入 app_default 供第 3 步参考展示', items: { ...object, properties: {
        key: text, default: text, secret: { ...bool, required: true }, required: { ...bool, required: true }, description: str,
        app_default: { ...str, description: '仅非敏感配置可填写源码中的兜底默认值（只读展示参考，不会自动注入）' },
        source: { ...object, description: '使用 path 和 keys 引用源配置，禁止写入真实秘密值' },
      } } },
      resources: objects,
      storage_mounts: objects,
      auth_profile: { ...object, description: '保留原认证；凭据只写运行时环境变量名', properties: {
        page_auth_required: bool, api_auth_required: bool, username_env: str, password_env: str,
        token_env: str, login_url: str, login_method: str, token_json_path: str,
      } },
      auth_profiles: { ...object, description: '按 ID 保存登录方式，接口通过 auth.profile 引用' },
      admin_account: { ...object, description: '按应用源码证据选择 existing 或 create。仅描述账号来源或写入位置，不提交实际账密。', properties: {
        mode: { ...text, enum: ['existing', 'create'] }, profile: text, evidence: strings,
        source: { ...object, description: '已有可复用明文的 {username,password} 引用：结构化配置 {path,keys}、源码常量 {path,line,name} 或 SQLite 明文字段 {path,table,column,where}。缺任何一项则省略 source。' },
        storage: { ...object, description: '首次建号仅在交付副本中写入应用真正读取的 SQLite 或 JSON/YAML 文件，具体结构见 references/contract.md。' },
      } },
      auth_rules: { ...objects, description: '每条规则须二选一填写 path 或 prefix；evidence 是规则顶层必填数组（与 auth 平级，不要放在 auth 内部）；同权限页面可用 target="page" 且 prefix="/" 统一覆盖', items: { ...object, properties: {
        target: { ...text, enum: ['api', 'page'] }, path: str, prefix: str, method: str,
        auth: { ...object, required: true, properties: { type: { ...text, enum: ['none', 'header', 'bearer'] } } },
        evidence: { ...strings, required: true, description: '读取工具返回的源码位置数组，例如 ["server.mjs:42"]' },
      } } },
      auth_blockers: { ...objects, description: '只填确实阻塞改造的外部授权或角色决定；管理员登录通过 admin_account 处理', items: { ...object, properties: {
        question: text, evidence: { ...strings, required: true }, affected: { ...strings, required: true }, action: text,
        reason: { ...text, enum: ['external_authorization', 'missing_credential', 'role_change'] },
      } } },
      apis: { ...objects, description: '扫描结果由插件合并，可以传 [] 或只补充需要定制的接口', items: { ...object, properties: {
        id: text, method: text, path: text, purpose: text,
        evidence: { ...strings, required: true }, parameters: { ...objects, required: true },
        request_body: { oneOf: [{ type: 'null' }, object], required: true },
        responses: { ...object, required: true }, auth: { ...routeAuth, required: true },
        effect: { ...text, enum: ['read', 'write', 'destructive', 'external'] },
        confirmation_required: { ...bool, required: true },
      } } },
      pages: { ...objects, description: '扫描结果由插件合并，可以传 [] 或只补充需要定制的页面',
        items: { ...object, properties: { auth: routeAuth } } },
      verification: object,
      unresolved: { ...strings, description: '若涉及令牌/登录/账密/凭据/授权码等阻塞问题，必须在 contract.auth_blockers 中添加 question 完全一致的条目（管理员登录通过 admin_account 处理，不要写入 unresolved）' },
    } },
    decisions: { ...objects, items: { ...object, properties: {
      id: text, question: text, impact: text, options: { ...strings, required: true },
    } } },
    four_step_report: object,
    proposal: { ...str, description: '旧版完整提案 JSON 字符串，仅在没有结构化参数时使用' },
  } satisfies ParameterSchemaSpec
}
