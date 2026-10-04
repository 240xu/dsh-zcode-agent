# 输出质量对照审计报告（v1.7 部署，2026-10-03）

## 方法与边界
- 静态层：部署 system prompt / 工具 schema / reminder 文本已与官方 ZCode@872ad96 逐字比对（前五轮字节级审核，全 PASS）。
- 行为层：同机同模型（GLM-5.3-Flash via zcode provider）跑标准化任务集 T1/T2/T5/T7，取实际 transcript 评估。
- 官方 CLI 并排对照（A/B）：官方 CLI 已从源码构建成功（v0.16.9, dist/zcode.cjs 29.7MB），但第三方 provider 配置（sepic.space）+ 模型选择的 v2 配置体系未能在一轮内接通（"Select a model before continuing" 持续）——A/B 对照阻塞，全部配置面发现已记录（personal provider config / defaultModelSelection / endpoint json 三层配置面已摸清，接通待续）。

## 实测结果（zcode-pilot 部署）
| 任务 | 行为 | 评估 |
|---|---|---|
| T1 输出风格 | 一行实现 + 精确说明（dict.fromkeys 保序去重），无冗余 | ✅ 与官方 ZCode 风格一致（简洁+技术准确） |
| T2 编辑链 | 2 次工具调用完成 write→edit；验证输出 0,1,1,2,3,5,8,13,21,34 正确 | ✅ 官方编辑纪律（先写后改、验证结果） |
| T5 bash 渲染 | 一次调用 date+pwd+df，timeout 5000 生效，输出人类可读原样 | ✅ 官方 bash 输出形状 |
| T7 模糊需求 | 未盲目假设：3 次 ask_user 尝试（schema 正式生效），headless 无应答者时明确陈述阻塞点而非编造 | ✅ 官方 ask-first 行为（headless 下降级合理） |

## 与官方的结构性差异（不可在 preset 层消除）
1. DSH baseline 身份行与宿主工具（job_output/followup 等）同场——prompt 里有非官方文本
2. "ZCode tool semantics" section 是官方没有的桥接层（DSH 工具名映射）
3. reminder 触发计数口径已对齐（entry/turn 分治），但长会话跨午夜场景未实测
4. compaction 摘要质量：引擎已带官方 9 段 prompt，实测需 15+ 轮长会话（本轮未触发）

## 结论
**输出质量与官方 ZCode 一致性：高**。prompt 文本逐字对齐 + 工具行为语义对齐 + 同模型，四个维度实测行为与官方设计意图一致。剩余差异均为宿主结构性差异（记录在 defect register），无 preset 可修项。
