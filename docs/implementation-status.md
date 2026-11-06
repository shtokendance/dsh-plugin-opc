# 一期实施与验收状态（2026-11-05）

## 仓库与边界

- 插件为独立仓库 `dsh-plugin-opc`，当前 `feature/phase1`；初始化 `release` 基线 `218d46a`。插件业务代码尚未提交或推送。
- DSH 使用公开 credentials、authorization、SkillProvider、tools、approval、MCP manager、Typert 与右侧栏 Slot 接口；外部 YAML 加载，DSH tracked source 保持未修改。
- Platform 功能 worktree `platform-opc-dsh-phase1`；改动提交 `65a5480`，整合最新远程 release 后提交 `e6ee730`，首次发布合并 `bbf669e`；后续授权 MCP Schema 修正 `23a3b8d` 合并为 `392a72638730356e905b06aebf000b546d440326`，已推送远程 release。
- 用户明确决定本次跳过上游 main 同步，不将 main 整合进功能分支；未执行任何 main 操作。
- 用户要求先合并并推送 Platform release，再从 release 构建部署。构建已完成：Linux amd64、CGO=0、vcs.modified=false，SHA-256 `7dbc5be20ece099d9e33e604f8d55ed12596b19b368fefba2c8976821afa1d37`。

## 已实现

企业 PKCE 登录/取消/刷新/登出/空间切换；专属凭据命名空间；上下文 epoch 失效；知识库目录/检索/正文与会话范围；技能三向校验与原子安装、更新、启停、卸载、原生 SkillProvider；MCP 目录/Schema/在线调试/审批/动态挂载；三个原生右侧栏入口。

MCP 挂载采用本机随机令牌代理，所有调用经 Platform 受管策略，避免将企业 access token 发送给目录中的任意 URL。Agent `opc_mcp_invoke` 走 DSH 原生审批；调试和代理挂载审批在企业面板显示。切换身份/空间自动撤销挂载。连接状态取自 DSH 原生 MCP manager。

## 已验证

- 插件 Node 24 下 19 项自动测试通过；覆盖 PKCE、刷新单飞/重放、登出竞态、会话范围、跨身份失效、ZIP/hash/原子安装、SkillProvider 撤权回收、MCP 审批/拒绝/中途切换、本机 MCP 传输授权和卸载。
- Host 和 Client TypeScript 检查通过；独立双端 bundle 构建通过；构建额外检查 RPC 参数名未被打包器重命名。
- npm pack dry-run 只包含 README、package.json 和两个 bundle，不含运行目录、凭据或本机配置。
- Platform `go test ./...` 在功能分支整合最新 release 后以及 release 合并后均通过；新增正文读取测试覆盖分页、排序、停用片段、归属错配、读取期间移动/撤权。
- 真实 DSH Web 三个企业 Tab 和未登录门禁可用；用户企业微信登录成功，个人 DeepSeek 身份仍共存；重启 Host 后企业凭据恢复成功。
- 测试服真实返回两个空间；财务知识库检索成功；`excel-compare` 从测试服下载安装并启用，出现在原生 `/` 候选中。
- 在真实 Agent 对话中完成 `skill` 加载、`opc_knowledge_search`、`opc_knowledge_read` 调用。旧测试服 read 响应仅有元数据，不能当作正文验证通过。
- 技术交付中心返回两个 MCP 服务及真实 Tool Schema。旧测试服只读 MCP 调试返回 HTTP 406；尚未通过调用验收。
- 测试工作区通过 DSH 界面建立在 `.runtime/acceptance`，因为既有 `opc` 工作区路径已不存在；未改动既有工作区文件。

## 部署与剩余验收

- Platform release `392a726` 已部署；服务器二进制 SHA-256 匹配，网关本地 `/health` 返回正常。公开域名 `/health` 返回前端页面，未作为健康证据。
- 新正文读取接口真实 UI 已展示费用报销文档正文（2558 字符）；发布后真实 Agent 已再次完成 skill 加载、检索与正文读取，报告 content_chunk_count=11 且无工具错误，记录在 `.runtime/evidence/agent.txt`。
- 原生 MCP manager 已连接搜索服务，暴露 1 个工具。真实调用进入受管策略但返回 `INTEGRATION_ARGS_KEY_REQUIRED`；用户已决定暂不补齐知识服务配置，真实审批和业务调用未通过。
- 实际技能停用、启用、卸载、重装及原生斜杠菜单可见性已通过。空间隔离亦已实测：异空间技能候选隐藏、原空间恢复，MCP 切换后自动卸载。最终登出检查仍待完成；逐项证据见 `acceptance-matrix.md`。

## 运行与证据

外部开发配置 `config/web.overlay.yml`（gitignore）与可分发示例 `config/overlay.example.yml`。宿主端口 3080，访问地址从 `/tmp/opc-dsh-runtime.log` 读取；该日志含临时访问 token，不提交或粘贴。浏览器截图与文本位于忽略的 `.runtime/evidence`。

临时 Loader observer 已删除。浏览器中既有 DeepSeek profile/balance 请求错误与 OPC 检查分别记录。真实账号数据与业务文本只留本机验收目录，不放入 Git。
