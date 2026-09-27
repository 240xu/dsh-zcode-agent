/**
 * Official-shape `ask_user_question` shadow row, ported from
 * zai-org/ZCode@872ad96 `apps/zcode-cli/packages/contracts/src/tools/
 * ask-user-question.ts` (header required max-12-chars chip, 2-4 options,
 * unique labels, no "Other" option, multiSelect camelCase, unique question
 * texts, optional per-option preview) delegating through
 * `ctx.userQuestions.ask()` with the official AskUserQuestion tool
 * description (tool/handlers/ask-user-question.ts, verbatim).
 *
 * Mapping to the DSH seam:
 * - official has no `id` — a uuid is generated per question and echoed in
 *   the answer (the model associates via question text, same as official).
 * - official `multiSelect` → seam `multiSelect` (native).
 * - official option `preview` → seam `detail` (the seam's rendered
 *   explanation field; preview content explains the focused option).
 * - seam answers carry `selected` label strings, matching the official
 *   answer-by-label contract.
 * @module @deepseek-ai/dsh-zcode-official/tools/ask-user-shadow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'

export const inject = ['tools', 'userQuestions'] as const

/** Official AskUserQuestion tool description (handlers/ask-user-question.ts, verbatim). */
export const ASK_USER_QUESTION_DESCRIPTION =
  [
    "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.",
    '',
    'Usage notes:',
    '- Users will always be able to select "Other" to provide custom text input',
    '- Use multiSelect: true to allow multiple answers to be selected for a question',
    '- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label',
    '',
    'Plan mode note: To switch into plan mode, use EnterPlanMode (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions — the user cannot see the plan until you call ExitPlanMode for approval.',
    '',
    "Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.",
    '',
    'Preview feature:',
    'Use the optional `preview` field on options when presenting concrete artifacts that users need to visually compare:',
    '- ASCII mockups of UI layouts or components',
    '- Code snippets showing different implementations',
    '- Diagram variations',
    '- Configuration examples',
    '',
    'Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).',
  ].join('\n') + '\n'

interface OfficialOption {
  label: string
  description?: string
  preview?: string
}

interface OfficialQuestion {
  question: string
  header: string
  options: OfficialOption[]
  multiSelect?: boolean
}

interface OfficialAskInput {
  questions: OfficialQuestion[]
}

function validateOfficial(input: OfficialAskInput): void {
  if (input.questions.length < 1 || input.questions.length > 4) {
    throw new Error('questions must contain 1-4 questions')
  }
  const texts = new Set<string>()
  for (const q of input.questions) {
    if (texts.has(q.question)) throw new Error('Question texts must be unique')
    texts.add(q.question)
    if (q.header.length > 12) throw new Error(`header must be at most 12 characters: ${JSON.stringify(q.header)}`)
    if (q.options.length < 2 || q.options.length > 4) {
      throw new Error(`options must have 2-4 entries for question ${JSON.stringify(q.question.slice(0, 40))}`)
    }
    const labels = new Set<string>()
    for (const option of q.options) {
      const label = option.label.trim().toLowerCase()
      if (label === 'other') throw new Error('Do not include an Other option; clients provide it automatically')
      if (labels.has(option.label)) throw new Error('Option labels must be unique within each question')
      labels.add(option.label)
      if (option.preview !== undefined && q.multiSelect === true) {
        throw new Error('previews are only supported for single-select questions (not multiSelect)')
      }
    }
  }
}

export function registerAskUserShadow(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'ask_user_question',
    description: ASK_USER_QUESTION_DESCRIPTION,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to ask the user before continuing.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            question: {
              type: 'string',
              required: true,
              description: 'The complete question to ask the user. Should be clear, specific, and end with a question mark. If multiSelect is true, phrase it accordingly.',
            },
            header: {
              type: 'string',
              required: true,
              description: 'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
            },
            options: {
              type: 'array',
              required: true,
              description: "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'Explanation of what this option means or what will happen if chosen.' },
                  preview: { type: 'string', description: 'Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options.' },
                },
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          questions: { type: 'array', required: true },
          answers: { type: 'array', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    async execute(args: OfficialAskInput, exec) {
      validateOfficial(args)
      const result = await ctx.userQuestions.ask({
        questions: args.questions.map(question => ({
          // Official has no caller id; mint one so the seam can echo answers.
          id: crypto.randomUUID(),
          question: question.question,
          header: question.header,
          options: question.options.map(option => ({
            label: option.label,
            // Official `preview` degrades onto the seam's rendered `detail`
            // field when description is absent (the seam renders detail but
            // has no preview pane).
            ...option.description !== undefined ? { description: option.description } : {},
            ...option.preview !== undefined && option.description === undefined
              ? { detail: option.preview }
              : {},
          })),
          ...question.multiSelect !== undefined ? { multiSelect: question.multiSelect } : {},
        })),
        ...exec.agent !== undefined ? { agent: exec.agent } : {},
        signal: exec.signal,
      })
      return {
        questions: args.questions.map(question => ({ question: question.question })),
        answers: result.answers.map(answer => ({
          ...answer,
        })),
      }
    },
  }))
}
