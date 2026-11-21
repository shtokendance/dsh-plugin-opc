# 交付契约与工具

DSH 向导的部署字段与文件格式以 [交付文件格式](delivery-files.md) 为准。本页说明通用 API、页面、鉴权和验证字段。末尾另有独立 CLI 用法。

## 工作目录

`source/` 为解包后的隔离源码；`inventory.json` 保存来源 SHA、文件摘要、疑似秘密位置；AI 编写 `analysis.md`、`review.json`、`app-contract.json`。smoke 写实际 `verification.json`，不得由模型伪造。

review.json 示例（只在确实收到确认后写）：

```json
{"kind":"human","source":"用户在当前对话确认 P01/P02，保留原数据库","approved_issue_ids":["P01","P02"],"unresolved":[]}
```

Work 自动技术准备记录 `kind: ai-technical`、`scope: deployment-adaptation`，来源明确写为 AI 技术准备；这不代表人工审查或授权部署，不能跳过 unresolved。

工具不能证明审批真伪，Agent 应如实记录。生成的回归样例用 `kind: fixture`，来源注明用户已授权生成测试工程，不代表真实应用人工验收。

## app-contract.json 示例

```json
{
  "schema_version":1,
  "slug":"stock-demo",
  "name":"库存查询",
  "description":"查询现有商品库存",
  "base_url":"http://opc-adapter-stock-demo.orb.local:8080",
  "runtime":{"language":"python","version":"3.11","port":8080},
  "build_context":["Dockerfile","server.py"],
  "configs":[],
  "resources":[],
  "storage_mounts":[],
  "pages":[],
  "apis":[{
    "id":"get-stock","method":"GET","path":"/api/stock/{sku}",
    "purpose":"查询一个商品的可用库存","evidence":["server.py:42"],
    "parameters":[{"name":"sku","in":"path","type":"string","required":true,"description":"商品编码"}],
    "request_body":null,
    "responses":{"200":{"description":"库存结果","schema":{"type":"object","properties":{"available":{"type":"integer"}}}},"404":{"description":"商品不存在"}},
    "auth":{"type":"none"},"effect":"read","confirmation_required":false
  }],
  "workflows":[{"name":"查询库存","steps":["调用 get-stock，传入用户给出的 sku，返回 available"]}],
  "verification":{"cases":[{"operation":"get-stock","params":{"sku":"DEMO-1"},"status":200,"json_contains":{"available":7}}]},
  "unresolved":[]
}
```

