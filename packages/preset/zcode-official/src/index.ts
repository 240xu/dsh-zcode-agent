/**
 * zcode-official preset plugin: registers the official ZCode prompt sections.
 *
 * All section text is ported from the official open-source repository
 * zai-org/ZCode@872ad96 (Apache-2.0), `apps/zcode-cli/packages/core/src/`,
 * preserving the official builder-function shape (see ./official/*). The
 * agent loop, tool pipeline, permissions, and session log remain DSH's own.
 *
 * Section orders sit between the deployment persona prefix (0) and the plan
 * policy (500):
 * - 50   CLI prefix (official cli-prefix.ts)
 * - 100  identity (official identity.ts: intro + security notice + Harness)
 * - 110  dynamic behavior (official dynamic-sections.ts)
 * - 120  context management (official dynamic-sections.ts)
 * - 300  environment info (official env-info.ts, live values)
 * - 320  git system context (official env-info.ts, snapshot; dropped outside repos)
 * - 340  memory (official memory.ts, file-based memory format)
 * - 460  tool semantics (official description builders, keyed by DSH tool names)
 * - 490  current date (official current-date.ts wording)
 * @module @deepseek-ai/dsh-zcode-official
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { registerTodoTools, todoPriorityOf } from './tools/todo.ts'
import { registerAskUserShadow } from './tools/ask-user-shadow.ts'
import { registerBashShadow } from './tools/bash-shadow.ts'
import { ZcodeCompactionEngine } from './tools/compaction-zcode.ts'
import { registerAgentTool } from './tools/agent.ts'
import { installReminders, noteTodoWrite } from './tools/reminders.ts'
import { buildSecurityNotice, buildHarnessBlock } from './official/identity.ts'

/** Service dependencies: the system prompt section registry. */
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  ASK_USER_QUESTION_DESCRIPTION,
  DEFAULT_BASH_MAX_TIMEOUT_MS,
  DEFAULT_BASH_TIMEOUT_MS,
  buildAgentProviderDescription,
  buildBashProviderDescription,
  buildEditDescription,
  buildGlobDescription,
  buildGrepDescription,
  buildReadDescription,
  buildSkillDescription,
  buildTaskDescription,
  buildTodoWriteDescription,
  buildWebFetchDescription,
  buildWebSearchProviderDescription,
  buildWriteDescription,
  TODO_READ_DESCRIPTION,
} from './official/tool-descriptions.ts'
import { buildDynamicBehaviorText, buildContextManagementText } from './official/dynamic-sections.ts'
import { buildEnvText, buildGitSystemContextText, type EnvInfoText } from './official/env-info.ts'
import { buildMemoryText } from './official/memory.ts'
import {
  builtInAgentProfiles,
  formatAgentProfilesForPrompt,
} from './official/subagents.ts'
import { collectEnvInfo, localIsoDate, memoryRootFor } from './env-live.ts'

const CLI_PREFIX_PROMPT = 'You are ZCode, an interactive coding agent'

/** ZCode tool name for each DSH tool the zcode-official preset surfaces. */
const ZCODE_NAME: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  todo_read: 'TodoRead',
  todo_write: 'TodoWrite',
  skill: 'Skill',
  agent: 'Agent',
  task: 'Task',
  goal_read: 'GoalRead',
  ask_user_question: 'AskUserQuestion',
}

/** ZCode-side notes for DSH tools whose schema or surface differs. */
const PARAMETER_NOTES: Record<string, string> = {
  bash: 'ZCode parameter: `timeout` in milliseconds (default 120000, max 600000); `run_in_background` runs detached and re-invokes you on exit.',
  edit: 'ZCode requires the file to have been Read in this conversation before editing; `old_string` must match exactly including indentation and be unique; `replace_all` replaces every occurrence.',
  web_search: 'ZCode notes results are US-only.',
  goal_read: 'DSH-specific (no ZCode counterpart): the goal text is the authoritative long-running objective; do not mark the goal complete without real evidence of achievement — a finished plan or todo list is not completion evidence.',
  skill: "ZCode session guidance, verbatim:\n- When the user types `/<skill-name>`, invoke it via Skill. Only use skills listed in the user-invocable skills section — don't guess.",
}

