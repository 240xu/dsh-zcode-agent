/**
 * Official `Agent` multiplexer tool: `todo`-style preset-scoped shadow of DSH's
 * `tool-subagent`, ported from zai-org/ZCode@872ad96
 * `apps/zcode-cli/packages/contracts/src/tools/agent.ts` (input/output
 * schemas) and `apps/zcode-cli/packages/core/src/tool/handlers/agent.ts`
 * (description, result footer) plus `subagent/profile.ts` (built-in types).
 *
 * One tool dispatches on `subagent_type` over the official built-in child
 * types (exact-name match; unknown names fail with the official registry
 * error): `general-purpose` (Tools: *, continuable background default) and
 * `Explore` (official non-embedded allowlist, one-shot foreground default).
 * Child personas are the official personas plus `buildSubagentCommonNotes()`
 * and the official environment context block; the tool filter maps official
 * tool names to this deployment's DSH tool names.
 * @module @deepseek-ai/dsh-zcode-official/tools/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  buildExploreAgentPrompt,
  buildSubagentCommonNotes,
  buildSubagentEnvironmentContext,
  formatAgentProfilesForPrompt,
  createBuiltInExploreAgentProfile,
  createBuiltInGeneralPurposeAgentProfile,
  type AgentProfile,
} from '../official/subagents.ts'
import { collectEnvInfo } from '../env-live.ts'

export const inject = ['tools', 'subagents', 'jobs'] as const

/** Official agent registry, in official order; omission = general-purpose. */
export const ZCODE_AGENT_TYPES = ['general-purpose', 'Explore'] as const
export type ZcodeAgentType = (typeof ZCODE_AGENT_TYPES)[number]

/** Verbatim official registry error for unknown types (handlers/agent.ts). */
export function unknownAgentTypeError(subagentType: string): string {
  return `Agent type '${subagentType}' not found. Available agents: general-purpose, Explore`
}

interface ChildShape {
  readonly persona: string
  /** Official tool names, mapped to DSH names for the child filter. */
  readonly toolFilter: { readonly allow: readonly string[] }
  readonly continuable: boolean
}

/** DSH tool name for each official child-visible tool. */
const DSH_TOOL: Record<string, string> = {
  Bash: 'bash',
  Glob: 'glob',
  Grep: 'grep',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo_write',
  TodoRead: 'todo_read',
  Skill: 'skill',
  Agent: 'agent',
  Task: 'task',
  AskUserQuestion: 'ask_user_question',
}

function mapTools(officialNames: readonly string[]): string[] {
  const out: string[] = []
  for (const name of officialNames) {
    const dsh = DSH_TOOL[name]
    if (dsh !== undefined && !out.includes(dsh)) out.push(dsh)
  }
  return out
}

/** The official `EXPLORE_AGENT_ALLOWED_TOOLS` (non-embedded branch). */
const EXPLORE_OFFICIAL_TOOLS = ['Bash', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'TodoWrite'] as const

function childPersona(profile: AgentProfile, cwd: string): string {
  // The official child system prompt = profile system prompt + common notes +
  // environment context (subagent/system-prompt.ts composes these).
  const base = profile.systemPrompt.trim() === ''
    ? buildExploreAgentPrompt({ embeddedSearchEnabled: false })
    : profile.systemPrompt
  const notes = buildSubagentCommonNotes()
  const env = buildSubagentEnvironmentContext({
    agentPrompt: base,
    envInfo: { ...collectEnvInfo(cwd), cwd },
  })
  return [base, '', notes, '', env].join('\n')
}

