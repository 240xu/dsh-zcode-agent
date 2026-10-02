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
 *
 * The model-facing render replicates `@deepseek-ai/dsh-tool-bash`'s
 * `render.ts` (`renderResult` / `renderPromoted` / background line) instead
 * of JSON.stringify: those functions are not exported from that package's
 * entry, so the shadow ports the text verbatim and imports the shared
 * sandbox markers from `@deepseek-ai/dsh-sandbox` to keep the vocabulary
 * single-sourced.
 * @module @deepseek-ai/dsh-zcode-official/tools/bash-shadow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { ESCALATION_TARGETS, escalationHintMarker, sandboxDenialMarker, type SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-shell'

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

/** Canonical output side of one collected stream ({text, truncated, spillPath?}). */
interface ShadowStream {
  text: string
  truncated: boolean
  spillPath?: string
}

/** Structural mirror of the core foreground value (canonicalBashResult shape). */
interface ShadowForegroundValue {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: ShadowStream
  stderr: ShadowStream
  sandbox?: { mode: string; denied: boolean; enforcement?: string; runnerFailed?: boolean }
  stopped?: string
}

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function shadowStreamText(output: ShadowStream): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/** Verbatim port of `@deepseek-ai/dsh-tool-bash` render.ts `renderResult`. */
function shadowRenderResult(result: ShadowForegroundValue, escalationModes: readonly SandboxMode[]): string {
  const out = shadowStreamText(result.stdout)
  const err = shadowStreamText(result.stderr)

  let body = out
  if (err.length > 0) {
    // Single newline between sections (stdout usually ends with one already).
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'

  const markers: string[] = []
  // Keep the exit marker last because parseExitStatus anchors there.
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode as SandboxMode))
    // Hint only when the composition exposes escalation, before the final exit marker.
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker('command'))
    }
  }
  // A command may trap SIGTERM and exit 0 after timeout; still report interruption.
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  // A kill from outside the call (the human stopping its job) is not a
  // command failure: the reason tells the model not to retry.
  if (result.stopped !== undefined) markers.push(`[stopped: ${result.stopped}]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body

  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/** Verbatim port of render.ts `renderPromoted`. */
function shadowRenderPromoted(promoted: { jobId: string; timeoutMs: number; output: string }): string {
  const body = promoted.output.length > 0
    ? promoted.output.endsWith('\n') ? promoted.output : `${promoted.output}\n`
    : ''
  return `${body}[still running after ${promoted.timeoutMs}ms; moved to background job ${promoted.jobId}]\n`
    + 'The command keeps running in the background. You will be notified when it finishes; '
    + 'read newer output with job_output, stop it with job_kill.'
}

/**
 * Branch on the core canonical value kind, matching the core tool's own
 * `output.render`: background acknowledgements, promoted hand-offs, and
 * foreground terminals render their human-readable text instead of JSON.
 */
export function renderShadowValue(value: unknown, escalationModes: readonly SandboxMode[]): string {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    const record = value as Record<string, unknown>
    if (record.kind === 'background' && 'jobId' in record) {
      return `started background job ${String(record.jobId)}`
    }
    if (record.kind === 'promoted' && 'jobId' in record && 'timeoutMs' in record) {
      return shadowRenderPromoted({
        jobId: String(record.jobId),
        timeoutMs: Number(record.timeoutMs),
        output: typeof record.output === 'string' ? record.output : '',
      })
    }
  }
  return shadowRenderResult(value as ShadowForegroundValue, escalationModes)
}

export function registerBashShadow(ctx: Context): void {
  // Mirror the core tool's escalation-mode derivation: the escalation hint
  // rides a denial only when the composition actually advertises a confining
  // executor; a composition without one renders the bare denial marker.
  const shellExecutor = ctx.get('shell') as { sandboxMode?: SandboxMode } | undefined
  const escalationModes: readonly SandboxMode[] = shellExecutor?.sandboxMode === undefined
    ? []
    : ESCALATION_TARGETS
  const ownDefinition = defineTool({
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
        description: [
          'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.',
          '',
          'For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):',
          '- ls → "List files in current directory"',
          '- git status → "Show working tree status"',
          '- npm install → "Install package dependencies"',
          '',
          'For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:',
          '- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"',
          '- git reset --hard origin/main → "Discard all local changes and match remote main"',
          "- curl -s url | jq '.data[]' → \"Fetch JSON from URL and extract data array elements\"",
        ].join('\n'),
      },
      run_in_background: {
        type: 'boolean' as const,
        description: 'Set to true to run this command in the background.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderShadowValue(value, escalationModes) } as ContentBlock],
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
  })
  ctx.tools.register(ownDefinition)
}