/** Cross-surface mapping notes (official tools without a DSH tool row). */
const SURFACE_NOTES: readonly string[] = [
  '- `EnterPlanMode` / `ExitPlanMode`: plan mode in this deployment is entered by the user (`/plan`); `exit_plan_mode` submits the plan for approval. A user\'s conversational agreement approves nothing — only exiting plan mode requests approval.',
  '- `SendMessage`: continue a background subagent with a follow-up message instead of starting a new one (`send_message`).',
  '- `TaskOutput` is DEPRECATED upstream: never poll for background results; collect finished background work with `job_output` (wait only when genuinely blocked) and stop irrelevant work with `job_kill` (`TaskStop`).',
  '- `ApplyPatch`: the official registry ships it disabled (commented out) — perform patch-style edits with `write`/`edit` directly.',
  '- `ReadSessionContext`: read context from another persisted session with the `session_search`, `session_event_search`, `session_trace`, `session_event_trace`, and `session_event_read` tools (e.g. when the user references a prior session or asks to continue it).',
  '- `CreateWorkflow`/`SaveWorkflow`/`AmendWorkflow` and the other dynamic-workflow tools are not available in this deployment (the official gate-closed branch): never fabricate workflow tool calls.',
  '- `WebFetch` official behavior details: cross-host redirects are returned to you as a redirect notice rather than followed (call again with the new URL); responses are cached 15 minutes per URL; private-network and non-public-IP targets are blocked by an egress guard. This deployment implements the same 15-minute per-URL cache (repeat calls within 15 minutes return the cached fetch; call a slightly different URL to bypass) and upgrades http:// to https:// before requesting.',
  '- `SubmitResult`/`Escalate`/`RespondToCoordinator` exist only inside official dynamic-workflow runs; they are not registered here.',
  '- `CronCreate`/`CronList`/`CronUpdate`/`CronDelete` (persistent workspace automations) and `OffPeakCreate`/`OffPeakList` (server off-peak queue) have no counterpart in this deployment; for in-session scheduled reminders use the available schedule tools.',
  '- The official `Js` (node_repl) tool is disabled by default upstream too; this deployment\'s equivalent is `run_code` (PTC mode).',
]

export interface ZcodeSection {
  readonly name: string
  readonly order: number
  readonly text: string
}

/** Model-facing env snapshot used for live sections. */
export interface ZcodeEnv {
  readonly cwd: string
  readonly model?: { readonly providerId: string; readonly modelId: string }
}

/** Pure assembly so tests can assert section text without mounting cordis. */
export function buildSections(env: ZcodeEnv): ZcodeSection[] {
  const info: EnvInfoText = collectEnvInfo(env.cwd)
  const profileRoster = formatAgentProfilesForPrompt(builtInAgentProfiles())
  const descriptions: Record<string, string> = {
    read: buildReadDescription(),
    write: buildWriteDescription(),
    edit: buildEditDescription(),
    bash: buildBashProviderDescription({ defaultTimeoutMs: DEFAULT_BASH_TIMEOUT_MS, maxTimeoutMs: DEFAULT_BASH_MAX_TIMEOUT_MS }),
    glob: buildGlobDescription(),
    grep: buildGrepDescription(),
    web_fetch: buildWebFetchDescription(),
    web_search: buildWebSearchProviderDescription(),
    todo_read: TODO_READ_DESCRIPTION,
    todo_write: buildTodoWriteDescription(),
    skill: buildSkillDescription(),
    agent: buildAgentProviderDescription(profileRoster ?? ''),
    task: buildTaskDescription(buildAgentProviderDescription(profileRoster ?? '')),
    goal_read: 'Reads the current session goal state. The goal text is authoritative for the long-running objective; a later GoalRead result or runtime goal event updates it. Do not mark the goal complete unless real evidence shows the objective has been achieved. A completed plan, todo list, checklist, or planning phase is not completion evidence unless the objective was only to produce that artifact.',
    ask_user_question: ASK_USER_QUESTION_DESCRIPTION,
  }
  const blocks: string[] = [
    '# ZCode tool semantics',
    '',
    'The tools available in this session are DSH tools. Their ZCode semantics follow; where a note names ZCode parameters, apply it to the corresponding DSH tool.',
    '',
    '## ZCode tools mapped to DSH equivalents',
    '',
    ...SURFACE_NOTES,
    '',
  ]
  for (const [dshName, description] of Object.entries(descriptions)) {
    const zcodeName = ZCODE_NAME[dshName] ?? dshName
    blocks.push(`## ${zcodeName}`, '', description.trim())
    const note = PARAMETER_NOTES[dshName]
    if (note !== undefined) blocks.push('', note)
    blocks.push('')
  }
  const sections: ZcodeSection[] = [
    { name: 'zcode-official:cli-prefix', order: 50, text: CLI_PREFIX_PROMPT },
    {
      name: 'zcode-official:identity',
      order: 100,
      text: ['', 'You are an interactive ZCode agent that helps users with software engineering tasks.', '', buildSecurityNotice(), '', buildHarnessBlock()].join('\n'),
    },
    { name: 'zcode-official:dynamic-behavior', order: 110, text: buildDynamicBehaviorText() },
    { name: 'zcode-official:context-management', order: 120, text: buildContextManagementText() },
    { name: 'zcode-official:env', order: 300, text: buildEnvText(info, env.model) },
    { name: 'zcode-official:memory', order: 340, text: buildMemoryText(memoryRootFor(env.cwd)) },
    { name: 'zcode-official:tool-semantics', order: 460, text: blocks.join('\n').trimEnd() },
    { name: 'zcode-official:date', order: 490, text: `# currentDate\nToday's date is ${localIsoDate()}.` },
  ]
  if (info.isGitRepository) {
    sections.splice(5, 0, { name: 'zcode-official:sysctx', order: 320, text: buildGitSystemContextText(info) })
  }
  return sections
}

