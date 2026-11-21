# OPC 插件集成边界

DSH 根据任务类型加载首次部署或应用更新技能。AI 用 `opc_delivery_propose_file` 暂存完整文件，用 `opc_delivery_submit` 提交结构化方案。插件在隔离副本中校验和打包，通过 Platform 的 `/integration/v1/apps` 执行部署。

向导在第三步展示实际交付配置、构建 Dockerfile、挂载与应用技能，用户确认后才提交发布。候选构建和业务验收使用实际执行回执。业务技能只有通过应用验收后才可启用。

开发来源见 [PROVENANCE.md](../PROVENANCE.md)。字段定义见 [交付文件格式](delivery-files.md)，独立脚本用法见 [准备检查](preparation-checks.md)。
