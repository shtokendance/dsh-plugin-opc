# 部署交付文件

通过 `opc_delivery_inspect` 的 `reference` 读取本文件。准备完整提案后调用 `opc_delivery_submit`。大文件先用 `opc_delivery_propose_file` 暂存完整内容，再在提案中引用 ID。需要用户决策时，把问题加入 `unresolved`，等待回复后复用本轮证据。

## 输入与归档

- `summary` 说明配置、端口、持久化、必要文件和有影响的变更。新建、修改的文件在 `changes` 声明 `id, path, reason, content`。路径以应用源码根目录为准。正文必须是完整文件。部署包包含所有改造文件，配置与 SQL 路径由应用实际读取方式决定。沿用的文件不进 `changes`。
- `contract` 是完整部署契约，包含 `schema_version: 1`、应用名称和说明、`runtime: {language, version, port}` 及 `build_context`。构建上下文必须覆盖 Dockerfile、启动文件、依赖和本次提交的文件。应用 ID、地址由向导绑定。
- `configs` 只列应用实际使用的环境变量。每个条目填写 `key, description, required, secret, default`，可用 `source: {path, keys}` 引用真实配置。只为应用源码证实的非敏感值填写 `default` 或 `app_default`。选择平台资源时填写 `resource_id` 和该资源的 `resource_key`，不要将连接密码写进产物。配置文件本身通过改造差异展示并随应用包保存。
- `storage_mounts` 必须完整列出。没有挂载时填 `[]`。每项填写 `name, kind, container_path`，其中 `kind` 用 `state-data`、`sqlite`、`uploads`、`exports` 或 `backups`，可写 `purpose, resource_id`。更新时声明原有数据路径，保留已有卷的归属。禁止指定宿主机任意路径。
- `apis` 和 `pages` 填写实际供技能使用的路由及证据。插件不会回填扫描出来的路由。复用一条已证实的共同鉴权规则时写 `auth_rules`，特殊路由通过自身 `auth` 声明例外。cookie 登录用 `auth_profiles` 记录登录路由和用户名、口令的配置引用，规则绑定需授权页面或 API，不在公开登录路由上声明已有登录。接口结构见 `contract.md` 中的 API、页面和认证协议章节。无接口填 `[]`。写入、删除、外部操作的 `confirmation_required` 必须为 true。
- `verification` 描述最终验收要证明的真实业务目标，供运行阶段选择检查。
- `data_plan` 填写 `strategy, summary, recovery`。首次部署用 `initialize`。无独立迁移的兼容更新用 `reuse`。专属 PostgreSQL 更新可用 `postgres_copy` 并填 `source_resource_id, rehearsal_resource_id, target_resource_id, migration_files`。目标数据库是新版本真正绑定的资源，原库由旧版本继续保留。演练库与正式目标均为空且各自使用专属数据库角色，SQL 按数组顺序在目标库执行。
- 可用 `read_source_connection` 读取真实的应用配置引用 `source: {path,keys}`。本机有 `psql` 时可查 PostgreSQL 结构或传 `schema,table` 查行数。有 `redis-cli` 时传源码证实的 `key` 查看该键的类型和有效期。通过 Platform 读取已绑定的专属 PostgreSQL 时使用 `database_schema`，可传 `name` 指定资源，传 `schema,table` 核对行数。
- `skill_markdown` 是完整业务技能文件。首先给出 YAML front matter，名称用 `app-<slug>`，说明技能的适用场景。记录应用访问地址、页面与实际操作 ID、应用原有的登录方式和凭据引用。常规 API 用 OPC 的业务调用工具；保留已有账号和原有权限。
- 已有可直接用于登录的源码凭据用 `credential_sources` 引用。键与技能登录方式里的引用名对应，值为真实配置字段 `{path,keys}` 或源码明文常量位置 `{path,line,name}`。打包器按引用取值存入本机凭据存储，只供技能调用使用。密码散列不能作为登录凭据。
- `delivery.json` 按上述契约归档，不含秘密。格式为 `{format:1, slug, base_version, summary, contract, files:[{path,reason,sha256}]}`，首次部署的基线版本号为 0。打包器以该方案生成 `app.tar` 与 `skill.zip` 并校验散列。最终用户确认的有效配置和挂载保存在同一部署版本的元数据中，后续更新以其为准。
