# skills — 技能源码合集

agent 技能（SKILL.md 格式，由 agent 按需加载触发）的源码成员目录。

- 每个技能一个子目录（kebab-case），自带 `README.md` 说明用途、用法、技术栈
- 入库的是技能母体快照原样副本；`~/.agents/skills/` 下的同名目录是本机使用副本，主线变更后复制同步
- 与 `prompts/` 的分工：`skills/` 收录 agent 技能，`prompts/` 收录直接投给对话模型的提示词
