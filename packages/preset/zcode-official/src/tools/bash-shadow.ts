/**
 * Official-shape `bash` shadow row, ported from zai-org/ZCode@872ad96
 * `apps/zcode-cli/packages/contracts/src/tools/bash.ts` (optional `timeout`
 * in ms capped at 600000, optional `description`, `run_in_background`).
 *
 * Delegation uses the cross-layer definition lookup (`ctx.tools.get('bash',
 * undefined)` resolves the GLOBAL-layer core tool, bypassing this preset
 * scope's own shadow — the recursion hazard that killed the previous
 * scheduler.prepare attempt). The core definition receives this row's
 * ToolRunContext, so sandbox policy, shellEnv, jobs and cancellation all
 * pass through unchanged.
 * @module @deepseek-ai/dsh-zcode-official/tools/bash-shadow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const inject = ['tools'] as const

/** Official MAX_BASH_TIMEOUT_MS (contracts/tools/bash.ts). */
export const MAX_BASH_TIMEOUT_MS = 600_000

interface OfficialBashArgs {
  command: string
  timeout?: number
  description?: string
  run_in_background?: boolean
}

/** Minimal structural mirror of a tool definition for the nested call. */
interface CoreDefinition {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

export function registerBashShadow(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'bash',
    // Model-facing description comes from the official tool-semantics
    // section; the registry only needs a stable one-line summary.
    description: 'Executes a bash command and returns its output.',
    parameters: {
      command: { type: 'string', required: true, description: 'The command to execute' },
      timeout: {
        type: 'number',
        description: `Optional timeout in milliseconds (max ${MAX_BASH_TIMEOUT_MS})`,
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).',
      },
      run_in_background: {
        type: 'boolean' as const,
        description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) } as ContentBlock],
    },
    async execute(args: OfficialBashArgs, exec) {
      if (args.command.trim().length === 0) {
        throw new Error('invalid command: expected a non-empty string')
      }
      if (args.timeout !== undefined && (!Number.isFinite(args.timeout) || args.timeout <= 0 || args.timeout > MAX_BASH_TIMEOUT_MS)) {
        throw new Error(`invalid timeout: expected a positive number up to ${MAX_BASH_TIMEOUT_MS}, got ${JSON.stringify(args.timeout)}`)
      }
      // Cross-layer lookup: `undefined` scope = global layer only, where the
      // core bash lives. Re-resolved per call so tools/change (jobs injection
      // re-register) is honored.
      const core = (ctx.tools as unknown as { get: (name: string, scope: undefined) => CoreDefinition | undefined }).get('bash', undefined)
      if (core === undefined || core.execute === undefined) {
        throw new Error('bash shadow: core bash definition not found at the global layer')
      }
      // Defense: the global-layer definition must not be this shadow.
      if ((core as unknown as { isZcodeShadow?: boolean }).isZcodeShadow) {
        throw new Error('bash shadow: global-layer resolution hit the shadow itself; refusing to recurse')
      }
      const nested = await core.execute(
        {
          command: args.command,
          // DSH requires a non-empty description for the permission UI; the
          // official schema makes it optional — synthesize a neutral one.
          description: args.description?.trim() || 'Run bash command',
          ...(args.timeout !== undefined ? { timeoutMs: args.timeout } : {}),
          ...(args.run_in_background !== undefined ? { run_in_background: args.run_in_background } : {}),
        },
        exec,
      )
      return nested as Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>
    },
  }))
}
