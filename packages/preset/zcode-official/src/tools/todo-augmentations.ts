/**
 * Type-face augmentations for the official todo tools, mirroring the todo
 * domain's declarations (packages/todo/tool-todo/src/types.ts) so this
 * package is self-contained without a tool-todo dependency edge:
 * - SessionEventMap gains `todo/write` (whole-list snapshot).
 * - SessionProjectionMap/StateMap gain `todos`.
 * Structurally identical to the core row's shapes (content + status).
 * @module @deepseek-ai/dsh-zcode-official/tools/todo-augmentations
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Priority-stripped todo item shape the core `todo/write` event carries. */
interface StrippedTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-list snapshot; latest write wins on replay. Log-only UI state. */
    'todo/write': { todos: StrippedTodoItem[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    todos: StrippedTodoItem[] | null
  }
  interface SessionProjectionMap {
    /** The agent's current whole todo list, or null before the first write. */
    todos: StrippedTodoItem[] | null
  }
}

export {}

/** Reminder user-message source, following the agent-instructions pattern. */
interface ZcodeReminderSource {
  kind: 'zcode-official:reminder'
  form: 'reminder'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'zcode-official:reminder': ZcodeReminderSource
  }
}