- URL 由用户在分析前确定，与 prepare 输入严格一致；不含凭据、路径前缀、query 或 fragment。内网 HTTP/HTTPS 按目标环境选择，不绑定 Cloudflare。
- `build_context` 是应用文件和目录的白名单。包含实际构建与运行依赖，排除版本库、无关归档和分析报告。业务凭据按应用的配置机制在运行时提供。
- `configs` 只声明应用实际读取的键。用 `source: {"path":"config.yaml","keys":["service","url"]}` 引用原有配置值。示例文件只作模板参考。非敏感的源码兜底值可写入 `app_default` 供核对。
- 最终 `apis` / `pages` 收录应用实际部署的接口、页面与业务视图，至少一个数组非空。DSH 提交时可用 `[]` 或只补充、覆盖扫描项，插件合并完整清单。纯页面应用填写浏览器验证计划。
- 每个 API 必须含 purpose、源码 evidence、实际 parameters/request_body/responses、auth、effect。request_body 为 null 或包含 required、description、schema 的对象；完整 schema 与错误说明应保留，工具不声称完整实现 JSON Schema 验证。API 错误可能包含 HTTP 200 下的业务错误码，业务流程必须明确成功判断，不把 HTTP 成功等同业务成功。
- auth.type 为 none、bearer 或 header；非 none 必须声明 env 引用名或引用 auth_profiles 中的 profile，header 还要提供 header。账号密码和其他秘密仅用凭据引用。
- 直接在 API 或页面上声明认证时，用 `auth.evidence` 引用登录、会话或权限代码。共用中间件的证据写在 `auth_rules[].evidence`。每条证据使用读取工具返回的相对路径与实际行号，修改过的文件以拟交付版本为准。
- 共用鉴权写一条前缀规则，例如 `{"target":"api","prefix":"/api/","auth":{"type":"header","header":"Cookie","profile":"account"},"evidence":["server.mjs:42"]}`。公开登录入口用精确的 `path`、`method` 和 `auth.type: none` 声明例外。
- 账号密码换会话可用 `auth_profiles.account = {"login_url":"/api/session","login_method":"POST","username_env":"APP_USER","password_env":"APP_PASSWORD"}`。调用器向同源地址发送 JSON。非默认字段用 `login_body_template`，例如 `{"email":"${username}","secret":"${password}"}`。登录返回 `Set-Cookie` 时，受保护 API 声明 `{"type":"header","header":"Cookie","profile":"account"}`。返回 Token 时按实际响应声明 `token_json_path` 及接口要求的 Bearer 或请求头。凭据引用用于业务验证，无需加入容器配置。表单、重定向和 SSO 流程需要浏览器或专用调用方式。
- 向导中的登录凭据沿用应用运行配置，或通过 `credential_sources` 引用已有的可用值。应用自己的启动逻辑、配置或迁移处理首次账号初始化。
- 非只读 effect 必须 confirmation_required:true。不能仅按 HTTP 方法判断，POST 搜索也可以明确标为 read；GET 也可能需要确认。
- pages 每项含 path、purpose、evidence、actions；无页面就填空数组，浏览器操作需要调用方提供浏览器工具。
- 0.2.0 内置调用器只处理普通 HTTP/JSON 与标量 path/query/header 参数；参数名必须唯一。multipart 上传、二进制下载、流式/WebSocket、同名不同位置的参数及复杂数组参数编码需单独脚本并验证；先报告限制，请用户决定是否扩展，不能默默丢弃 API 或宣称已可调用。
- verification.cases 是已核实无副作用的业务探针，包含 operation、params、可选 body、预期 status 和非空 json_contains。一个代表性用例即可。有受保护的只读业务接口时选其中一个验证实际鉴权，保留各接口原有角色限制。已有健康入口可用可选 health.path 标识。测试数据只能来自明确的测试环境，不擅自生成真实业务记录。
- json_contains 对象按字段递归匹配；非空期望数组逐项匹配实际数组中的记录，顺序可不同；空期望只匹配空数组。空结果、不同条数或错误类型不能通过。多行顺序不稳定时先用获准条件过滤唯一测试记录，或提供专用验证。
- verification.browser_cases 是页面操作验证计划，例如 `[{"page":"/orders","steps":["输入查询条件","执行只读搜索"],"expected":"显示符合条件的真实订单"}]`。page 必须在 pages 中；该计划不是执行证据。没有 API 探针时必须填写浏览器计划。

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

本流程保留原数据库引擎与数据，不自动迁库；SQLite 使用一致性快照并挂载完整数据目录。迁移属于独立授权任务。`--env-file` 仅接收受保护的用户配置，不继承宿主环境秘密。

业务技能使用：

```sh
python3 <技能目录>/scripts/invoke_api.py --operation get-stock --params '{"sku":"DEMO-1"}'
```

敏感参数用 --params-file，正文用 --body-file，文件为 - 时读 stdin；凭据从声明的环境变量读。脚本拒绝缺少必填参数、跨站重定向和未批准的写操作。它验证部分常见参数/必填结构，不代替完整 schema 或服务端业务校验。

--approve-write 是技术闸门，不是人类授权证明。没有用户明确确认，不得添加该标志。

## 状态

bundle 的状态是 packaged-not-deployed。无页面且监听端口和只读 API 探针通过后，smoke 写 verified-local；有页面写 awaiting-browser-verification（仅保留实际完成的构建/监听端口/API 证据）。工具不执行浏览器步骤，也不伪造浏览器成功证据。构建/启动/业务测试没有实际执行的项目一律写未验证；只读成功不能声称全部业务已验收。技能 ZIP 生成时已包含完整 URL，但部署成功前不启用为正式技能。
