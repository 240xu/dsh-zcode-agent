# 干净推进清单（2026-10-09 预热）

## 当前基线（已锁定，可随时继续）
- 分支 `zcode-official` @ `879e5e9c3e`，工作树干净，远端已同步
- 预设 0.2.0-rc.1，30/30 测试通过，已部署 zcode-pilot
- 官方 CLI 配置链已打通（sepic provider + GLM-5.3-Flash），可随时跑 A/B
- 已完成 A/B：T1/T2/T5/T7 → 全部等价
- 缺陷登记簿 D1-D12 状态明确（preset 可修已修，需 runtime 已上报 Discussion）

## 进行中（2 个复核子智能体）
| ID | 任务 | 产物路径 |
|---|---|---|
| f20a889c | T6 compaction A/B（长会话摘要质量） | `~/quality-audit/review/compaction-ab.md` |
| b8d182df | T3 todo 纪律 / T4 Explore 子代理 A/B | `~/quality-audit/review/t34-ab.md` |

**注**：子智能体会随宿主 model 切换中断（本轮已死 5 个）。若它们再次无产物，兜底方案 = 我自己跑（代价：占用主上下文）。

## 待办优先级
1. **[高]** 收 T6 + T3/T4 复核结果 → 汇总进质量报告
2. **[高]** 复核发现的 preset 可修差异 → 实施修复 → 30/30 复测 → 部署验证
3. **[中]** 更新 `docs/superpowers/specs/2026-10-03-output-quality-audit.md` 收尾版
4. **[中]** 提交 + 推送 + 更新 tag `official-source-v1`（若代码有变）
5. **[低]** T6 若官方侧无法触发（context 1M 太大）→ 以官方源码 prompt 为基准做静态对照，记录为"实测未覆盖"
6. **[低]** reminder 节奏真实会话验证、agent 协作语义复核（本轮子智能体已死，可后补）

## 明确不碰
- message ops（用户在另一边自行处理）
- DSH 本体源码（零改动约束）

## 环境备忘
- preset 测试：`cd ~/zcode-dsh/packages/preset/zcode-official && node ~/dsh-testenv/node_modules/vitest/vitest.mjs run --config vitest.config.ts`
- 官方 CLI：`ZCODE_BASE_URL=https://zcode.sepic.space ~/zcode-src/repo/apps/zcode-cli/packages/cli/dist/zcode.cjs -p "<prompt>"`
- preset 侧：`/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile zcode-pilot --json "<prompt>"`
- 官方 CLI 配置（勿删）：`~/.zcode/cli/config.json` + `~/.zcode/v2/provider_config.json`
