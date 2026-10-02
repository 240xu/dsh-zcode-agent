/**
 * Official-shape todo tools: `todo_write` + `todo_read`, ported from
 * zai-org/ZCode@872ad96 `apps/zcode-cli/packages/contracts/src/tools/todo.ts`
 * and `apps/zcode-cli/packages/core/src/tool/handlers/todo.ts`.
 *
 * The official TodoItem carries a per-item `priority` ("high" | "medium" |
 * "low"); DSH's core `todo/write` event and `todos` projection are
 * priority-free (core type contract: no id/priority). This row therefore
 * shadows the core `todo_write` inside the preset scope with the official
 * schema and output shapes (oldTodos/todos/summary), writing
 * priority-stripped snapshots through the same `todo/write` event while the
 * priorities ride a session sidecar. `todo_read` (official output `{todos}`)
 * folds the session's `todo/write` events through the core projection and
 * re-attaches sidecar priorities, so reads survive process restarts and
 * adopted sessions (a sidecar miss renders priority "medium", the official
 * default).
 * @module @deepseek-ai/dsh-zcode-official/tools/todo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: pulls in the SessionEventMap('todo/write') and
// SessionProjectionMap('todos') augmentations declared by the todo domain.
import type {} from './todo-augmentations.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools', 'sessionProjections'] as const

const STATUSES = ['pending', 'in_progress', 'completed'] as const
const PRIORITIES = ['high', 'medium', 'low'] as const

/** The official TodoItem (contracts/tools/todo.ts TodoItemSchema). */
export interface OfficialTodoItem {
  readonly content: string
  readonly status: (typeof STATUSES)[number]
  readonly priority: (typeof PRIORITIES)[number]
}

/** Official TodoWriteOutput (contracts/tools/todo.ts). */
export interface OfficialTodoWriteOutput {
  readonly oldTodos: readonly OfficialTodoItem[]
  readonly todos: readonly OfficialTodoItem[]
  readonly summary: { readonly total: number; readonly pending: number; readonly inProgress: number; readonly completed: number }
}

/** Official TodoReadOutput. */
export interface OfficialTodoReadOutput {
  readonly todos: readonly OfficialTodoItem[]
}

/** Session sidecar: agent id -> content -> priority (priorities only). */
const priorities = new Map<string, Map<string, (typeof PRIORITIES)[number]>>()

function sidecarFor(agentKey: string): Map<string, (typeof PRIORITIES)[number]> {
  let m = priorities.get(agentKey)
  if (m === undefined) {
    m = new Map()
    priorities.set(agentKey, m)
  }
  return m
}

function summarize(todos: readonly OfficialTodoItem[]): OfficialTodoWriteOutput['summary'] {
  return {
    total: todos.length,
    pending: todos.filter(t => t.status === 'pending').length,
    inProgress: todos.filter(t => t.status === 'in_progress').length,
    completed: todos.filter(t => t.status === 'completed').length,
  }
}

/** Official TodoWrite provider description (handlers/todo.ts, verbatim). */
export const TODO_WRITE_DESCRIPTION = `Create and update a task list for the current session. The list is rendered to the user as your working plan.

- Each todo has \`content\`, \`status\` ("pending" | "in_progress" | "completed"), and \`priority\` ("high" | "medium" | "low").
- Send the full list each call; it replaces the previous one.
- Keep one item \`in_progress\` at a time and mark it \`completed\` when done.`

/** Official TodoRead provider description (handlers/todo.ts, verbatim). */
export const TODO_READ_DESCRIPTION = 'Read the current session todo list'

/** Sidecar priority lookup for reminder rendering (defaults to 'medium'). */
export function todoPriorityOf(agent: Agent, content: string): 'high' | 'medium' | 'low' {
  return priorities.get(String(agent.session.id))?.get(content) ?? 'medium'
}

