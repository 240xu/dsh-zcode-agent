/** Alignment tests for the official todo + Agent tool rows. */

import { describe, expect, it } from 'vitest'
import {
  TODO_WRITE_DESCRIPTION,
  TODO_READ_DESCRIPTION,
} from '../src/tools/todo.ts'
import {
  agentToolDescription,
  renderAgentResult,
  routeAgentType,
  unknownAgentTypeError,
  childShapes,
  ZCODE_AGENT_TYPES,
} from '../src/tools/agent.ts'

describe('official todo tool rows', () => {
  it('carries the official TodoWrite description with priority', () => {
    expect(TODO_WRITE_DESCRIPTION).toContain('`priority` ("high" | "medium" | "low")')
    expect(TODO_WRITE_DESCRIPTION).toContain('Keep one item `in_progress` at a time')
  })
  it('todo_read description matches official', () => {
    expect(TODO_READ_DESCRIPTION).toBe('Read the current session todo list')
  })
})

describe('official Agent multiplexer', () => {
  it('description carries the official roster + When-to-use, no CreateWorkflow', () => {
    const d = agentToolDescription()
    expect(d).toContain('- general-purpose: General-purpose agent for researching complex questions')
    expect(d).toContain('- Explore: Read-only search agent for broad fan-out searches')
    expect(d).toContain('(Tools: Glob, Grep, Read, Bash, WebFetch, WebSearch, TodoWrite)')
    expect(d).toContain('## When to use')
    expect(d).toContain("Once you've delegated a search, don't also run it yourself")
    expect(d).not.toContain('CreateWorkflow')
  })
  it('routes subagent_type exactly like the official registry', () => {
    expect(routeAgentType(undefined)).toBe('general-purpose')
    expect(routeAgentType('general-purpose')).toBe('general-purpose')
    expect(routeAgentType('Explore')).toBe('Explore')
    expect(() => routeAgentType('nope')).toThrow(unknownAgentTypeError('nope'))
  })
  it('registry type list matches official order', () => {
    expect([...ZCODE_AGENT_TYPES]).toEqual(['general-purpose', 'Explore'])
  })
  it('Explore child filter maps official tools to DSH names', () => {
    const shapes = childShapes('/tmp')
    expect(shapes.Explore.toolFilter.allow).toEqual(['bash', 'glob', 'grep', 'read', 'web_fetch', 'web_search', 'todo_write'])
    expect(shapes.Explore.continuable).toBe(false)
    expect(shapes['general-purpose'].continuable).toBe(true)
    expect(shapes['general-purpose'].toolFilter.allow).toContain('write')
    expect(shapes['general-purpose'].toolFilter.allow).toContain('edit')
  })
  it('child personas carry official anchors + common notes', () => {
    const shapes = childShapes('/tmp')
    expect(shapes.Explore.persona).toContain('READ-ONLY MODE - NO FILE MODIFICATIONS')
    expect(shapes.Explore.persona).toContain('avoid using emojis')
    expect(shapes.Explore.persona).toContain('Working directory: /tmp')
    expect(shapes['general-purpose'].persona).toContain('You are an agent for ZCode CLI.')
    expect(shapes['general-purpose'].persona).toContain('NEVER proactively create documentation files')
  })
  it('result footer matches the official SendMessage continuation shape', () => {
    const fg = renderAgentResult({ kind: 'foreground', runId: 'run-1', output: [{ type: 'text', text: 'done' }] })
    expect(fg[0].text).toContain("agentId: run-1 (use send_message with agent_id 'run-1' to continue this agent)")
    const cont = renderAgentResult({ kind: 'continuable', subagentId: 'child-2' })
    expect(cont[0].text).toContain("use send_message with agent_id 'child-2'")
    const bg = renderAgentResult({ kind: 'background', backgroundTaskId: 'job-3' })
    // Official formatAgentOutputForModel async_launched rendering (verbatim).
    expect(bg[0].text).toContain('Async agent launched successfully.')
    expect(bg[0].text).toContain("agentId: job-3 (internal ID - do not mention to user. Use send_message with to: 'job-3' to continue this agent.)")
    expect(bg[0].text).toContain('The agent is working in the background. You will be notified automatically when it completes.')
  })
})
