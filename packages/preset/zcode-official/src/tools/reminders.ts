/**
 * Official runtime reminders, ported from zai-org/ZCode@872ad96
 * `apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts` and
 * delivered through DSH's `agent/pre-step` waterfall (the same injection
 * pattern agent-instructions uses): the listener counts assistant turns per
 * agent and splices a `<system-reminder>` user message into the admitted
 * batch when the official cadence fires.
 *
 * Ported cadences:
 * - todo reminder: TURNS_SINCE_WRITE 10 / TURNS_BETWEEN_REMINDERS 10,
 *   body verbatim from buildTodoReminderBody (todo list rendered inside).
 * - plan-mode reminders: full workflow on the 1st, 6th, 11th… attachment
 *   (FULL_REMINDER_EVERY_N_ATTACHMENTS 5), sparse body between; the plan
 *   workflow text comes from ./official/plan-workflow.ts (already ported).
 * @module @deepseek-ai/dsh-zcode-official/tools/reminders
 */

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildPlanModeSparseReminderBody, buildPlanModeFullReminderBody } from '../official/plan-workflow.ts'
import { localIsoDate } from '../env-live.ts'

const TODO_REMINDER_CONFIG = Object.freeze({
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
})

const PLAN_MODE_REMINDER_CONFIG = Object.freeze({
  TURNS_BETWEEN_ATTACHMENTS: 5,
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5,
})

/** Per-agent reminder bookkeeping (process-local, like the official runtime's). */
interface ReminderState {
  /** Assistant entries since the last todo/write (or since start). */
  turnsSinceTodoWrite: number
  /** Assistant entries since the last todo reminder. */
  turnsSinceTodoReminder: number
  /** How many plan-mode reminders have been attached (drives full vs sparse). */
  planReminderCount: number
  /** Human turns since the last plan reminder (official: real_user messages). */
  turnsSincePlanReminder: number
  /** Last turn number already counted for the plan counter (per human turn). */
  lastPlanCountedTurn: number
  /** Set when the agent exits plan mode; the next entry carries the exit reminder. */
  pendingPlanExit: boolean
  /** Local ISO date last seen at a pre-step (date-change reminder trigger). */
  lastSeenDate: string
  /** Whether the official currentDate anchor has been injected (first entry). */
  dateInjected: boolean
}

const states = new Map<string, ReminderState>()

/** Official turn-loop gate: the todo reminder only fires while TodoWrite is
 * visible in the agent's scope (shadow row name: 'todo_write'). When the
 * agent carries no inspectable tool registry, default to visible. */
function todoWriteVisible(agent: Agent): boolean {
  try {
    const ctxAny = (agent as unknown as { ctx?: { tools?: { get: (n: string, s?: unknown) => unknown } } }).ctx
    const tools = ctxAny?.tools
    if (tools === undefined) return true
    return tools.get('todo_write', agent) !== undefined
  } catch {
    return true
  }
}

function stateFor(agent: Agent): ReminderState {
  const key = String(agent.session.id)
  let s = states.get(key)
  if (s === undefined) {
    s = { turnsSinceTodoWrite: 0, turnsSinceTodoReminder: 0, planReminderCount: 0, turnsSincePlanReminder: 0, lastPlanCountedTurn: 0, pendingPlanExit: false, lastSeenDate: '', dateInjected: false }
    states.set(key, s)
  }
  return s
}

/** Called when the agent leaves plan mode (exit_plan_mode post-execute). */
export function notePlanExit(agent: Agent): void {
  stateFor(agent).pendingPlanExit = true
}

/** Official buildTodoReminderBody (verbatim, with the todo list rendered). */
function todoReminderBody(todos: Array<{ content: string; status: string; priority: string }>): string {
  const lines = [
    "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if it has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.",
  ]
  if (todos.length > 0) {
    // Official formatTodoListForReminder (runtime-reminders.ts): numbered
    // [status] lines; priority is not part of the reminder rendering.
    const currentTodos = todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join('\n')
    lines.push('', 'Here are the existing contents of your todo list:', '', currentTodos)
  }
  return lines.join('\n')
}

/**
 * Install the reminder listener on one agent's context.
 * @param agentCtx - the agent's scoped context (from agents.create setup or
 *   the preset mount joining the agent).
 */
