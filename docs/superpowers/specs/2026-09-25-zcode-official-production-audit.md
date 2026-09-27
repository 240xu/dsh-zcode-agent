# zcode-official 生产化全量对照审计（v3.14.0 官方源码 ↔ DSH preset）

日期：2025-09-25。基线：zai-org/ZCode@872ad96（本地镜像 ~/zcode-src/repo）。
现状：packages/preset/zcode-official（官方文本 sections 已对齐，13 测试绿）。

## 审计范围与方法

逐面枚举官方 model-facing 面（context sections / tool roster+schemas /
subagent 体系 / runtime reminders / permission 语义），逐项与当前部署对照。

## 差异清单与处置

| # | 官方面 | 官方出处 | 现状 | 差异 | 处置 |
|---|---|---|---|---|---|
| 1 | identity/Harness | context/sections/identity.ts | ✅ 已移植 | — | 无 |
| 2 | dynamic behavior / context management | context/dynamic-sections.ts | ✅ 已移植 | — | 无 |
| 3 | env info / git ctx / current date | context/sections/env-info.ts | ✅ 已移植 | — | 无 |
| 4 | memory section | context/sections/memory.ts | ✅ 已移植 | — | 无 |
| 5 | plan workflow reminder | runtime/helpers/runtime-reminders.ts | ✅ 文本已进 plan-mode section | sparse reminder 节奏（每 5 turn）DSH 无 attach 机制 | 记录差异；正文已对齐 |
| 6 | todo reminder（10 turn 无写入提醒） | runtime-reminders.ts TODO_REMINDER_CONFIG | ❌ 缺 | DSH 无 turn 计数注入面 | 记录差异（需 runtime 支持，本阶段不做） |
| 7 | TodoWrite schema：content/status/**priority**；输出 oldTodos/todos/summary | contracts/tools/todo.ts | ❌ DSH tool-todo 无 priority；输出 {todos,counts} | schema 不自洽：语义 section 告诉模型有 priority，实际 schema 会拒 | **实现预设 todo 工具行**：同 id 覆盖 tool-todo，官方 schema+输出，priority 走 session sidecar（沿用旧 zcode-todo 已验证方案） |
| 8 | TodoRead 官方输出 {todos[]} | contracts/tools/todo.ts | ❌ DSH 无 todo_read 工具 | 官方暴露 TodoRead | 预设行一并注册 todo_read（从 sidecar 读含 priority 列表） |
| 9 | Agent 工具：参数 description/prompt/**subagent_type**/run_in_background；输出 completed{agentId,agentType,content,totalToolUseCount,totalDurationMs,totalTokens} / async_launched{agentId}；结果脚注 agentId+SendMessage 提示 | contracts/tools/agent.ts + tool/handlers/agent.ts | ❌ 用 DSH tool-subagent（无 subagent_type；persona/toolFilter 是 per-instance 配置） | 结构性缺口：官方单复用器按类型路由 | **实现预设 agent 复用器工具行**（同 id 覆盖 tool-subagent）：ctx.subagents.start/startContinuable per 调用传 persona+toolFilter；CHILD_SHAPES 对齐官方（general-purpose=Tools:*/continuable，Explore=官方白名单/one-shot）；结果脚注对齐官方 |
| 10 | Task 工具（Agent 的 Claude-Code 兼容别名，providerVisible:false） | tool/handlers/agent.ts createTaskToolEntry | ❌ 无 | 官方对模型不可见（providerVisible false） | 不注册，仅语义 section 说明（已含） |
| 11 | SendMessage | tool/handlers/send-message.ts | ✅ DSH tool-subagent-control 提供 send_message/interrupt_agent | 参数名 to vs to/agent_id 差异 | 记录差异；语义 section 已映射 |
| 12 | TaskOutput/TaskStop（deprecated 官方亦弃用轮询） | tool/handlers/task-*.ts | ✅ DSH tool-jobs（job_output/job_kill） | 名称差异 | 语义 section 已映射（已含） |
| 13 | ReadSessionContext | tool/handlers/read-session-context.ts | ✅ DSH tool-session-query | 名称差异 | 语义 section 已映射（已含） |
| 14 | EnterPlanMode/ExitPlanMode 工具 | tool/handlers/plan-mode.ts | ⚠️ 映射到 DSH plan-mode 行（用户经 /plan 进入） | 工具 vs 模式差异 | 已记录（preset patch 头注释+语义 section）；本阶段维持 |
| 15 | WebFetch（egress guard、15min 缓存）/ WebSearch（US-only provider-native） | tool/handlers/webfetch.ts / websearch.ts | ⚠️ DSH tool-web 近似 | 行为细节差异 | 语义 section 已对齐描述；行为差异记录 |
| 16 | Bash 契约（cwd 持久、120000/600000、run_in_background、description 参数） | contracts/tools/bash.ts | ⚠️ DSH tool-bash：cwd 持久+背景有；**description 参数缺**；timeout 参数缺 | 参数面差异 | 记录；timeout/description 官方参数进语义 section 说明（timeout 已含） |
| 17 | 权限模式 plan/build/edit/yolo/auto | permission/service.ts | ✅ 映射注释已对齐 | — | 无 |
| 18 | Output style / skills section / agentsMd 注入 | context/sections/{skills,request-user-context}.ts | ✅ DSH agent-instructions + skill-filesystem 等价 | — | 无 |
| 19 | compact 语义 | compact/* | ✅ DSH compaction-basic 行 | 实现差异 | 记录 |
| 20 | headless 默认 yolo | cli/run.ts DEFAULT_HEADLESS_PROMPT_MODE | ✅ profile permission defaultPreset: danger-full-access | 等价 | 无 |

## 本阶段实现项（生产落地）

A. **预设 todo 工具行**（#7+#8）：新 src/tools/todo.ts——同 id `todo_write` 覆盖 + 注册 `todo_read`；官方 input schema（content/status/priority 全 required）；输出官方形状 oldTodos/todos/summary；priority 全量存 session sidecar（session.append('todo/write',{todos:[content,status]}) 主存储 + sidecar 存 priority），projection 兼容。
B. **预设 agent 复用器行**（#9）：新 src/tools/agent.ts——同 id `agent` 覆盖 tool-subagent；官方 schema/description（含官方 roster 文本 from subagents.ts）；execute 按 subagent_type 路由 CHILD_SHAPES（persona=官方 persona + buildSubagentCommonNotes + buildSubagentEnvironmentContext 组装；toolFilter=官方白名单，DSH 工具名）；前台等待 SubagentRun.result，输出官方 completed 形状+脚注；run_in_background→continuable（general-purpose）/job（Explore）；Task 别名不注册。
C. preset patch（web-app + zcode-pilot profile）改行指向新工具行；delegation 组内 tool-subagent 行替换为本包复用器，tool-todo 行替换为本包 todo 行。
D. 测试：todo schema/输出形状/优先级 sidecar 往返；agent 路由（未知类型官方报错文案）、Explore 白名单、官方脚注形状；既有 13 spec 不回退。

## 已记录、本阶段不做的差异

#5 sparse reminder 节奏、#6 todo reminder（需 runtime turn-count 注入面）、#11 SendMessage 参数名、#14 计划工具化、#15 网络行为细节、#16 Bash timeout/description 参数、#19 compact 实现差异。


## 第二轮复查（团队讨论后落地，2026-09-25）

| # | 项 | 结论 |
|---|---|---|
| 21 | todo reminder（10/10 节奏 + 官方 body） | ✅ 已落地：tools/reminders.ts，经 agent/pre-step 注入 <system-reminder>（agent-instructions 模式），todo 工具行写入时重置计数 |
| 22 | plan-mode reminder 节奏（full 每 5 次附件 / sparse 间隔） | ✅ 已落地：同一注入器，planMode 服务读活跃态，full 文本复用已移植的 plan-workflow |
| 23 | ask_user_question shadow | ✅ 已落地：官方 schema（header≤12 必填、options 2-4、labels 唯一、无 Other、multiSelect、preview 仅单选、1-4 问、问题文本唯一）+ 官方描述逐字；映射 seam（id 生成、multiSelect 原生、preview→detail 降级）|
| 24 | agent-instructions 行（AGENTS.md 注入） | ✅ 已修复遗漏：web-app patch + pilot profile 均已加行 |
| 25 | bash shadow（timeout→timeoutMs 别名） | ❌ 回退：preset-scope 同名 shadow 经 scheduler 分发会自递归（scope 解析命中自身，OOM hang）。改为文档差异：DSH timeoutMs vs 官方 timeout，description 必填 vs 可选；语义 section 已含官方参数说明 |
| 26 | compact prompt override | ⏸ 需 runtime：COMPACTION_INSTRUCTION 模块常量不可配；路径为 subclass BasicCompactionEngine 覆写 summarize()（架构师已核实 hook 文档），成本中，待后续 |
| 27 | cron/off-peak | ❌ 明确不做：DSH schedule 语义不同（session-local vs workspace 持久 cron），使用频率低 |
| 28 | EnterPlanMode 工具化 | ❌ 需 runtime 模式切换 seam；exit_plan_mode 语义已等价 |

工具 shadow 关键机制结论：子代理经 toolFilter 解析到 preset scope 的 shadow 行（nearest-ancestor shadow），但同名 shadow 内部再按名字分发会命中自身——nested dispatch 必须绕过 scope 解析（run_code bridge 走 TOOL_RUNTIME_SCHEDULER 直调核心定义），bash 场景无独立核心名可用，故放弃 shadow。
