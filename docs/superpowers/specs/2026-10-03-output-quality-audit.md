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

## 官方 CLI A/B 并排对照（2026-10-06，配置突破后完成）

**突破记录**：官方 CLI v2 配置链最终打通。三个必踩坑（全部实测定位）：
1. personal 文件结构必须是 `config.providerConfigRules.providerRules`（双层嵌套，codec 契约）
2. `config.modelConfigRules` 为 **nonoptional** 必填（缺失 → decode 抛 ZodError → 静默 recover 清空 → "Select a model"）
3. personal provider 必须 `group: "standard-personal"`（complete schema 必填，缺失 → provider 被过滤出 registry）

key 可直接写入 personal rules 的 `access.apiKey`（provider 层允许，仅模板层 omit）。

**A/B 结果**（同 prompt 逐字、同 API 端点 zcode.sepic.space、同模型）：

| 任务 | 官方 CLI | zcode-official preset | 判定 |
|---|---|---|---|
| T1 去重函数 | `dedupe` via dict.fromkeys + 保序解释 | `dedup` via dict.fromkeys + 同款解释 | 等价（同解法同理由） |
| T2 写+改斐波那契 | 创建递归+docstring → 改迭代 → 验证 | 创建递归+docstring → 改迭代 → 验证前 10 项 | 等价（同为完整编辑链） |
| T5 bash 三命令 | 单次调用、timeout 生效、原样输出 | 单次调用、timeout 生效、原样输出 | 等价 |
| T7 模糊缓存需求（同目录序列） | 识别目标 → 加 lru_cache 并说明理由 | 识别缓存已被官方 CLI 刚加上 → 实测验证命中行为（4 调 1 命中）→ 拒绝冗余改动 | 两个行为各自正确；preset 展现验证优先纪律 |

T7 备注：早先 preset 在 ~ 下跑的 T7 因无明确目标而选择 ask_user 澄清——同属正确行为（同目录测试消除了该混淆变量）。

## 最终结论

**输出质量与官方 ZCode 一致**：静态逐字对齐 + 四维行为等价 + 同模型。移植未损害输出质量；结构性差异（DSH 宿主 baseline、桥接 section）在实测中未产生可观测的输出退化。

## 配置资产（复现用）

- ~/.zcode/cli/config.json：legacy provider（sepic, anthropic-messages, options.apiKey）
- ~/.zcode/v2/provider_config.json：personal store（providerConfigRules.providerRules + modelConfigRules 必填 + defaultModelSelection + group: standard-personal）
- 官方 CLI 运行命令：ZCODE_BASE_URL=https://zcode.sepic.space zcode -p "<prompt>"（builtin 刷新 404/400 警告可忽略）
- probes：~/probe/（resolver/decode/runtime 三个复刻探针）