/** Per-type child shape (official personas + official allowlists, DSH background modes). */
export function childShapes(cwd: string): Record<ZcodeAgentType, ChildShape> {
  const explore = createBuiltInExploreAgentProfile()
  const general = createBuiltInGeneralPurposeAgentProfile()
  return {
    'general-purpose': {
      persona: childPersona(general, cwd),
      // official general-purpose profile: tools: "*"
      toolFilter: { allow: mapTools(['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'Skill', 'Agent', 'AskUserQuestion']) },
      continuable: true,
    },
    Explore: {
      persona: childPersona(explore, cwd),
      toolFilter: { allow: mapTools(EXPLORE_OFFICIAL_TOOLS) },
      continuable: false,
    },
  }
}

/** Route a subagent_type exactly like the official registry (omission = default). */
export function routeAgentType(subagentType: string | undefined): ZcodeAgentType {
  if (subagentType === undefined || subagentType === 'general-purpose') return 'general-purpose'
  if (subagentType === 'Explore') return 'Explore'
  throw new Error(unknownAgentTypeError(subagentType))
}

/** Official output footer (handlers/agent.ts formatAgentOutputForModel), DSH ids. */
export function renderAgentResult(value: { kind: 'foreground'; runId: string; output: unknown } | { kind: 'continuable'; subagentId: string } | { kind: 'background'; backgroundTaskId: string }): Array<{ type: 'text'; text: string }> {
  if (value.kind === 'continuable') {
    return [{ type: 'text', text: `Agent running with ID: ${value.subagentId} (use send_message with agent_id '${value.subagentId}' to continue this agent)` }]
  }
  if (value.kind === 'background') {
    // Official formatAgentOutputForModel async_launched rendering (verbatim;
    // the official output-file lines are omitted — DSH jobs expose output via
    // job_output instead of a file path).
    return [{ type: 'text', text: [
      'Async agent launched successfully.',
      `agentId: ${value.backgroundTaskId} (internal ID - do not mention to user. Use send_message with to: '${value.backgroundTaskId}' to continue this agent.)`,
      'The agent is working in the background. You will be notified automatically when it completes.',
      "Briefly tell the user what you launched and end your response. Do not generate any other text - agent results will arrive in a subsequent message.",
    ].join('\n') }]
  }
  const finalText = textOf(value.output)
  // Official formatAgentOutputForModel completed rendering: empty child
  // output gets the official placeholder sentence.
  const childText = finalText.trim().length > 0
    ? finalText
    : '(Subagent completed but returned no output.)'
  return [{ type: 'text', text: `${childText}\nagentId: ${value.runId} (use send_message with agent_id '${value.runId}' to continue this agent)` }]
}

/** Model-visible text blocks of a content-block array. */
export function textOf(output: unknown): string {
  if (!Array.isArray(output)) return ''
  return output
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && !Array.isArray(block)
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

interface ZcodeAgentArgs {
  description: string
  prompt: string
  subagent_type?: string
  run_in_background?: boolean
}

/** Official description (buildAgentProviderDescription with the live roster). */
export function agentToolDescription(): string {
  const roster = formatAgentProfilesForPrompt([
    createBuiltInGeneralPurposeAgentProfile(),
    createBuiltInExploreAgentProfile(),
  ]) ?? ''
  return [
    'Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.',
    '',
    roster,
    '',
    'When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.',
    '',
    '## When to use',
    '',
    "Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result.",
    '',
    "- The agent's final message is returned to you as the tool result; it is not shown to the user — relay what matters.",
    '- A new Agent call starts fresh, so the prompt must be self-contained.',
    "- `run_in_background: true` runs the agent asynchronously; you'll be notified when it completes.",
    '- When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.',
    // Official gate-closed branch: the CreateWorkflow bullet is omitted because
    // this deployment ships no CreateWorkflow tool.
  ].join('\n')
}

export function registerAgentTool(ctx: Context): void {
  const cwd = process.cwd()
  const shapes = childShapes(cwd)
  const description = agentToolDescription()

  ctx.tools.register(defineTool({
    name: 'agent',
    description,
    parameters: {
      description: { type: 'string', required: true, description: 'A short (3-5 word) description of the task' },
      prompt: { type: 'string', required: true, description: 'The task for the agent to perform' },
      subagent_type: { type: 'string', description: 'The type of specialized agent to use for this task' },
      run_in_background: {
        type: 'boolean' as const,
        description: 'Set to true to run this agent in the background. You will be notified when it completes.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              backgroundTaskId: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => renderAgentResult(value as Parameters<typeof renderAgentResult>[0]),
    },
    async execute(args: ZcodeAgentArgs, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('agent tool requires a calling agent (exec.agent was undefined)')
      const childType = routeAgentType(args.subagent_type)
      const shape = shapes[childType]
      // Background default mirrors the official per-type modes: continuable
      // work runs detached unless the caller needs the result; one-shot waits
      // unless explicitly backgrounded.
      const runInBackground = args.run_in_background ?? shape.continuable
      const startRequest = {
        label: args.description,
        prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
        parent,
        persona: shape.persona,
        toolFilter: { allow: [...shape.toolFilter.allow] },
      }
      if (runInBackground && shape.continuable) {
        const started = await ctx.subagents.startContinuable({
          provider: 'spawn',
          label: args.description,
          request: startRequest,
          signal: exec.signal,
        })
        return { kind: 'continuable' as const, subagentId: String(started.childId) }
      }
      if (runInBackground) {
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        const id = jobs.start({
          kind: 'subagent',
          label: args.description,
          owner: SessionId(parent.session.id),
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start('spawn', { ...startRequest, signal: controller.signal })
            return {
              cancel: (reason?: string) => { controller.abort(reason ?? 'background agent task killed') },
              done: settleStart(start, controller.signal),
            }
          },
        })
        return { kind: 'background' as const, backgroundTaskId: String(id) }
      }
      const run = await ctx.subagents.start('spawn', { ...startRequest, signal: exec.signal })
      return await settleForegroundRun(run)
    },
  }))
}

/** Await a foreground run and surface the official completed shape (JSON blocks). */
async function settleForegroundRun(run: { id: { toString(): string }; result: Promise<{ output: readonly ContentBlock[]; stopReason: string; diagnostic?: string }> }): Promise<{ kind: 'foreground'; runId: string; output: JsonValue[] }> {
  let result
  try {
    result = await run.result
  } finally {
    // Mirror the tool-subagent lifecycle: the run is disposed by its provider
    // on settlement; nothing to release here.
  }
  if (result.stopReason !== 'completed') {
    const detail = result.diagnostic !== undefined ? ` (${result.diagnostic})` : ''
    throw new Error(`subagent ended with stopReason '${result.stopReason}'${detail}`)
  }
  return {
    kind: 'foreground',
    runId: String(run.id),
    output: result.output.map(block => JSON.parse(JSON.stringify(block))) as JsonValue[],
  }
}

/** Settle a background job's run into the jobs seam's JobOutcome. */
async function settleStart(
  start: Promise<{ id: { toString(): string }; result: Promise<{ output: readonly ContentBlock[]; stopReason: string; diagnostic?: string }> }>,
  signal: AbortSignal,
): Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }> {
  try {
    const run = await start
    const result = await run.result
    const text = textOf(result.output)
    if (result.stopReason !== 'completed') {
      return { status: 'failed', detail: `stopReason ${result.stopReason}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`, result: text }
    }
    return { status: 'completed', result: text }
  } catch (error) {
    if (signal.aborted) return { status: 'killed', detail: 'cancelled' }
    return { status: 'failed', detail: String((error as Error).message ?? error) }
  }
}
