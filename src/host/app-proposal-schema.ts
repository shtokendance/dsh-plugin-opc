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
    readiness: { ...object, description: '由当前 AI 根据源码和工具证据判断，是否可以交给用户核对并开始候选构建。', properties: {
      outcome: { ...text, enum: ['ready', 'blocked'] },
      reason: text,
    } },
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
      build_inputs: { ...objects, description: '只声明 Dockerfile 实际使用的非秘密构建 ARG。引用本次用户确认的配置键，提供根 Dockerfile 行号；私有依赖凭据没有构建秘密通道时填写阻塞。',
        items: { ...object, properties: { arg: text, key: text, evidence: { ...strings, required: true } } } },
      data_plan: { ...object, required: true, properties: {
        strategy: { ...text, enum: deliveryDataStrategies(updating) },
        summary: text, recovery: text,
        ...(updating ? {
          source_resource_id: str, target_resource_id: str, rehearsal_resource_id: str,
          migration_files: strings,
        } : {}),
      } },
      health: { ...object, description: '可选。仅用于标识源码已有的健康入口，业务验证不得使用该入口。没有则省略。', properties: { path: text, status: { type: 'integer' }, json_contains: object } },
      configs: { ...objects, description: '完整列出本次部署使用的运行配置。已核实没有运行配置时填 []。默认值须有源码依据，用户给定的值写 value；平台注入项填写 resource_id 和 resource_key。', items: { ...object, properties: {
        key: text, default: text, value: { ...str, description: '本次部署已确定的实际值，包括用户给出的口令或连接串。未确定时省略。' }, secret: { ...bool, required: true }, required: { ...bool, required: true }, description: str,
        app_default: { ...str, description: '填写已证实的源码兜底值。value_plan.kind 为 default 且未提供覆盖值或非空 default 时，此值作为第三步生效值。' },
        source: { ...object, description: '使用 path 和 keys 定位源配置' },
        resource_id: { ...str, description: '原样填写 resources 返回的 id。' },
        resource_key: { ...str, description: '原样填写该资源 env_keys 中的字段名，区分大小写。' },
        preserve_on_upgrade: { ...bool, description: '该值用于读取历史数据时设为 true，例如字段加密密钥或查询盐。' },
        value_plan: { ...object, description: '每个必填项声明取值方式。generate 由系统按规格生成；input 由用户在部署会话或配置表单填写。', properties: {
          kind: { ...text, enum: ['default', 'source', 'resource', 'input', 'generate', ...(updating ? ['inherit'] : [])] },
          bytes: { type: 'integer', description: 'generate 时必填，随机字节数（16–128）' },
          encoding: { ...str, enum: ['base64', 'base64url', 'hex'] },
        } },
      } } },
      resources: { ...objects, description: '列出本次选择的资源，没有则填 []。使用资源目录返回的原始字段；填写 id 时，须在配置、挂载或数据迁移计划中声明对应绑定。',
        items: { ...object, properties: { id: str, type: { ...text, description: 'resources 工具返回的原始 type。' } } },
      },
      storage_mounts: { ...objects, description: '每项必须有 name、kind、container_path，使用容器内绝对路径。新增目录须填写 resources 中已核对的 resource_id。同路径升级沿用线上绑定。没有挂载时填 []。',
        items: { ...object, properties: {
          name: str, kind: str, container_path: str, purpose: str, resource_id: str,
        } },
      },
      credential_sources: { ...object, description: '用于业务技能的已有凭据源码引用。键是登录凭据的引用名，值为 {path,keys} 或 {path,line,name}。鉴权使用的引用名须与 configs 或本对象对应。' },
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
      apis: { ...objects, required: true, description: '填写技能可使用的真实接口，没有时为 []。auth 写入实际规则，仅沿用共同规则时可省略。', items: { ...object, properties: {
        id: text, method: text, path: text, purpose: text,
        evidence: { ...strings, required: true },
        parameters: { ...objects, required: true, items: { ...object, properties: {
          name: text, in: { ...text, enum: ['path', 'query', 'header'] },
          type: { ...text, enum: ['string', 'integer', 'number', 'boolean'] },
          description: text, required: { ...bool, required: true },
        } } },
        request_body: { oneOf: [{ type: 'null' }, { ...object, properties: {
          schema: { type: 'json', required: true }, required: { ...bool, required: true }, description: str,
        } }], required: true },
        responses: { ...object, required: true }, auth: routeAuth,
        effect: { ...text, enum: ['read', 'write', 'destructive', 'external'] },
        confirmation_required: { ...bool, required: true, description: 'effect 为 write、destructive 或 external 时必须为 true' },
      } } },
      pages: { ...objects, required: true, description: '填写技能可使用的真实页面，没有时为 []。',
        items: { ...object, properties: {
          path: text, purpose: text, evidence: { ...strings, required: true },
          actions: { type: 'array', required: true, items: { oneOf: [str, object] } }, auth: routeAuth,
        } } },
      configuration_review: { ...object, description: '总结实际读取的配置、资源和挂载及其源码证据。没有部署配置也要说明核实依据。', properties: {
        summary: text, evidence: { ...strings, required: true, description: '实际读取的源码文件:行号' },
      } },
      verification: { ...object, description: '可选的只读业务验证计划，供部署完成后使用。', properties: {
        targets: { ...objects, required: true, items: { ...object, properties: {
          id: text, kind: { ...text, enum: ['http', 'operation'] },
          path: { ...str, description: 'http 使用已核实为只读的站内路径' },
          method: { ...str, enum: ['GET', 'HEAD'], description: 'http 必填；必须有源码证据' },
          operation: { ...str, description: 'operation 必须引用契约中 effect=read 的操作 ID' },
          expected: { ...text, description: '从实际响应核对的业务现象或身份依据' },
          evidence: { ...strings, description: 'http 必填，证据为源码相对路径:行号' },
        } } },
      } },
      unresolved: { ...strings, description: '仅保留阻塞部署且需用户决定的问题。可选集成配置、改密建议、部署后才能确认的事项放在摘要。' },
    } },
    decisions: { ...objects, items: { ...object, properties: {
      id: text, question: text, impact: text, options: { ...strings, required: true },
    } } },
    proposal: { ...str, description: '旧版完整提案 JSON 字符串，仅在没有结构化参数时使用' },
  } satisfies ParameterSchemaSpec
}
