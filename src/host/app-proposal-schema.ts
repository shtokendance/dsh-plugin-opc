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
    unresolved: { ...strings, description: '仅填写必须由用户处理的部署阻塞。鉴权阻塞项与 contract.auth_blockers 的 question 保持一致。管理员账密使用 admin_account。' },
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
      health: { ...object, description: '可选。仅用于标识源码已有的健康入口，业务验证不得使用该入口。没有则省略。', properties: { path: text, status: { type: 'integer' }, json_contains: object } },
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
      auth_profiles: { ...object, description: '按 ID 保存登录方式。例：{"account":{"login_url":"/api/session","login_method":"POST","username_env":"APP_USER","password_env":"APP_PASSWORD"}}。profile ID 只出现一层，接口通过 auth.profile 引用。非标准登录字段用 login_body_template，仅允许账号和密码占位符。' },
      admin_account: { ...object, description: '按应用源码证据选择 existing 或 create。仅描述账号来源或写入位置，不提交实际账密。', properties: {
        mode: { ...text, enum: ['existing', 'create'] }, profile: text, evidence: strings,
        source: { ...object, description: '为已有可复用账密提供 {username,password} 引用：结构化配置 {path,keys}、源码 {path,line,name} 或 SQLite 明文字段 {path,table,column,where}。源码 name 填字段名（如 username、passwordHash），line 填定义该字段的行号，禁止填真实密码。只有源码和真实配置均缺少可复用账密时才省略 source。' },
        storage: { ...object, description: '首次建号仅在交付副本中写入应用真正读取的 SQLite 或 JSON/YAML 文件，具体结构见 references/contract.md。' },
      } },
      auth_rules: { ...objects, description: '共用鉴权写一条 prefix 规则；公开登录等例外用 path 和 method。登录方式写在受保护规则的 auth.profile，不能只写在公开登录接口上。evidence 在规则顶层。', items: { ...object, properties: {
        target: { ...text, enum: ['api', 'page'] }, path: str, prefix: str, method: str,
        auth: { ...object, required: true, properties: { type: { ...text, enum: ['none', 'header', 'bearer'] }, profile: str, header: str, env: str } },
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
        confirmation_required: { ...bool, required: true, description: 'effect 为 write、destructive 或 external 时必须为 true' },
      } } },
      pages: { ...objects, description: '扫描结果由插件合并，可以传 [] 或只补充需要定制的页面',
        items: { ...object, properties: { auth: routeAuth } } },
      verification: { ...object, description: '一个可核实响应字段的代表性只读业务用例即可。有受保护的只读业务接口时选其中一个。纯页面应用填写浏览器用例。' },
      unresolved: { ...strings, description: '仅保留阻塞部署且需用户决定的问题。可选集成配置、改密建议、部署后才能确认的事项放在摘要。鉴权阻塞项使用 auth_blockers，管理员账密使用 admin_account。' },
    } },
    decisions: { ...objects, items: { ...object, properties: {
      id: text, question: text, impact: text, options: { ...strings, required: true },
    } } },
    proposal: { ...str, description: '旧版完整提案 JSON 字符串，仅在没有结构化参数时使用' },
  } satisfies ParameterSchemaSpec
}
