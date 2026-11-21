# 候选版本验收

任务上下文包含 `assessment_phase` 时，处理本轮部署执行结果。

- `build` 阶段用 `opc_delivery_observe` 的 `state` 读取候选镜像构建结果。完成本次技能要求的构建后检查，再通过 `opc_delivery_assess` 提交证据 ID、结论和后续待验证项。
- `runtime` 阶段按应用实际行为选择 `state`、站内 `http` 或契约中的只读 `operation`，验证声明的启动和业务目标。判定是否可正式启用，通过 `opc_delivery_assess` 提交证据 ID 和结论。
- 容器刚启动时，可用一次 `http` 等待已有入口响应。按该应用实际行为填写 `expected_statuses`，并设置 `within_seconds`（最多 90 秒）。工具返回真实 HTTP 状态，AI 结合业务证据判定。
- 实际返回的异常或未完成项写进报告。需要修改时在同一任务修复，保留原方案、失败事实和已经通过的检查。
