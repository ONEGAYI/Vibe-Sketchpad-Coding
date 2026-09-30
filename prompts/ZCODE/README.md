# ZCODE — ZCode 专属片段

ZCode 环境专属的提示词片段合集：既有经 SessionStart hook 注入会话的专属全局指令，也有依赖 ZCode 平台能力（子代理、后台执行等）的规则片段。内容假定运行在 ZCode 中，不适用于其他 agent 环境。

## 片单

- [ZCODE.md](ZCODE.md) — 经 SessionStart hook 注入的专属全局指令：父子代理通信 SOP（派发、父子/子父发信时机与内容、处理与节制）
- [ZCode启动时能力判断.md](ZCode启动时能力判断.md) — 对话开始时按主模型标识确定读图方式（GLM-5.3 交子代理、Flash 直接多模态、未知先确认途径），及子代理与长命令的后台执行偏好

## 用法

- `ZCODE.md`：在 ZCode 中配置 SessionStart hook，指向本文件即可随每次会话注入
- `ZCode启动时能力判断.md`：整段并入 ZCode 环境的 agent 指令文件（如全局 AGENTS.md）使用

## 约定

- 上游是个人 ZCode 全局配置（全局 AGENTS.md 与 hook 注入文件），本目录为对应段落的快照副本，随上游同步
- ZCode 平台专名（子代理、hook 参数、模型名）按原样保留；本目录只收录不涉个人路径与私有工具链的内容
