# 部署交付文件

通过 `opc_delivery_inspect` 的 `reference` 读取本文件。准备完整提案后调用 `opc_delivery_submit`。大文件先用 `opc_delivery_propose_file` 暂存完整内容，再在提案中引用 ID。需要用户决策时，把问题加入 `unresolved`，等待回复后复用本轮证据。

## 阅读范围

从构建命令、启动入口、依赖清单和实际配置入手，沿调用关系读取路由、权限、数据读写和迁移模块。旧副本、测试、示例、缓存、生成目录和无关子项目先跳过。构建、启动、迁移或技能要支持的操作实际依赖这些文件时，再把对应文件纳入分析。保留必要的拆分模块和运行用静态文件。源码路径始终从导入项目的根目录起算。

## 向用户询问配置

核实应用实际读取的值，并检查源码默认值、可沿用的线上值和已核对的适用资源。仍缺少必填值时，在当前部署会话集中询问。每项先用白话说明用途、怎么填或从哪里取得、留空的影响，再附配置键方便核对。例如「请设置一个首次登录后台用的管理员密码。留空时无法建立初始管理员（`ADMIN_PASSWORD`）。」只问实际缺项。选填项说明留空的影响即可。

待用户提供的项声明 `value_plan.kind: input`，将问题写入 `unresolved`，并提交 `readiness.outcome: blocked`。收到回复后写入 `value`，保留其他已确认字段并清除已解决事项。它是本次部署的生效值。源码真实存在的默认值才填 `default` 或 `app_default`。已有合法生成方案沿用，用户委托生成新值时按应用约束声明生成规格。

## 输入与归档

- `readiness` 由本次任务的 AI 根据源码和实际工具证据提交。填写 `outcome` 和 `reason`。可以交给用户核对并启动构建时填 `ready`，尚有阻塞时填 `blocked` 并用 `unresolved` 说明原因。最终部署结果由平台检查目标容器和应用域名后登记。

- `summary` 说明配置、端口、持久化、必要文件和有影响的变更。新建、修改的文件在 `changes` 声明 `id, path, reason, content`。路径以应用源码根目录为准。正文必须是完整文件。部署包包含所有改造文件，配置与 SQL 路径由应用实际读取方式决定。沿用的文件不进 `changes`。
- `contract` 是完整部署契约，包含 `schema_version: 1`、应用名称和说明、`runtime: {language, version, port}` 及 `build_context`。构建上下文必须覆盖 Dockerfile、启动文件、依赖和本次提交的文件。应用 ID、地址由向导绑定。
- Dockerfile 需要从用户确认值取得构建参数时，在 `build_inputs` 用 `{arg, key, evidence}` 对应实际的 `ARG`、`configs` 中的键和根 Dockerfile 行号。构建只收到这些明确声明的非秘密值，配置保留原有运行用途。私有依赖令牌、密码和其他构建凭据需要专用秘密注入。当前流程缺少该能力时，写明阻塞和应用可行的准备方式。
- `configs` 只列应用实际使用的环境变量。每个条目填写 `key, description, required, secret, default`，可用 `source: {path, keys}` 引用真实配置。`default` 或 `app_default` 填源码确认的值；用户给出的本次实际值写 `value`。选择平台资源时填写 `resource_id` 和 `resource_key`，使用 `config_values` 读取已选字段的实际值。配置文件本身通过改造差异展示并随应用包保存。
- 每个必填配置都在 `value_plan.kind` 声明可执行的来源。`default` 用经源码证实的默认值，`source` 用真实原配置引用，`resource` 用资源及字段映射，`input` 由用户在部署会话或表单填写，`generate` 由系统按规格生成。生成项须为敏感配置，另填 `bytes`（16–128 个随机字节）和 `encoding`（`base64`、`base64url` 或 `hex`），均须符合源码实际约束。使用提交工具为当前任务提供的取值方式。
- 用 `config_values` 核对当前任务已取得的配置值。部署会话、交付 JSON 和确认表单展示实际值，用户可以替换未锁定的配置。还未取得的值明确标为待填写。复用的业务技能通过配置键使用当前部署值。
- 提交 `readiness.outcome: ready` 前，逐项对照实际源码和已答复内容，确认运行配置全部写入 `contract.configs`。确实无运行配置时填 `[]`。可在 `configuration_review` 补充核对说明和实际读取的 `文件:行号`。资源 ID 应对应配置、挂载或数据计划。鉴权引用名须对应已声明的配置或凭据来源。
- `storage_mounts` 必须完整列出。没有挂载时填 `[]`。每项填写 `name, kind, container_path`，其中 `kind` 用 `state-data`、`sqlite`、`uploads`、`exports` 或 `backups`，可写 `purpose, resource_id`。使用规范的容器内绝对目录，例如 `/app/data`，按需声明资源引用。
- `apis` 和 `pages` 填写实际供技能使用的路由及证据。插件不会回填扫描出来的路由。复用一条已证实的共同鉴权规则时写 `auth_rules`，特殊路由通过自身 `auth` 声明例外。cookie 登录用 `auth_profiles` 记录登录路由和用户名、口令的配置引用，规则绑定需授权页面或 API，不在公开登录路由上声明已有登录。接口结构见 `contract.md` 中的 API、页面和认证协议章节。无接口填 `[]`。写入、删除、外部操作的 `confirmation_required` 必须为 true。
- `verification.targets` 可选，用于记录部署后可单独核对的只读业务目标。每项填唯一 `id`、`kind` 和要核对的 `expected`。`operation` 用实际的 `operation` ID 引用 `effect: read` 的契约操作。`http` 用源码确认只读的 `path`、`method`（GET 或 HEAD）和 `evidence`（源码行号数组）。
- `data_plan` 填写 `strategy, summary, recovery`。策略及其附加字段按本次加载的技能填写。
- 可用 `read_source_connection` 读取真实的应用配置引用 `source: {path,keys}`。本机有 `psql` 时可查 PostgreSQL 结构或传 `schema,table` 查行数。有 `redis-cli` 时传源码证实的 `key` 查看该键的类型和有效期。
- `skill_markdown` 提交带实际换行的 Markdown 正文，从标题或正文开始。插件生成文件头。记录应用访问地址、页面与实际操作 ID、应用原有的登录方式和凭据引用。常规 API 用 OPC 的业务调用工具，保留已有账号和原有权限。
- 已有可直接用于登录的源码凭据用 `credential_sources` 引用。键与技能登录方式里的引用名对应，值为真实配置字段 `{path,keys}` 或源码明文常量位置 `{path,line,name}`。打包器按引用取值存入本机凭据存储，只供技能调用使用。密码散列不能作为登录凭据。
- `delivery.json` 记录 `format: 1, slug, base_version, summary, contract, files, effective_configs`。每个 `files` 项记录 `path, reason, sha256`，`effective_configs` 记录当前配置值及来源。插件绑定基线，打包器生成 `app.tar` 和 `skill.zip` 并校验散列。用户最终确认的生效配置和挂载归入同一部署版本。

