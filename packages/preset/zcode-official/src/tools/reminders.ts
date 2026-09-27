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
  /** Assistant turns since the last todo/write (or since start). */
  turnsSinceTodoWrite: number
  /** Assistant turns since the last todo reminder. */
  turnsSinceTodoReminder: number
  /** How many plan-mode reminders have been attached (drives full vs sparse). */
  planReminderCount: number
  /** Assistant turns since the last plan reminder. */
  turnsSincePlanReminder: number
}

const states = new Map<string, ReminderState>()

function stateFor(agent: Agent): ReminderState {
  const key = String(agent.session.id)
  let s = states.get(key)
  if (s === undefined) {
    s = { turnsSinceTodoWrite: 0, turnsSinceTodoReminder: 0, planReminderCount: 0, turnsSincePlanReminder: 0 }
    states.set(key, s)
  }
  return s
}

function resetCountersOnPlanMode(s: ReminderState): void {
  s.planReminderCount = 0
  s.turnsSincePlanReminder = 0
}

/** Official buildTodoReminderBody (verbatim, with the todo list rendered). */
function todoReminderBody(todos: Array<{ content: string; status: string; priority: string }>): string {
  const lines = [
    "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if it has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.",
  ]
  if (todos.length > 0) {
    const currentTodos = `[${todos.map(t => `${JSON.stringify(t.content)}, ${t.status}, ${t.priority}`).join('\n')}]`
    lines.push('', 'Here are the existing contents of your todo list:', '', currentTodos)
  }
  return lines.join('\n')
}

/**
 * Install the reminder listener on one agent's context.
 * @param agentCtx - the agent's scoped context (from agents.create setup or
 *   the preset mount joining the agent).
 */
export function installReminders(agentCtx: { on: (event: 'agent/pre-step', listener: (payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>) => unknown }, getTodos: (agent: Agent) => Promise<Array<{ content: string; status: string; priority: string }>> | undefined, isPlanMode: (agent: Agent) => boolean): void {
  agentCtx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    signal.throwIfAborted()
    if (decision.kind === 'reject') return decision
    if (step === 1 && decision.messages.length === 0) return decision

    const state = stateFor(agent)
    const planMode = isPlanMode(agent)
    if (!planMode) resetCountersOnPlanMode(state)

    const reminders: string[] = []

    // Todo reminder: official cadence (10/10) — skip entirely in plan mode,
    // mirroring the official gate (plan-mode turns do not nag about todos).
    if (!planMode && state.turnsSinceTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE
        && state.turnsSinceTodoReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS) {
      const todos = (await getTodos(agent)) ?? []
      reminders.push(todoReminderBody(todos))
      state.turnsSinceTodoReminder = 0
    }

    // Plan-mode reminder: full on the 1st/6th/…th attachment, sparse between.
    if (planMode && state.turnsSincePlanReminder >= PLAN_MODE_REMINDER_CONFIG.TURNS_BETWEEN_ATTACHMENTS) {
      state.planReminderCount++
      reminders.push(
        state.planReminderCount % PLAN_MODE_REMINDER_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
          ? buildPlanModeFullReminderBody()
          : buildPlanModeSparseReminderBody(),
      )
      state.turnsSincePlanReminder = 0
    }

    if (reminders.length === 0) return decision

    const injected = reminders.map(text => createUserMessage({
      content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }],
      source: { kind: 'zcode-official:reminder', form: 'reminder' },
    }) as UserMessage)
    return { ...decision, messages: [...decision.messages, ...injected] }
  })
}

/** Called by the todo tool row on every successful write. */
export function noteTodoWrite(agent: Agent): void {
  const s = stateFor(agent)
  s.turnsSinceTodoWrite = 0
  s.turnsSinceTodoReminder = 0
}

/** Called on every admitted assistant step (turn boundary bookkeeping). */
export function noteTurnCompleted(agent: Agent, opts: { todoWrittenThisTurn: boolean }): void {
  const s = stateFor(agent)
  if (opts.todoWrittenThisTurn) {
    s.turnsSinceTodoWrite = 0
  } else {
    s.turnsSinceTodoWrite++
  }
  s.turnsSinceTodoReminder++
  s.turnsSincePlanReminder++
}
