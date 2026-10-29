# backend/ 接口契约

Electron 主进程与 PowerShell 脚本之间的对接文档。脚本本体由用户持有维护，不存于本仓。

- [api-contract.md](api-contract.md) —— 四类任务 × 脚本 × 契约状态总览
- [kc-import-contract.md](kc-import-contract.md) —— 导入图片链路完整契约：调用形态、参数↔P3 表单、stdout 行协议、状态机、错误码映射、清洗逻辑、mock runner 方案、脚本补丁状态、已确认决策

开发顺序与功能注入计划见根目录 `PROJECT_MEMORY.md`。
