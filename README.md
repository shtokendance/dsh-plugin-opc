# dsh-plugin-opc

独立的 OPC 企业插件，通过 DSH 公开服务和外部配置加载。DSH 源码无需修改。企业账号与 DSH 个人账号独立。

## 一期能力

- 企业 OAuth PKCE 登录、取消、退出、刷新与空间切换；Access Token 仅在宿主内存中，Refresh Token 使用 DSH `dsh-plugin-opc/enterprise` 凭据命名空间。
- 企业知识库目录、检索、Markdown 正文与会话限定；提供 `opc_knowledge_search`、`opc_knowledge_read` 工具。
- 企业技能下载、更新、启停、卸载；原生 SkillProvider 支持 `/` 和模型加载。安装执行三向 SHA-256、ZIP 安全检查与原子激活。
- 企业 MCP 目录、Schema、调试与审批；`opc_mcp_invoke` 使用 DSH 原生审批。挂载到 DSH 管理器时使用本机随机凭证代理，所有调用仍经平台策略，企业令牌不发送给任意 MCP 地址。挂载及调试的审批在企业面板显示。
- 登出和切换空间使旧请求、技能候选及挂载失效；知识库与技能授权缓存最长 30 秒，会话复核最长 60 秒。

应用部署属于后续阶段。

## 本地开发

需要 Node >= 24.9、npm，以及已安装依赖并生成 Host/Client 类型与 Web 构建的 `deepseek-harness`。当前适配 DSH `0.2.2-alpha.3` 的公开服务接口。

在本仓库运行：

```sh
npm ci
node scripts/link-dsh.mjs ../deepseek-harness
node scripts/configure-dsh.mjs ../deepseek-harness
npm test
npm run typecheck
npx tsc -p tsconfig.client.json
npm run build
```

两个脚本仅在**插件仓库**生成依赖链接和类型配置；不修改 DSH。重新执行 `npm ci` 后需重新链接。

将外部 YAML 配置中的 `name` 指向本插件的绝对路径 `lib/index.js`，由 DSH CLI `web --patch /绝对路径/overlay.yml --no-open` 加载。示例见 `config/overlay.example.yml`。生产安装时可使用包名 `@opc/dsh-plugin-opc`；宿主必须能解析所需 DSH peer packages。

开发期 `config/web.overlay.yml` 是本机运行配置，不随包发布。它还启用 DSH 自带的浏览器目录选择器。不要将 `.runtime`、运行日志、凭据或带 token 的本机登录 URL 提交到仓库。

## 验证边界

`npm test` 是本地模拟协议及文件系统验证，不替代测试服验收。`scripts/browser-smoke.mjs` 连接已运行的本机 DSH，检查真实侧栏和登录门禁；读取 `/tmp/opc-dsh-runtime.log` 中的临时地址，截图写入忽略的 `.runtime/evidence`。

一期完整验收还需要测试账号登录，验证真实知识库、技能安装及原生调用、MCP 直接调用与审批。当前进度和未验证事项见 `docs/implementation-status.md`。测试服 Platform 的 MCP 策略修正在单独的 Platform 功能 worktree 中，未部署的代码不能算作测试服已验证。

## 开发边界

插件功能分支：`feature/phase1`；`release` 仅是初始化基线。业务代码未自动提交、推送或合并。发布须遵守项目的人工上游整合关卡。