/** Tool + prompt dependencies: sections ride systemPrompt; the official todo
 * and Agent rows shadow the core rows inside the preset scope; the compaction
 * engine rides the compaction realm. */
export const inject = ['systemPrompt', 'tools', 'sessionProjections', 'subagents', 'userQuestions'] as const

export interface ZcodePresetConfig {
  /** When 'zcode', mount ZcodeCompactionEngine instead of the core row. */
  engine?: 'zcode'
}

export function apply(ctx: Context, config: ZcodePresetConfig & { role?: 'preset' | 'compaction' } = {}): void {
  // The compaction realm's row mounts the same package with role 'compaction'
  // (engine-only); the main preset row mounts sections + tools.
  if (config.role === 'compaction') {
    ctx.plugin(ZcodeCompactionEngine)
    return
  }
  const env: ZcodeEnv = { cwd: process.cwd() }
  // Official-shape todo + Agent rows (preset-scope shadows of the core rows).
  registerTodoTools(ctx)
  registerAgentTool(ctx)
  registerAskUserShadow(ctx)
  registerBashShadow(ctx)
  // Official compaction prompt engine (replaces the compaction-basic row in
  // the compaction realm; the row's isolate keeps it per-preset).
  if (config.engine === 'zcode') {
    ctx.plugin(ZcodeCompactionEngine)
  }
  // Reminders: install the pre-step injector on every agent that joins this
  // preset's scope (scope-filtered agent/created); count turns via
  // tools/post-execute (a todo_write call resets the todo cadence).
  ctx.on('agent/created', async ({ agent }) => {
    installReminders(
      agent.ctx,
      agentArg => {
        const snapshot = ctx.sessionProjections.snapshot(agentArg.session, ['todos'])
        const stripped = (snapshot.values['todos'] ?? []) as Array<{ content: string; status: string }>
        return Promise.resolve(stripped.map(item => ({
          content: item.content,
          status: item.status,
          priority: todoPriorityOf(agentArg, item.content),
        })))
      },
      agentArg => {
        try {
          return ctx.planMode.get(agentArg).active
        } catch {
          return false
        }
      },
    )
  })
  ctx.on('tools/post-execute', async (exec, _result, next) => {
    if (exec.name === 'todo_write' && exec.agent !== undefined) noteTodoWrite(exec.agent)
    return next()
  })
  ctx.effect(function* () {
    for (const section of buildSections(env)) {
      yield ctx.systemPrompt.section({
        name: section.name,
        order: section.order,
        text: section.text,
      })
    }
  }, 'zcode-official sections')
}

export { collectEnvInfo, memoryRootFor, localIsoDate }
export {
  EXPLORE_AGENT_TYPE,
  GENERAL_PURPOSE_AGENT_TYPE,
  buildExploreAgentPrompt,
  buildGeneralPurposeSystemPrompt,
  buildSubagentCommonNotes,
  buildSubagentEnvironmentContext,
  EXPLORE_AGENT_ALLOWED_TOOLS,
  formatExploreAllowedToolsForAgentDescription,
  builtInAgentProfiles,
} from './official/subagents.ts'
export {
  buildPlanWorkflow,
  buildPlanModeFullReminderBody,
  buildPlanModeSparseReminderBody,
} from './official/plan-workflow.ts'
export {
  DEFAULT_BASH_TIMEOUT_MS,
  DEFAULT_BASH_MAX_TIMEOUT_MS,
  buildAgentProviderDescription,
  buildBashProviderDescription,
  buildReadDescription,
  buildSkillDescription,
  buildTodoWriteDescription,
  buildWebSearchProviderDescription,
  EXIT_PLAN_MODE_MODEL_INSTRUCTIONS,
} from './official/tool-descriptions.ts'
export { ZcodeCompactionEngine } from './tools/compaction-zcode.ts'
