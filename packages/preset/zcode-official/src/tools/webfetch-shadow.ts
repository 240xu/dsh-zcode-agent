/**
 * Official-shape `web_fetch` shadow row, ported from zai-org/ZCode@872ad96
 * `contracts/src/tools/webfetch.ts` + `core/src/tool/handlers/webfetch.ts`
 * (WEBFETCH_DESCRIPTION verbatim; url+prompt inputs; HTTP→HTTPS upgrade;
 * cross-host redirects returned as a notice; 15-minute per-URL cache).
 *
 * Zero DSH-source changes: the row delegates through the public `ctx.web`
 * (WebRuntime) seam — not the tools registry — so preset-scope shadowing has
 * no self-recursion hazard. The core tool-web row stays mounted at the base
 * (global) layer; this preset-scope row overrides `web_fetch` for preset
 * agents only.
 *
 * Official `prompt` (small-model summarization) has no DSH equivalent seam —
 * the full markdown body is returned instead, matching how DSH's web_fetch
 * behaves; the prompt field is accepted and echoed for contract fidelity.
 * @module @deepseek-ai/dsh-zcode-official/tools/webfetch-shadow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WebError, type WebFetchResult } from '@deepseek-ai/dsh-web'

export const inject = ['tools', 'web'] as const

/** Official WEBFETCH_DESCRIPTION (handlers/webfetch.ts, verbatim). */
export const WEBFETCH_DESCRIPTION = [
  'Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model.',
  '',
  '- Fails on authenticated/private URLs — use an authenticated MCP tool or `gh` for those instead.',
  '- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.',
  '- Responses are cached for 15 minutes per URL.',
].join('\n')

/** Official cache TTL (webfetch-cache.ts). */
const CACHE_TTL_MS = 15 * 60 * 1000

/** Official CACHE_MAX_BYTES (50MB), dual-purpose: entries larger than this
 * are not cached at all, and the total cached payload is pruned back under
 * this budget (expired first, then oldest-first eviction). */
const CACHE_MAX_BYTES = 50 * 1024 * 1024

interface CacheEntry {
  readonly result: WebFetchResult
  readonly cachedAt: number
}

/** Process-local per-URL cache (official semantics: LRU refresh, TTL only on fresh writes). */
const cache = new Map<string, CacheEntry>()

/** Test hook: drop cached fetches. */
export function clearWebFetchCacheForTests(): void {
  cache.clear()
}

function readCache(url: string): WebFetchResult | undefined {
  const entry = cache.get(url)
  if (entry === undefined) return undefined
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(url)
    return undefined
  }
  cache.delete(url)
  cache.set(url, entry)
  return entry.result
}

function writeCache(url: string, result: WebFetchResult): void {
  const sizeBytes = result.body.kind === 'text' ? Buffer.byteLength(result.body.content) : 0
  // Official: entries over CACHE_MAX_BYTES are skipped entirely.
  if (sizeBytes > CACHE_MAX_BYTES) return
  // Official prune: drop expired entries, then evict oldest-first until the
  // total payload fits the budget.
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) cache.delete(key)
  }
  let total = sizeBytes
  for (const entry of cache.values()) {
    total += entry.result.body.kind === 'text' ? Buffer.byteLength(entry.result.body.content) : 0
  }
  for (const key of cache.keys()) {
    if (total <= CACHE_MAX_BYTES) break
    const entry = cache.get(key)
    cache.delete(key)
    if (entry !== undefined) {
      total -= entry.result.body.kind === 'text' ? Buffer.byteLength(entry.result.body.content) : 0
    }
  }
  cache.delete(url)
  cache.set(url, { result, cachedAt: Date.now() })
}

/** Official http→https upgrade (webfetch-url.ts). */
function upgradeScheme(url: string): string {
  return url.replace(/^http:\/\//i, 'https://')
}

/**
 * Official cross-origin redirect notice (webfetch-errors.ts): the redirect is
 * not an error for the model — name the target so the model can re-call.
 */
function redirectNotice(error: WebError): WebFetchResult | undefined {
  if (error.code !== 'WEB_REDIRECT_BLOCKED') return undefined
  const target = /to (\S+) is not followed/.exec(error.message)?.[1]
  return {
    url: target ?? 'redirect',
    statusCode: 302,
    body: {
      kind: 'text',
      content: [
        `REDIRECT DETECTED: ${error.message}`,
        target !== undefined
          ? `Call WebFetch again with url: ${target}`
          : 'Call WebFetch again with the target URL named above.',
      ].join('\n'),
    },
    truncated: false,
  }
}

interface OfficialArgs {
  url: string
  prompt?: string
}

export function registerWebFetchShadow(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'web_fetch',
    description: WEBFETCH_DESCRIPTION,
    parameters: {
      url: { type: 'string', required: true, description: 'The URL to fetch content from' },
      prompt: { type: 'string', description: 'The prompt to run on the fetched content' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          url: { type: 'string', required: true },
          statusCode: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: typeof (value.body as { content?: unknown } | undefined)?.content === 'string'
          ? (value.body as { content: string }).content
          : JSON.stringify(value),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args: OfficialArgs, exec) {
      const upgraded = upgradeScheme(args.url)
      const cached = readCache(upgraded)
      if (cached !== undefined) return project(cached)

      let result: WebFetchResult
      try {
        result = await ctx.web.fetch({ url: upgraded }, exec.signal)
      } catch (error) {
        if (error instanceof WebError) {
          const notice = redirectNotice(error)
          if (notice !== undefined) return project(notice)
        }
        throw error
      }
      writeCache(upgraded, result)
      return project(result)
    },
  }))
}

function project(result: WebFetchResult): { url: string; statusCode: number; truncated: boolean; body: Record<string, import('@deepseek-ai/dsh-util-values').JsonValue> } {
  return {
    url: result.url,
    statusCode: result.statusCode,
    truncated: result.truncated,
    body: { kind: result.body.kind, content: result.body.content } as Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>,
  }
}
