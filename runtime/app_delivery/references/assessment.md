# 候选版本验收

任务上下文包含 `assessment_phase` 时，处理本轮部署执行结果。

由本次任务的 AI 根据工具回执给出结论。每个阶段先取得实际证据，再提交通过或失败及原因。失败时根据现有方案和失败证据决定修复内容。

- `build` 阶段用 `opc_delivery_observe` 的 `state` 读取候选镜像构建结果。完成本次技能要求的构建后检查，再通过 `opc_delivery_assess` 提交证据 ID、结论和后续待验证项。
- `runtime` 阶段从 `contract.verification.targets` 选择已声明的只读目标。调用 `opc_delivery_observe`，按目标填 `kind` 和 `target`（目标 ID）。按目标的 `expected` 核对实际状态、内容或应用身份，再通过 `opc_delivery_assess` 提交响应证据 ID 和结论。`state` 用于定位启动和日志问题。
- 候选容器只使用本地配置和临时容器数据。外部网络、正式资源和正式卷均未接入，PostgreSQL 的复制演练独立执行。如果业务目标需要候选访问数据库、缓存、外部 API 或生产卷，说明受影响的目标和缺少的隔离资源，提交失败结论。对历史数据的核对应引用演练库的实际查询结果。
- 容器刚启动时，可用已声明的 `http` 目标等待响应。按该应用实际行为填写 `expected_statuses`，并设置 `within_seconds`（最多 90 秒）。根据应用的返回特征确认访问的是本次候选业务入口。
- 报告列出实际异常、未取得的证据及结论。如果需要修改，在同一任务用 `read_current_proposal` 取得受影响字段，依据失败回执决定修法。
