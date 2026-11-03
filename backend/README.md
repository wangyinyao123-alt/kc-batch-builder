# backend/ 接口契约

Electron 主进程与 PowerShell 脚本之间的对接文档。脚本本体由用户持有维护，不存于本仓。

- [api-contract.md](api-contract.md) —— 四类任务 × 脚本 × 契约状态总览（**两类脚本已全部到齐**）
- [kc-import-contract.md](kc-import-contract.md) —— 导入图片链路完整契约：调用形态、参数↔P3 表单、stdout 行协议、状态机、错误码映射、清洗逻辑、mock runner 方案、脚本补丁状态、已确认决策
- [kc-create-contract.md](kc-create-contract.md) —— 新建 Topic/Map/Pub 完整契约：headless 判定、三类参数映射、行协议差异、文件夹类型闸门、挂接（Topic→Map / Map→Pub）、标题来源解析、待确认项
- [scripts/](scripts/) —— 用户提供的脚本原文归档（kc-create-objects-ui.ps1 3293 行，UTF-8 BOM，逐字保存；import 脚本本体由用户持有未归档）

开发顺序与功能注入计划见根目录 `PROJECT_MEMORY.md`。