async function readTodos(ctx: Context, agent: Agent): Promise<OfficialTodoItem[]> {
  const snapshot = ctx.sessionProjections.snapshot(agent.session, ['todos'])
  const stripped = (snapshot.values['todos'] ?? []) as Array<{ content: string; status: string }>
  const sidecar = priorities.get(String(agent.session.id))
  return stripped.map(item => ({
    content: item.content,
    status: (STATUSES.includes(item.status as (typeof STATUSES)[number])
      ? item.status
      : 'pending') as OfficialTodoItem['status'],
    priority: sidecar?.get(item.content) ?? 'medium',
  }))
}

export function registerTodoTools(ctx: Context): void {
  // todo_write: shadows the core row inside the preset scope with the official
  // schema/output; the persisted event stays priority-stripped.
  ctx.tools.register(defineTool({
    name: 'todo_write',
    description: TODO_WRITE_DESCRIPTION,
    parameters: {
      todos: {
        type: 'array',
        required: true,
        description: 'The complete updated todo list. At most one item may be in_progress at a time.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true, description: 'Brief description of the task' },
            status: { type: 'string', required: true, enum: [...STATUSES], description: 'Current status of the task' },
            priority: { type: 'string', required: true, enum: [...PRIORITIES], description: 'Priority level of the task' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          oldTodos: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true },
                priority: { type: 'string', required: true },
              },
            },
          },
          todos: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true },
                priority: { type: 'string', required: true },
              },
            },
          },
          summary: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              total: { type: 'integer', required: true },
              pending: { type: 'integer', required: true },
              inProgress: { type: 'integer', required: true },
              completed: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated todo list: ${value.summary.pending} pending, ${value.summary.inProgress} in progress, ${value.summary.completed} completed.`,
      }],
    },
    async execute(args: { todos: Array<{ content: string; status: string; priority: string }> }, exec) {
      if (!exec.agent) throw new Error('todo_write requires an owning agent session')
      const agentKey = String(exec.agent.session.id)
      // Validate exactly like the official row: wholesale replace, duplicate
      // rejection, and the official schema's one-in-progress rule.
      const seen = new Set<string>()
      let active = 0
      const todos: OfficialTodoItem[] = []
      for (const item of args.todos) {
        if (!STATUSES.includes(item.status as (typeof STATUSES)[number])) {
          throw new Error(`invalid status: ${JSON.stringify(item.status)}`)
        }
        if (!PRIORITIES.includes(item.priority as (typeof PRIORITIES)[number])) {
          throw new Error(`invalid priority: ${JSON.stringify(item.priority)}`)
        }
        if (seen.has(item.content)) {
          throw new Error(`invalid todos: duplicate content ${JSON.stringify(item.content)}`)
        }
        seen.add(item.content)
        if (item.status === 'in_progress') active++
        todos.push({
          content: item.content,
          status: item.status as OfficialTodoItem['status'],
          priority: item.priority as OfficialTodoItem['priority'],
        })
      }
      if (active > 1) throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)

      const oldTodos = await readTodos(ctx, exec.agent)

      // Persist the priority-stripped snapshot through the core event; the
      // projection/view/UI contract stays untouched.
      exec.agent.session.append('todo/write', {
        todos: todos.map(todo => ({ content: todo.content, status: todo.status })),
      })
      const sidecar = sidecarFor(agentKey)
      sidecar.clear()
      for (const todo of todos) sidecar.set(todo.content, todo.priority)

      return { oldTodos, todos, summary: summarize(todos) }
    },
    presentCall: args => ({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: args.todos }),
  }))

  // todo_read: official read face (handlers/todo.ts: "Read the current
  // session todo list").
  ctx.tools.register(defineTool({
    name: 'todo_read',
    description: TODO_READ_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true },
                priority: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.todos.length === 0
          ? 'The session todo list is empty.'
          : `[${value.todos.map(t => `${JSON.stringify(t.content)}, ${t.status}, ${t.priority}`).join('\n')}]`,
      }],
    },
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('todo_read requires an owning agent session')
      return { todos: await readTodos(ctx, exec.agent) }
    },
    presentCall: () => ({ card: 'generic', title: 'Read todo list', kind: 'other', rawInput: {} }),
  }))
}
