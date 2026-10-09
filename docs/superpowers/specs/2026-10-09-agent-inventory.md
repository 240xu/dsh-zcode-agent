# 智能体资产清单（2026-10-09 核对）

## 两套机制的区别（重要，别混）

| | 智能体团队（teammates） | 子智能体（subagent） |
|---|---|---|
| 来源 | `spawn_teammate` 创建的常驻成员 | `subagent` 工具派发的一次性任务 |
| 生命周期 | 持久（跨轮存在，可反复 send_message） | 一次性（跑完返回即结束） |
| 用途 | 长期分工协作（如长期审计角色） | 短任务并行（如本轮 4 项复核） |
| 本轮状态 | 8 个**全部 inactive 僵尸**，零参与 | 本轮派 5 个，4 死 1 完成（A/B），重派 2 个 |

## 一、常驻团队（8 个，全部 inactive —— 历史遗留，本轮零参与零产出）
audit-reviewer（官方源码对齐）· runtime-architect（DSH seam 架构）· compact-engineer（压缩引擎）
gap-scout（剩余面对齐）· bash-shadow-fixer（Bash shadow）· webfetch-aligner（WebFetch 对齐）
reminder-verifier（Reminder 验证）· deep-diff-scanner（逐文件深扫）

**处置**：全部标记为归档僵尸。它们 inactive 不消耗任何资源，且历史任务（前几轮审计）已完成并落进代码/文档。
**不删除的原因**：DSH 无 teammate 删除 API；且它们的历史结论是本轮审计的依据（defect register、byte audit）。
**若确需彻底清除**：只能重启宿主会话（团队在会话级内存中）。

## 二、本轮子智能体（subagent）
| ID | 任务 | 结果 |
|---|---|---|
| —（前序） | 官方 CLI A/B（T1/T2/T5/T7） | ✅ 完成，报告已推送 447062ca69 |
| 3e4eca0f | T6 compaction A/B | ❌ 死（无产物） |
| 05003710 | T3/T4 行为 A/B | ❌ 死（仅建目录） |
| 402c9ef9 | reminder 节奏复核 | ❌ 死（无产物） |
| 8192894a | agent 协作语义 | ❌ 失败（无 closing message） |
| c40666ef | agent 协作（重派） | ❌ 死 |
| **f20a889c** | **T6 compaction A/B（重派）** | 🟡 运行中 |
| **b8d182df** | **T3/T4 行为 A/B（重派）** | 🟡 运行中 |

**死亡原因**：会话中途多次 model 切换（zcode→zcodejia→shanghai→nvthird→openzenthird→workbuddy），子智能体随宿主模型切换中断，且网络波动加剧。

## 三、清理记录（已执行）
- 删除 `~/ZCode-872ad96/`（89MB 解包副本）+ `~/zcode-full.tgz`（38MB）→ 官方 CLI 已在 `zcode-src/repo` 构建完成，不再需要
- 归档探针 `~/probe/` → `~/quality-audit/probes/`
- 清理死掉的审计工作目录 `ab-agent-collab` / `ab-t34-official` / `ab-t34-preset`
- 保留 `ab-official`（A/B 归档用）+ `ab-compaction-*` / `ab-t34-*`（重派员会重建）
- 删除 `ab-official/quality_t2.py` 临时产物

## 四、项目主干状态（干净）
- 分支 `zcode-official`，工作树 **0 改动**
- HEAD `447062ca69`：A/B 完成（T1/T2/T5/T7 全部等价）+ v2 配置链突破记录
- 远端 fork/zcode-official 已同步
- 预设版本 0.2.0-rc.1，30/30 测试通过，已部署 zcode-pilot
