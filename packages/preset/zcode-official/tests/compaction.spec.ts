/** Alignment tests: ZcodeCompactionEngine injects the official 9-section prompt. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk, type ContentBlock, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { ZcodeCompactionEngine } from '../src/tools/compaction-zcode.ts'
import { buildCompactPrompt } from '../src/official/compact-prompt.ts'

const MODEL = 'test-model'
const SIGNAL = new AbortController().signal

class ScriptedAdapter extends LlmAdapter {
  lastOptions: GenerateOptions | undefined

  constructor(private readonly blocks: readonly ContentBlock[]) { super() }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    for (const [index, block] of this.blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'text') {
        yield { type: 'text-delta', index, text: block.text }
      } else {
        yield { type: 'block-end', index, block }
      }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class ExposedEngine extends ZcodeCompactionEngine {
  runSummarize(input: unknown, agent: unknown, signal?: AbortSignal): Promise<{ summary: ContentBlock[]; provider: string; model: string; rawOutput?: ContentBlock[]; llmStreamCall?: boolean }> {
    return (this as unknown as { summarize: (i: unknown, a: unknown, s?: AbortSignal) => Promise<{ summary: ContentBlock[]; provider: string; model: string; rawOutput?: ContentBlock[]; llmStreamCall?: boolean }> }).summarize(input, agent, signal)
  }
}

function agentOf(session: unknown): Parameters<ZcodeCompactionEngine['summarize']>[1] {
  // The summarize hook only reads session.id (usage keying) and options.
  return { session, options: { provider: MODEL, model: MODEL } } as Parameters<ZcodeCompactionEngine['summarize']>[1]
}

describe('ZcodeCompactionEngine', () => {
  it('injects the official 9-section prompt as the final user message', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    void new TokenMeter(ctx)
    const adapter = new ScriptedAdapter([{ type: 'text', text: 'ok summary' }])
    ctx.llm.registerAdapter([MODEL], adapter)
    const engine = new ZcodeCompactionEngine(ctx, { auto: false })

    const input = {
      messages: [createUserMessage({ content: [{ type: 'text', text: 'work history' }], source: { kind: 'test' } } as never)],
      tools: [{ name: 'bash', description: 'd', parameters: { type: 'object' } }],
    }
    const agent = agentOf({ id: 'sess-test' })
    const result = await (engine as unknown as { summarize: (i: unknown, a: unknown, s?: AbortSignal) => Promise<{ summary: ContentBlock[]; provider: string; model: string; rawOutput?: ContentBlock[]; llmStreamCall?: boolean }> }).summarize(input as never, agent as never, SIGNAL)

    const options = adapter.lastOptions!
    const last = options.messages.at(-1)!
    const lastText = (last.content as Array<{ type: string; text?: string }>).map(b => b.text ?? '').join('')
    // Official anchors
    expect(lastText).toContain('CRITICAL: Respond with TEXT ONLY')
    expect(lastText).toContain('<analysis>')
    expect(lastText).toContain('6. All user messages:')
    expect(lastText).toContain('security-relevant')
    expect(lastText).toContain('REMINDER: Do NOT call any tools')
    // DSH PRIOR-checkpoint merge rule preserved
    expect(lastText).toContain('<compacted-summary>')
    // Prefix preserved (KV-cache reuse) + tools forwarded
    expect(lastText).not.toContain('work history')
    expect(options.messages[0]).toBe(input.messages[0])
    expect(options.tools).toEqual(input.tools)
    expect(options.purpose).toBe('compaction')
    // Official flow lands through the DSH checkpoint framing (frameSummary at the caller)
    expect(result.summary.some(b => b.text.includes('ok summary'))).toBe(true)
    expect(result.llmStreamCall).toBe(true)
  })

  it('buildCompactPrompt is the verbatim official builder', () => {
    const p = buildCompactPrompt(undefined)
    expect(p).toContain('9. Optional Next Step:')
    expect(p).toContain('Preserve any security-relevant instructions or constraints')
    expect(p.startsWith('CRITICAL: Respond with TEXT ONLY')).toBe(true)
    expect(p.endsWith('Tool calls will be rejected and you will fail the task.')).toBe(true)
  })
})
