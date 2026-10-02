# zcode-official 缺陷/偏差登记簿（2026-09-30）

状态图例：【OPEN-preset 可修】【OPEN-runtime】【WONTFIX-记录】【CLOSED 已修】

| # | 缺陷/偏差 | 状态 | 依据 |
|---|---|---|---|
| D1 | session-guidance 零技能会话多注入一行指引（官方 hasSkills 动态判断） | 【待判】 | deep-diff-scanner R5 |
| D2 | Agent completed 输出缺 `<usage>` 块（tool_uses/totalTokens/duration_ms 无 DSH seam；duration 可算） | 【部分可修？待判】 | deep-diff-scanner R7 |
| D3 | 后台 `<task-notification>` XML 通知块（DSH core jobs 通知注入点） | 【OPEN-runtime】 | deep-diff-scanner R7 |
| D4 | currentDate 官方 injectionTarget=meta_user（用户侧附件），我们是 system section | 【待判】 | audit-reviewer R8 |
| D5 | webfetch redirect notice url 仅 origin 级（provider 消息只含 origin）+ statusCode 硬编码 302 | 【待判：provider 限制？】 | webfetch-aligner R7 |
| D6 | persona 前缀已清，但 DSH baseline 自带 'You are ZCode, an interactive coding agent.' 与官方 intro 并存（宿主层不可移除） | 【WONTFIX-记录】 | audit-reviewer R8 |
| D7 | webfetch prompt 小模型处理不做（0.2.0 purpose 枚举仍无档位，成本结构不变） | 【WONTFIX-复核维持】 | webfetch-aligner R2：留档官方默认值（maxOutputTokens 实际 4096、用主模型 reasoning 最低档、输入截断 100k、tools=[]、metadata operation=web_fetch_processing）——将来若做按此参数 |
| D8 | preapproved 名单不照抄（现状 no-op，名单会漂移） | 【WONTFIX-已评估】 | webfetch-aligner |
| D9 | compact-post readFileState 投影（≤5 文件 resume reminder） | 【OPEN-runtime】 | audit-reviewer R8 |
| D10 | output-style reminder / Desktop section | 【WONTFIX】DSH 无对应概念 | 多轮确认 |
| D11 | 部署副本 package.json 版本号 0.1.7-rc.1 未 bump | 【OPEN-preset】 | runtime-architect |
| D12 | Cron/OffPeak/EnterPlanMode 工具化/OffPeak | 【WONTFIX】语义错位/需 runtime | 历轮记录 |

（专家判定后更新状态列；preset 可修项在本轮实现。）
