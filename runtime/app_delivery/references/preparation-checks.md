# 准备完成的依据

这是决策参考，不是让用户逐项勾选的清单。按当前工具实际能力检查，不制造不存在的执行结果。

| 检查 | 可确认的事实 | 不能据此推断 |
|---|---|---|
| 源码与入口 | 真正的后端入口、路由、依赖和运行资产已阅读；未知范围明确 | 读了 README 就完整理解业务 |
| 技术适配 | Dockerfile、监听与启动的必要改动已写入隔离副本；原工程保留 | 写了 Dockerfile 就构建成功 |
| 配置 | 变量名和值有原应用依据；保留原加载方式；缺值由用户在部署会话或配置表单填写 | 把字段写入环境变量就证明应用读取了它 |
| 数据与连接 | 存储持久性、连接目标和迁移影响明确；未授权则保持原行为 | 共享资源一定兼容、空库、可任意建表；所有 Redis 都是可丢缓存 |
| 交付物 | 实际应用包和业务技能对应同版源码、URL、契约；包结构校验通过 | 包存在就已部署，入口可访问就代表全部业务可用 |

## 按问题性质处理

- 明确的技术缺陷：在副本修复，保留源码证据。不要询问“是否允许添加 Dockerfile”。
- 需要业务决定：描述实际后果和可选方案，等待回答。不要要求用户审核函数代码。
- 确定的部署冲突：例如容器外的数据库却配置为 loopback，要求选择可达连接；同容器依赖可能合法，必须查明。
- 环境尚未验证：标为待部署检查。不能把本机无 VPN、DNS 失败或缺少 Docker 解释成应用必坏。
- 原文件与数据按应用运行需要保留。交付提案按配置键声明实际值和来源。业务技能通过配置键或凭据引用取得登录值。
- 可选建议：不挡流程，不要求确认未来数据持久性风险，不擅自引入数据库、队列、认证或架构重写。

## 调用能力应真实可用

根据业务操作归纳技能，再映射真实 API/页面、认证、参数与返回。已有登录不删除，也不把需要登录的接口说成可直接匿名调用。覆盖不了的动态路由或调用形式列明范围；不添加假 API、虚构测试数据或改返回值来获得成功。

改造完成后的说明只列实际改动、配置变化和已做检查。用户下一次改主意、换源码或改关键配置时，重新核对受影响项，旧版本检查结果不得挪用。外部 AI 交回的代码同样如此。

## 独立 CLI

以下命令用于直接使用仓库内的交付脚本。

## 工作目录

`source/` 为解包后的隔离源码；`inventory.json` 保存来源 SHA、文件摘要、疑似秘密位置；AI 编写 `analysis.md`、`review.json`、`app-contract.json`。smoke 写实际 `verification.json`，不得由模型伪造。

review.json 示例（只在确实收到确认后写）：

```json
{"kind":"human","source":"用户在当前对话确认 P01/P02，保留原数据库","approved_issue_ids":["P01","P02"],"unresolved":[]}
```

自动技术准备可记录 `kind: ai-technical` 和 `scope: deployment-adaptation`。只有实际得到的人工确认才能记录为人工确认，待决问题继续保留。

工具不能证明审批真伪，Agent 应如实记录。生成的回归样例用 `kind: fixture`，来源注明用户已授权生成测试工程，不代表真实应用人工验收。

## 使用

```sh
python3 scripts/delivery.py prepare app.zip --work-dir /tmp/app-review --slug stock-demo --url http://opc-adapter-stock-demo.orb.local:8080
python3 scripts/delivery.py view /tmp/app-review server.py
# AI 分析、用户确认、AI 改造并编写契约后：
python3 scripts/delivery.py check /tmp/app-review
python3 scripts/delivery.py bundle /tmp/app-review --out /tmp/app-delivery
python3 scripts/delivery.py smoke /tmp/app-review --image opc-adapter/stock-demo:review --container opc-adapter-stock-demo --keep
```

现版 smoke 仅处理本机 Docker：URL 必须是该容器的 OrbStack 域名，或事先固定的回环端口。它从实际生成的 app.tar 解包构建，而非另做不同权限的构建目录；创建无外网的专用运行网络、只读文件系统和 /tmp 临时盘，检查监听端口和只读业务 JSON。app.tar 与业务技能 ZIP 规范化时间/权限，避免文件时间或 Python 版本使摘要漂移。构建阶段可能下载应用依赖；它不配置 DNS、Nginx、证书、外部数据库或连接生产服务。

这套独立 CLI 流程保留原数据库引擎与数据，不自动迁库；SQLite 使用一致性快照并挂载完整数据目录。迁移属于独立授权任务。`--env-file` 仅接收受保护的用户配置，不继承宿主环境秘密。

业务技能使用：

```sh
python3 <技能目录>/scripts/invoke_api.py --operation get-stock --params '{"sku":"DEMO-1"}'
```

敏感参数用 --params-file，正文用 --body-file，文件为 - 时读 stdin；凭据从声明的环境变量读。脚本拒绝缺少必填参数、跨站重定向和未批准的写操作。它验证部分常见参数/必填结构，不代替完整 schema 或服务端业务校验。

--approve-write 是技术闸门，不是人类授权证明。没有用户明确确认，不得添加该标志。

## 状态

bundle 的状态是 packaged-not-deployed。无页面且监听端口和只读 API 探针通过后，smoke 写 verified-local；有页面写 awaiting-browser-verification（仅保留实际完成的构建/监听端口/API 证据）。工具不执行浏览器步骤，也不伪造浏览器成功证据。构建/启动/业务测试没有实际执行的项目一律写未验证；只读成功不能声称全部业务已验收。技能 ZIP 生成时已包含完整 URL，但部署成功前不启用为正式技能。
