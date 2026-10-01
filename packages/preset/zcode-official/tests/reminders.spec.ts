/** Reminder cadence tests: official constants TURNS_SINCE_WRITE=10,
 * TURNS_BETWEEN_REMINDERS=10, TURNS_BETWEEN_ATTACHMENTS=5, FULL_EVERY_N=5. */

import { describe, expect, it } from 'vitest'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { installReminders, noteTodoWrite } from '../src/tools/reminders.ts'

const SIGNAL = new AbortController().signal

type Listener = (payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

function harness(opts: { todos?: Array<{ content: string; status: string; priority: string }>; planMode?: boolean } = {}): { listener: Listener; agent: Agent; reminderTexts: string[] } {
  const reminderTexts: string[] = []
  const agent = { session: { id: `sess-${Math.random().toString(36).slice(2, 8)}` } } as unknown as Agent
  const listenerHolder: { listener?: Listener } = {}
  const fakeCtx = {
    on: (_event: string, fn: Listener) => { listenerHolder.listener = fn },
  }
  installReminders(
    fakeCtx as never,
    async () => opts.todos ?? [],
    async () => opts.planMode ?? false,
  )
  const listener = listenerHolder.listener!
  const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })
  const run = async (turn: number): Promise<PreStepDecision> => {
    const decision = await listener({ agent, turn, step: 1, signal: SIGNAL }, async () => ({ kind: 'enter' as const, messages: [{} as UserMessage] }))
    if (decision.kind === 'enter') {
      for (const m of decision.messages) {
        const blocks = ((m as UserMessage).content ?? []) as Array<{ type: string; text?: string }>
        for (const b of blocks) if (b.type === 'text' && b.text?.includes('<system-reminder>')) { reminderTexts.push(b.text) }
      }
    }
    return decision
  }
  return { listener, agent, reminderTexts, run }
}

describe('todo reminder cadence (official 10/10)', () => {
  it('T1: injects at the 10th turn, not before', async () => {
    const injectionTurns: number[] = []
    const texts: string[] = []
    const { listener, agent } = harness()
    const next = async (): Promise<PreStepDecision> => ({ kind: 'enter' as const, messages: [{} as UserMessage] })
    for (let turn = 1; turn <= 12; turn++) {
      const d = await listener({ agent, turn, step: 1, signal: SIGNAL }, next)
      if (d.kind === 'enter') {
        for (const m of d.messages) {
          const blocks = ((m as UserMessage).content ?? []) as Array<{ type: string; text?: string }>
          for (const b of blocks) if (b.type === 'text' && b.text?.includes('<system-reminder>')) texts.push(b.text)
        }
      }
      if (texts.length > injectionTurns.length) injectionTurns.push(turn)
    }
    expect(injectionTurns).toEqual([10])
    expect(texts[0]).toContain("TodoWrite tool hasn't been used")
  })

  it('T2: no repeat immediately after a reminder (TURNS_BETWEEN_REMINDERS=10)', async () => {
    const { run, reminderTexts } = harness()
    for (let turn = 1; turn <= 10; turn++) await run(turn)
    const count = reminderTexts.length
    await run(11)
    expect(reminderTexts.length).toBe(count)
  })
  it('T3: repeats 10 turns later', async () => {
    const { run, reminderTexts } = harness()
    for (let turn = 1; turn <= 10; turn++) await run(turn)
    expect(reminderTexts.length).toBe(1)
    for (let turn = 11; turn <= 19; turn++) await run(turn)
    expect(reminderTexts.length).toBe(1)
    await run(20)
    expect(reminderTexts.length).toBe(2)
  })
  it('T4: todo_write resets the cadence; todo list renders in the body', async () => {
    const { run, reminderTexts, agent } = harness({ todos: [{ content: 'task-a', status: 'in_progress', priority: 'high' }] })
    for (let turn = 1; turn <= 9; turn++) await run(turn)
    noteTodoWrite(agent)
    await run(10)
    expect(reminderTexts.length).toBe(0)
    for (let turn = 11; turn <= 19; turn++) await run(turn)
    await run(20)
    expect(reminderTexts.length).toBe(1)
    expect(reminderTexts[0]).toContain('task-a')
    // Official formatTodoListForReminder: numbered [status] lines, no priority.
    expect(reminderTexts[0]).toContain('1. [in_progress] task-a')
  })
})

describe('plan-mode reminder cadence (official 5/5)', () => {
  it('T5: full on the 1st attachment, sparse on the 6th turn (next due), official 5-turn gate', async () => {
    const { run, reminderTexts } = harness({ planMode: true })
    await run(1)
    expect(reminderTexts.length).toBe(1)
    expect(reminderTexts[0]).toContain('## Plan Workflow')
    expect(reminderTexts[0]).toContain('Phase 1: Initial Understanding')
    // Official gate: humanTurnsSinceReminder < 5 → no attachment on turns 2-5.
    for (let turn = 2; turn <= 5; turn++) await run(turn)
    expect(reminderTexts.length).toBe(1)
    await run(6)
    expect(reminderTexts.length).toBe(2)
    expect(reminderTexts[1]).toContain('Plan mode still active')
  })

  it('T6: plan mode does NOT suppress the todo reminder (official turn-loop has no plan gate)', async () => {
    const { run, reminderTexts } = harness({ planMode: true, todos: [{ content: 'x', status: 'pending', priority: 'low' }] })
    for (let turn = 1; turn <= 10; turn++) await run(turn)
    expect(reminderTexts.some(t => t.includes("TodoWrite tool hasn't been used"))).toBe(true)
  })
  it('T7: reminder messages carry the <system-reminder> wrapper and declared source', async () => {
    const { run, reminderTexts } = harness()
    for (let turn = 1; turn <= 10; turn++) await run(turn)
    expect(reminderTexts[0]).toContain('<system-reminder>')
    expect(reminderTexts[0]).toContain('</system-reminder>')
  })
})