## 提交前核对

1. 提交结构化提案的 `changes`、`contract`、`readiness` 和技能正文。修复时保留上一轮已确认的字段及暂存文件 ID。归档中的 `delivery.json.files` 只有摘要，提交文件变更时使用 `changes`。
2. 对照源码根目录和暂存清单，确认根 Dockerfile、实际构建输入和本次文件变更都在 `build_context` 中。路径使用项目内真实路径。插件本地副本目录和无关占位文件无需进入交付。
3. 分别核对 `configs[].source` 和 `credential_sources`。用 `{path,keys}` 读取原始 YAML、JSON、TOML、`.env` 或 properties 文件中的实际值。程序源码行号用于说明和证据。只有确实从源码常量读取已有登录凭据时，才用 `credential_sources` 的 `{path,line,name}`。本次输入、生成或继承的凭据直接引用相应配置键。
4. 对每个收录到技能的 API 和页面确认鉴权。公开入口显式声明，使用同一机制的入口共用有源码证据的规则。确认技能正文里的操作 ID 存在。按校验反馈修正全部指出的字段，只补需要的新证据。

## 平台资源选择

- 源码确认应用依赖容器外的服务，而现有配置缺失或默认指向本机时，调用 `resources`。优先核对 `is_default: true` 的兼容资源。把实际所需的地址、端口、库名、账号等字段从同一已选资源映射到应用自己的配置键。每项填 `value_plan.kind: resource`、目录返回的原样 `resource_id` 和 `env_keys` 中的原样 `resource_key`，再用 `config_values` 批量核对。应用内运行的依赖、用户已指定的有效配置和可兼容的线上绑定继续沿用。
- 新增持久目录时，用 `resources` 核对卷类型和默认资源，选择与应用读写方式兼容的卷，填写每项 `storage_mounts.resource_id`。SQLite 使用本地磁盘卷。升级中的同路径挂载沿用线上绑定。
- 在 `contract.resources` 列出选中的平台资源，每项原样填写目录返回的 `id` 和 `type`。没有使用平台资源时填 `[]`。
- 已核实的选择随提案直接进入第三步供用户核对和更换。资源不可用或需要用户决定数据归属时，写入 `unresolved`，说明具体缺项和可选方案。