export function installReminders(agentCtx: { on: (event: 'agent/pre-step', listener: (payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>) => unknown }, getTodos: (agent: Agent) => Promise<Array<{ content: string; status: string; priority: string }>> | undefined, isPlanMode: (agent: Agent) => boolean | Promise<boolean>): void {
  agentCtx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    signal.throwIfAborted()
    if (decision.kind === 'reject') return decision
    if (step === 1 && decision.messages.length === 0) return decision

    const state = stateFor(agent)
    // Official counting basis (getTodoReminderTurnCounts): every assistant
    // entry counts — each model response, including tool-call continuation
    // steps. Count every entering pre-step.
    state.turnsSinceTodoWrite++
    state.turnsSinceTodoReminder++
    state.turnsSincePlanReminder++

    const planMode = await isPlanMode(agent)
    if (!planMode) {
      // Official countRuntimeModeReminders is history-wide: re-entering plan
      // continues at N+1 (sparse), so planReminderCount is never reset.
      state.turnsSincePlanReminder = 0
    }

    const reminders: string[] = []

    // Official currentDate section rides meta_user (user-side) — mirror by
    // injecting the anchor as a first-entry user-side reminder.
    if (!state.dateInjected) {
      state.dateInjected = true
      state.lastSeenDate = localIsoDate()
      reminders.push(`# currentDate\nToday's date is ${state.lastSeenDate}.`)
    }

    // Date-change reminder (official buildDateChangeReminderBody, verbatim):
    // long-running sessions crossing midnight re-anchor the model's date.
    const today = localIsoDate()
    if (state.lastSeenDate !== '' && state.lastSeenDate !== today) {
      reminders.push(`The date has changed. Today's date is now ${today}. DO NOT mention this to the user explicitly because they are already aware.`)
    }
    state.lastSeenDate = today

    // Plan-mode exit reminder (official needsPlanModeExitReminder): attached
    // on the first entry after the agent leaves plan mode.
    if (state.pendingPlanExit && !planMode) {
      state.pendingPlanExit = false
      reminders.push(planModeExitReminderBody())
    }

    // Todo reminder: official cadence (TURNS_SINCE_WRITE 10 / BETWEEN 10).
    // Official turn-loop gate: skipped only while TodoWrite is invisible in
    // this agent's scope (plan mode keeps TodoWrite visible — the reminder
    // fires there too, mirroring the official behavior).
    if (state.turnsSinceTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE
        && state.turnsSinceTodoReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
        && todoWriteVisible(agent)) {
      const todos = (await getTodos(agent)) ?? []
      reminders.push(todoReminderBody(todos))
      state.turnsSinceTodoReminder = 0
    }

    // Plan-mode reminder: official semantics — the FIRST attachment is
    // immediate (no prior reminder found), then every TURNS_BETWEEN_ATTACHMENTS
    // (5) human turns; full on every FULL_EVERY_N (5)th attachment (1st/6th/…).
    if (planMode) {
      const due = state.planReminderCount === 0
        || state.turnsSincePlanReminder >= PLAN_MODE_REMINDER_CONFIG.TURNS_BETWEEN_ATTACHMENTS
      if (due) {
        state.planReminderCount++
        reminders.push(
          state.planReminderCount % PLAN_MODE_REMINDER_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
            ? buildPlanModeFullReminderBody()
            : buildPlanModeSparseReminderBody(),
        )
        state.turnsSincePlanReminder = 0
      }
    }

    if (reminders.length === 0) return decision

    const injected = reminders.map(text => createUserMessage({
      content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }],
      source: { kind: 'zcode-official:reminder', form: 'reminder' },
    }) as UserMessage)
    return { ...decision, messages: [...decision.messages, ...injected] }
  })
}

/** Official buildPlanModeExitReminderBody (runtime-reminders.ts, verbatim). */
function planModeExitReminderBody(): string {
  return [
    '## Exited Plan Mode',
    '',
    'You have exited plan mode. You can now make edits, run tools, and take actions.',
  ].join('\n')
}

/** Called by the todo tool row on every successful write. */
export function noteTodoWrite(agent: Agent): void {
  const s = stateFor(agent)
  s.turnsSinceTodoWrite = 0
  s.turnsSinceTodoReminder = 0
}

