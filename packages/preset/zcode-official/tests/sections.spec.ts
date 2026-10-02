/** Alignment tests: the ported official text must carry official anchors. */

import { describe, expect, it } from 'vitest'
import { buildSections } from '../src/index.ts'
import {
  buildExploreAgentPrompt,
  buildGeneralPurposeSystemPrompt,
  buildSubagentCommonNotes,
  EXPLORE_AGENT_ALLOWED_TOOLS,
  builtInAgentProfiles,
  formatAgentProfilesForPrompt,
} from '../src/official/subagents.ts'
import {
  buildAgentProviderDescription,
  buildBashProviderDescription,
  buildReadDescription,
  buildWebSearchProviderDescription,
} from '../src/official/tool-descriptions.ts'
import { buildMemoryText } from '../src/official/memory.ts'

const CWD = '/tmp/zcode-official-test'

describe('official identity + harness', () => {
  it('carries the official anchors', () => {
    const s = buildSections({ cwd: CWD })
    const identity = s.find((x) => x.name === 'zcode-official:identity')!
    expect(identity.text).toContain('# Harness')
    expect(identity.text).toContain('Text you output outside of tool use is displayed to the user')
    expect(identity.text).toContain('Refuse requests for destructive techniques')
  })
})

describe('official subagent definitions', () => {
  it('Explore uses the non-embedded branch', () => {
    const p = buildExploreAgentPrompt({ embeddedSearchEnabled: false })
    expect(p).toContain('READ-ONLY MODE - NO FILE MODIFICATIONS')
    expect(p).toContain('- Use Glob for broad file pattern matching')
    expect(p).toContain('- Use Grep for searching file contents with regex')
    expect(p).not.toContain('`find` via Bash')
  })
  it('general-purpose persona matches official', () => {
    expect(buildGeneralPurposeSystemPrompt()).toContain('You are an agent for ZCode CLI.')
  })
  it('carries the official common notes', () => {
    const n = buildSubagentCommonNotes()
    expect(n).toContain('cwd reset between bash calls')
    expect(n).toContain('avoid using emojis')
    expect(n).toContain('Do not use a colon before tool calls')
    expect(n).toContain('Do NOT Write report/summary/findings/analysis .md files')
  })
  it('Explore tool list equals the official non-embedded set', () => {
    expect([...EXPLORE_AGENT_ALLOWED_TOOLS]).toEqual(['Bash', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'TodoWrite'])
  })
  it('agent roster formatting matches official shape', () => {
    const roster = formatAgentProfilesForPrompt(builtInAgentProfiles())!
    expect(roster).toContain('Available agent types and the tools they have access to:')
    expect(roster).toContain('- general-purpose: General-purpose agent for researching complex questions')
    expect(roster).toContain('(Tools: *)')
    expect(roster).toContain('- Explore: Read-only search agent for broad fan-out searches')
    expect(roster).toContain('(Tools: Glob, Grep, Read, Bash, WebFetch, WebSearch, TodoWrite)')
  })
})

describe('official tool description builders', () => {
  it('websearch renders the current month', () => {
    const d = buildWebSearchProviderDescription(new Date('2026-09-23T00:00:00Z'))
    expect(d).toContain('The current month is September 2026')
  })
  it('agent description carries official sections and no workflow tools', () => {
    const d = buildAgentProviderDescription('roster')
    expect(d).toContain('## When to use')
    expect(d).toContain("Once you've delegated a search, don't also run it yourself")
    expect(d).not.toContain('CreateWorkflow')
  })
  it('bash description carries the official timeouts', () => {
    const d = buildBashProviderDescription({ defaultTimeoutMs: 120_000, maxTimeoutMs: 600_000 })
    expect(d).toContain('default 120000, max 600000')
    expect(d).toContain('# Git')
  })
  it('read description carries 2000-line default', () => {
    expect(buildReadDescription()).toContain('Reads up to 2000 lines by default.')
  })
})

describe('official memory section', () => {
  it('uses the file-based memory format', () => {
    const m = buildMemoryText('/x/.zcode/memory')
    expect(m).toContain('persistent file-based memory')
    expect(m).toContain('MEMORY.md')
    expect(m).toContain('type: user | feedback | project | reference')
    expect(m).toContain('[[their-name]]')
  })
})

describe('section assembly', () => {
  it('emits the full ordered section list', () => {
    const s = buildSections({ cwd: CWD })
    const names = s.map((x) => x.name)
    for (const n of ['zcode-official:cli-prefix', 'zcode-official:identity', 'zcode-official:dynamic-behavior', 'zcode-official:context-management', 'zcode-official:env', 'zcode-official:memory', 'zcode-official:tool-semantics']) {
      expect(names).toContain(n)
    }
    const orders = s.map((x) => x.order)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })
  it('tool semantics section maps every DSH tool name', () => {
    const s = buildSections({ cwd: CWD })
    const t = s.find((x) => x.name === 'zcode-official:tool-semantics')!
    for (const zc of ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite', 'Skill', 'Agent', 'Task', 'GoalRead', 'AskUserQuestion']) {
      expect(t.text).toContain(`## ${zc}`)
    }
    expect(t.text).toContain('CreateWorkflow')
  })
})
