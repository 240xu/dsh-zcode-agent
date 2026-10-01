/**
 * ZCode compaction engine: `BasicCompactionEngine` with the official
 * 9-section compaction prompt (<analysis>/<summary> structure, security-
 * constraint verbatim preservation, all-user-messages section) replacing the
 * core Markdown-checkpoint instruction. Ported from zai-org/ZCode@872ad96
 * `apps/zcode-cli/packages/core/src/compact/prompt.ts` (see
 * official/compact-prompt.ts); the override keeps the official NO_TOOLS
 * trailer semantics while retaining the DSH cache-reusing prefix call
 * (tools stay present — the official prompt was written for that case).
 *
 * The durable framing stays DSH's: the landed checkpoint keeps the
 * `<compacted-summary>` wrapper and CHECKPOINT_PREAMBLE (no replay consumer
 * parses those tags, and the PRIOR-checkpoint merge rule from the core
 * instruction is preserved inside the official text flow via an added rule).
 * @module @deepseek-ai/dsh-zcode-official/tools/compaction-zcode
 */

import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { contentHasImage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, RequestMessage, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
/** Structural mirror of compaction-basic's SummarizationInput (RequestMessage prefix). */
interface SummarizationInput {
  readonly messages: readonly RequestMessage[]
  readonly tools?: readonly ToolSchema[]
}

/** Structural mirror of compaction-basic's SummaryResult. */
type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  usage?: TokenUsage
} & (
  | { rawOutput: ContentBlock[]; llmStreamCall: true }
  | { rawOutput?: ContentBlock[]; llmStreamCall?: never }
)
import { buildCompactPrompt } from '../official/compact-prompt.ts'

export const inject = ['llm', 'tokenMeter', 'sessions'] as const

export class ZcodeCompactionEngine extends BasicCompactionEngine {
  constructor(ctx: Context, config?: Record<string, unknown>) {
    super(ctx, config as never)
  }

  /**
   * Official-prompt summarization: same cache-reusing `ctx.llm.stream()` call
   * as the core engine, with the final user message carrying the official
   * 9-section prompt instead of the core Markdown-checkpoint instruction.
   */
  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    // 0.2.0 two-layer resolution (mirrors BasicCompactionEngine.summarize +
    // summarizeWithLlm): outer policy resolution via conversationTarget
    // (routed header ?? agent options), inner call target with official
    // priority configured ?? latest ?? agentTarget — fail-closed when none.
    const policyTarget = conversationTarget(agent)
    const config = policyTarget === undefined
      ? this.config
      : resolveTargetPolicy(this.config as unknown as ResolvedConfigShape, policyTarget) as ZcodeCompactionEngine['config']

    const instruction = buildCompactPrompt(undefined)
      // DSH lands the summary inside a durable checkpoint wrapper; a later
      // compaction must merge the PRIOR checkpoint rather than copy it.
      // The core instruction's merge rule is preserved as an appended rule.
      + '\n\n- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.'

    const assembler = new BlockAssembler()
    const messages: RequestMessage[] = [
      ...input.messages,
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: instruction }],
      },
    ]
    const configured = config.summarizationProvider.length > 0
      ? { provider: config.summarizationProvider, model: config.summarizationModel }
      : undefined
    const latest = routedTargetOf(agent)
    const agentTarget = (agent.options.provider !== undefined && agent.options.provider.length > 0
      && agent.options.model !== undefined && agent.options.model.length > 0)
      ? { provider: agent.options.provider, model: agent.options.model }
      : undefined
    const callTarget = configured ?? latest ?? agentTarget
    if (callTarget === undefined) {
      throw new Error('no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields')
    }
    const options = {
      provider: callTarget.provider,
      model: callTarget.model,
      messages,
      ...input.tools === undefined ? {} : { tools: [...input.tools] },
      maxTokens: config.maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction' as const,
      ...signal === undefined ? {} : { signal },
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    const error = finish.kind === 'error' || finish.kind === 'aborted'
      ? new LlmError(finish.failure.message, finish.failure.code, finish.failure)
      : finish.kind === 'max-tokens'
        ? Object.assign(new Error('summarization truncated at the token cap (incomplete checkpoint)'), { code: 'MAX_TOKENS' })
        : undefined
    if (error !== undefined) throw error

    const rawOutput = assembler.blocks()
    if (contentHasImage(rawOutput)) {
      throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
    }
    const summary = rawOutput.filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    if (!summary.some(block => block.text.trim().length > 0)) {
      throw new Error('summarization produced no text summary content')
    }
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens: config.maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }
}

interface ResolvedConfigShape {
  readonly modelPolicies?: ReadonlyArray<{ provider: string; model: string }>
  readonly summarizationProvider: string
  readonly summarizationModel: string
}

// conversationTarget / resolveTargetPolicy are internal to compaction-basic;
// mirror their public behavior (routed target policy falls back to this.config).
function conversationTarget(agent: Agent): { provider: string; model: string } | undefined {
  // 0.2.0 conversationTarget: routed session header first, then agent options.
  const routed = routedTargetOf(agent)
  if (routed !== undefined) return routed
  const provider = agent.options.provider
  const model = agent.options.model
  return provider !== undefined && provider.length > 0 && model !== undefined && model.length > 0
    ? { provider, model }
    : undefined
}

/** 0.2.0 routedTarget: the session's latest routed request header. */
function routedTargetOf(agent: Agent): { provider: string; model: string } | undefined {
  const header = (agent.session as unknown as { requestHeader?: () => { config?: { provider: string; model: string } } | undefined }).requestHeader?.()
  const config = header?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return { provider: config.provider, model: config.model }
}

function resolveTargetPolicy(
  config: ResolvedConfigShape,
  target: { provider: string; model: string },
): ResolvedConfigShape {
  const policy = config.modelPolicies?.find(p => p.provider === target.provider && p.model === target.model)
  return policy === undefined ? config : { ...config, ...policy } as ResolvedConfigShape
}
