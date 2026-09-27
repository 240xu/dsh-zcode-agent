// src/tools/todo.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
var STATUSES = ["pending", "in_progress", "completed"];
var PRIORITIES = ["high", "medium", "low"];
var priorities = /* @__PURE__ */ new Map();
function sidecarFor(agentKey) {
  let m = priorities.get(agentKey);
  if (m === void 0) {
    m = /* @__PURE__ */ new Map();
    priorities.set(agentKey, m);
  }
  return m;
}
function summarize(todos) {
  return {
    total: todos.length,
    pending: todos.filter((t) => t.status === "pending").length,
    inProgress: todos.filter((t) => t.status === "in_progress").length,
    completed: todos.filter((t) => t.status === "completed").length
  };
}
var TODO_WRITE_DESCRIPTION = `Create and update a task list for the current session. The list is rendered to the user as your working plan.

- Each todo has \`content\`, \`status\` ("pending" | "in_progress" | "completed"), and \`priority\` ("high" | "medium" | "low").
- Send the full list each call; it replaces the previous one.
- Keep one item \`in_progress\` at a time and mark it \`completed\` when done.`;
var TODO_READ_DESCRIPTION = "Read the current session todo list";
function todoPriorityOf(agent, content) {
  return priorities.get(String(agent.session.id))?.get(content) ?? "medium";
}
async function readTodos(ctx, agent) {
  const snapshot = ctx.sessionProjections.snapshot(agent.session, ["todos"]);
  const stripped = snapshot.values["todos"] ?? [];
  const sidecar = priorities.get(String(agent.session.id));
  return stripped.map((item) => ({
    content: item.content,
    status: STATUSES.includes(item.status) ? item.status : "pending",
    priority: sidecar?.get(item.content) ?? "medium"
  }));
}
function registerTodoTools(ctx) {
  ctx.tools.register(defineTool({
    name: "todo_write",
    description: TODO_WRITE_DESCRIPTION,
    parameters: {
      todos: {
        type: "array",
        required: true,
        description: "The COMPLETE task list, replacing any previous list.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string", required: true, description: "Brief description of the task" },
            status: { type: "string", required: true, enum: [...STATUSES], description: "Current status of the task" },
            priority: { type: "string", required: true, enum: [...PRIORITIES], description: "Priority level of the task" }
          }
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          oldTodos: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                content: { type: "string", required: true },
                status: { type: "string", required: true },
                priority: { type: "string", required: true }
              }
            }
          },
          todos: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                content: { type: "string", required: true },
                status: { type: "string", required: true },
                priority: { type: "string", required: true }
              }
            }
          },
          summary: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              total: { type: "integer", required: true },
              pending: { type: "integer", required: true },
              inProgress: { type: "integer", required: true },
              completed: { type: "integer", required: true }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Updated todo list: ${value.summary.pending} pending, ${value.summary.inProgress} in progress, ${value.summary.completed} completed.`
      }]
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error("todo_write requires an owning agent session");
      const agentKey = String(exec.agent.session.id);
      const seen = /* @__PURE__ */ new Set();
      let active = 0;
      const todos = [];
      for (const item of args.todos) {
        if (!STATUSES.includes(item.status)) {
          throw new Error(`invalid status: ${JSON.stringify(item.status)}`);
        }
        if (!PRIORITIES.includes(item.priority)) {
          throw new Error(`invalid priority: ${JSON.stringify(item.priority)}`);
        }
        if (seen.has(item.content)) {
          throw new Error(`invalid todos: duplicate content ${JSON.stringify(item.content)}`);
        }
        seen.add(item.content);
        if (item.status === "in_progress") active++;
        todos.push({
          content: item.content,
          status: item.status,
          priority: item.priority
        });
      }
      if (active > 1) throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`);
      const oldTodos = await readTodos(ctx, exec.agent);
      exec.agent.session.append("todo/write", {
        todos: todos.map((todo) => ({ content: todo.content, status: todo.status }))
      });
      const sidecar = sidecarFor(agentKey);
      sidecar.clear();
      for (const todo of todos) sidecar.set(todo.content, todo.priority);
      return { oldTodos, todos, summary: summarize(todos) };
    },
    presentCall: (args) => ({ card: "generic", title: "Update todo list", kind: "other", rawInput: args.todos })
  }));
  ctx.tools.register(defineTool({
    name: "todo_read",
    description: TODO_READ_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          todos: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                content: { type: "string", required: true },
                status: { type: "string", required: true },
                priority: { type: "string", required: true }
              }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.todos.length === 0 ? "The session todo list is empty." : `[${value.todos.map((t) => `${JSON.stringify(t.content)}, ${t.status}, ${t.priority}`).join("\n")}]`
      }]
    },
    async execute(_args, exec) {
      if (!exec.agent) throw new Error("todo_read requires an owning agent session");
      return { todos: await readTodos(ctx, exec.agent) };
    },
    presentCall: () => ({ card: "generic", title: "Read todo list", kind: "other", rawInput: {} })
  }));
}

// src/tools/ask-user-shadow.ts
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";
var ASK_USER_QUESTION_DESCRIPTION = [
  "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.",
  "",
  "Usage notes:",
  '- Users will always be able to select "Other" to provide custom text input',
  "- Use multiSelect: true to allow multiple answers to be selected for a question",
  '- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label',
  "",
  'Plan mode note: To switch into plan mode, use EnterPlanMode (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions \u2014 the user cannot see the plan until you call ExitPlanMode for approval.',
  "",
  "Reserve this for decisions where the user's answer changes what you do next \u2014 not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.",
  "",
  "Preview feature:",
  "Use the optional `preview` field on options when presenting concrete artifacts that users need to visually compare:",
  "- ASCII mockups of UI layouts or components",
  "- Code snippets showing different implementations",
  "- Diagram variations",
  "- Configuration examples",
  "",
  "Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect)."
].join("\n") + "\n";
function validateOfficial(input) {
  if (input.questions.length < 1 || input.questions.length > 4) {
    throw new Error("questions must contain 1-4 questions");
  }
  const texts = /* @__PURE__ */ new Set();
  for (const q of input.questions) {
    if (texts.has(q.question)) throw new Error("Question texts must be unique");
    texts.add(q.question);
    if (q.header.length > 12) throw new Error(`header must be at most 12 characters: ${JSON.stringify(q.header)}`);
    if (q.options.length < 2 || q.options.length > 4) {
      throw new Error(`options must have 2-4 entries for question ${JSON.stringify(q.question.slice(0, 40))}`);
    }
    const labels = /* @__PURE__ */ new Set();
    for (const option of q.options) {
      const label = option.label.trim().toLowerCase();
      if (label === "other") throw new Error("Do not include an Other option; clients provide it automatically");
      if (labels.has(option.label)) throw new Error("Option labels must be unique within each question");
      labels.add(option.label);
      if (option.preview !== void 0 && q.multiSelect === true) {
        throw new Error("previews are only supported for single-select questions (not multiSelect)");
      }
    }
  }
}
function registerAskUserShadow(ctx) {
  ctx.tools.register(defineTool2({
    name: "ask_user_question",
    description: ASK_USER_QUESTION_DESCRIPTION,
    parameters: {
      questions: {
        type: "array",
        required: true,
        description: "Questions to ask the user before continuing.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            question: {
              type: "string",
              required: true,
              description: "The complete question to ask the user. Should be clear, specific, and end with a question mark. If multiSelect is true, phrase it accordingly."
            },
            header: {
              type: "string",
              required: true,
              description: 'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".'
            },
            options: {
              type: "array",
              required: true,
              description: "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string", required: true, description: "Short user-facing option label." },
                  description: { type: "string", description: "Explanation of what this option means or what will happen if chosen." },
                  preview: { type: "string", description: "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options." }
                }
              }
            },
            multiSelect: {
              type: "boolean",
              description: "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."
            }
          }
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          questions: { type: "array", required: true },
          answers: { type: "array", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value)
      }]
    },
    async execute(args, exec) {
      validateOfficial(args);
      const result = await ctx.userQuestions.ask({
        questions: args.questions.map((question) => ({
          // Official has no caller id; mint one so the seam can echo answers.
          id: crypto.randomUUID(),
          question: question.question,
          header: question.header,
          options: question.options.map((option) => ({
            label: option.label,
            // Official `preview` degrades onto the seam's rendered `detail`
            // field when description is absent (the seam renders detail but
            // has no preview pane).
            ...option.description !== void 0 ? { description: option.description } : {},
            ...option.preview !== void 0 && option.description === void 0 ? { detail: option.preview } : {}
          })),
          ...question.multiSelect !== void 0 ? { multiSelect: question.multiSelect } : {}
        })),
        ...exec.agent !== void 0 ? { agent: exec.agent } : {},
        signal: exec.signal
      });
      return {
        questions: args.questions.map((question) => ({ question: question.question })),
        answers: result.answers.map((answer) => ({
          ...answer
        }))
      };
    }
  }));
}

// src/tools/agent.ts
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool as defineTool3 } from "@deepseek-ai/dsh-tools";

// src/official/env-info.ts
var ENVIRONMENT_HEADING = "# Environment";
var WORKING_DIRECTORY_LABEL = "Primary working directory";
var IS_GIT_REPOSITORY_LABEL = "Is a git repository";
var PLATFORM_LABEL = "Platform";
var SHELL_LABEL = "Shell";
var OS_VERSION_LABEL = "OS Version";
var YES_LABEL = "yes";
var NO_LABEL = "no";
var GIT_SYSTEM_CONTEXT_PREFIX = "gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.";
var CURRENT_BRANCH_LABEL = "Current branch";
var MAIN_BRANCH_LABEL = "Main branch (you will usually use this for PRs)";
var GIT_USER_LABEL = "Git user";
var STATUS_LABEL = "Status";
var RECENT_COMMITS_LABEL = "Recent commits";
var CLEAN_GIT_STATUS = "(clean)";
var DIRTY_GIT_STATUS = "(dirty)";
var UNKNOWN_GIT_STATUS = "(unknown)";
function isEnvInfoGitRepository(info) {
  return info.isGitRepository ?? (info.gitStatus !== void 0 ? info.gitStatus !== "not_repo" : Boolean(info.gitBranch));
}
function buildEnvInfoContent(info, model) {
  const hasGitRepository = isEnvInfoGitRepository(info);
  const lines = [
    ENVIRONMENT_HEADING,
    "You have been invoked in the following environment:",
    `- ${WORKING_DIRECTORY_LABEL}: ${info.cwd}`,
    `- ${IS_GIT_REPOSITORY_LABEL}: ${hasGitRepository ? YES_LABEL : NO_LABEL}`,
    `- ${PLATFORM_LABEL}: ${info.platform}`,
    `- ${SHELL_LABEL}: ${info.shell}`,
    `- ${OS_VERSION_LABEL}: ${info.osVersion}`,
    // 旧环境快照可能携带历史模型字段；渲染只读取本步骤实际执行的 Model。
    ...model ? [`- You are powered by the model named ${model.providerId}/${model.modelId}.`] : []
  ];
  return lines.join("\n");
}
function buildGitSystemContextContent(info) {
  const lines = [GIT_SYSTEM_CONTEXT_PREFIX];
  if (info.gitBranch) {
    lines.push("", `${CURRENT_BRANCH_LABEL}: ${info.gitBranch}`);
  }
  if (info.gitMainBranch) {
    lines.push("", `${MAIN_BRANCH_LABEL}: ${info.gitMainBranch}`);
  }
  if (info.gitUser) {
    lines.push("", `${GIT_USER_LABEL}: ${info.gitUser}`);
  }
  lines.push("", `${STATUS_LABEL}:
${formatGitStatus(info)}`);
  lines.push("", `${RECENT_COMMITS_LABEL}:
${formatRecentCommits(info)}`);
  return lines.join("\n");
}
function formatGitStatus(info) {
  if (info.gitStatusLines && info.gitStatusLines.length > 0) {
    return info.gitStatusLines.join("\n");
  }
  if (info.gitStatus === "dirty") {
    return DIRTY_GIT_STATUS;
  }
  if (info.gitStatus === "clean") {
    return CLEAN_GIT_STATUS;
  }
  return UNKNOWN_GIT_STATUS;
}
function formatRecentCommits(info) {
  if (info.recentCommits && info.recentCommits.length > 0) {
    return info.recentCommits.join("\n");
  }
  return "";
}
function buildEnvText(info, model) {
  return buildEnvInfoContent(info, model);
}
function buildGitSystemContextText(info) {
  return buildGitSystemContextContent(info);
}

// src/official/subagents.ts
var EXPLORE_AGENT_TYPE = "Explore";
var GENERAL_PURPOSE_AGENT_TYPE = "general-purpose";
var DEFAULT_SUBAGENT_TYPE = GENERAL_PURPOSE_AGENT_TYPE;
function buildExploreAgentPrompt(options) {
  const searchGuidelines = options.embeddedSearchEnabled ? [
    "- Use `find` via Bash for broad file pattern matching",
    "- Use `grep` via Bash for searching file contents with regex"
  ] : [
    "- Use Glob for broad file pattern matching",
    "- Use Grep for searching file contents with regex"
  ];
  const bashReadOnlyCommands = options.embeddedSearchEnabled ? "ls, git status, git log, git diff, find, grep, cat, head, tail" : "ls, git status, git log, git diff, find, cat, head, tail";
  return [
    "You are ZCode Explore, a file search and codebase research specialist for ZCode CLI. You excel at thoroughly navigating and exploring codebases.",
    "",
    "=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===",
    "This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:",
    "- Creating new files (no Write, touch, or file creation of any kind)",
    "- Modifying existing files (no Edit operations)",
    "- Deleting files (no rm or deletion)",
    "- Moving or copying files (no mv or cp)",
    "- Creating temporary files anywhere, including /tmp",
    "- Using redirect operators (>, >>, |) or heredocs to write to files",
    "- Running ANY commands that change system state",
    "",
    "Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.",
    "",
    "Your strengths:",
    "- Rapidly finding files using glob patterns",
    "- Searching code and text with powerful regex patterns",
    "- Reading and analyzing file contents",
    "",
    "Guidelines:",
    ...searchGuidelines,
    "- Use Read when you know the specific file path you need to read",
    `- Use Bash ONLY for read-only operations (${bashReadOnlyCommands})`,
    "- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification",
    "- Adapt your search approach based on the thoroughness level specified by the caller",
    "- Communicate your final report directly as a regular message - do NOT attempt to create files",
    "",
    "NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:",
    "- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations",
    "- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files",
    "",
    "Complete the user's search request efficiently and report your findings clearly."
  ].join("\n");
}
function buildGeneralPurposeSystemPrompt() {
  return [
    "You are an agent for ZCode CLI. Given the user's message, you should use the tools available to complete the task. Complete the task fully\u2014don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings \u2014 the caller will relay this to the user, so it only needs the essentials.",
    "",
    "Your strengths:",
    "- Searching for code, configurations, and patterns across large codebases",
    "- Analyzing multiple files to understand system architecture",
    "- Investigating complex questions that require exploring many files",
    "- Performing multi-step research tasks",
    "",
    "Guidelines:",
    "- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.",
    "- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.",
    "- Be thorough: Check multiple locations, consider different naming conventions, look for related files.",
    "- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.",
    "- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested."
  ].join("\n");
}
function buildSubagentCommonNotes() {
  return [
    "Notes:",
    "- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.",
    "- In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing (e.g., a bug you found, a function signature the caller asked for) \u2014 do not recap code you merely read.",
    "- For clear communication with the user the assistant MUST avoid using emojis.",
    '- Do not use a colon before tool calls. Text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.',
    "- Do NOT Write report/summary/findings/analysis .md files. Return findings directly as your final assistant message \u2014 the parent agent reads your text output, not files you create."
  ].join("\n");
}
function buildSubagentEnvironmentContext(options) {
  const { envInfo, model } = options;
  const modelLine = model ? [`You are powered by the model named ${model.providerId}/${model.modelId}.`] : [];
  return [
    "Here is useful information about the environment you are running in:",
    "<env>",
    `Working directory: ${envInfo.cwd}`,
    `Is directory a git repo: ${isEnvInfoGitRepository(envInfo) ? "Yes" : "No"}`,
    `Platform: ${envInfo.platform}`,
    `Shell: ${envInfo.shell}`,
    `OS Version: ${envInfo.osVersion}`,
    "</env>",
    ...modelLine
  ].join("\n");
}
var EXPLORE_AGENT_ALLOWED_TOOLS = [
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "WebFetch",
  "WebSearch",
  "TodoWrite"
];
var EXPLORE_AGENT_EMBEDDED_SEARCH_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "WebFetch",
  "WebSearch",
  "TodoWrite"
];
var EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY = [
  "Glob",
  "Grep",
  "Read",
  "Bash",
  "WebFetch",
  "WebSearch",
  "TodoWrite"
];
var EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY_SET = new Set(
  EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY
);
function buildExploreAllowedTools(options = {}) {
  return options.embeddedSearchEnabled ? EXPLORE_AGENT_EMBEDDED_SEARCH_ALLOWED_TOOLS : EXPLORE_AGENT_ALLOWED_TOOLS;
}
function formatExploreAllowedToolsForAgentDescription(options = {}) {
  const allowedTools = buildExploreAllowedTools(options);
  const allowedToolSet = new Set(allowedTools);
  const prioritizedTools = EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY.filter(
    (tool) => allowedToolSet.has(tool)
  );
  const unprioritizedTools = allowedTools.filter(
    (tool) => !EXPLORE_AGENT_DESCRIPTION_TOOL_PRIORITY_SET.has(tool)
  );
  return [...prioritizedTools, ...unprioritizedTools].join(", ");
}
function createBuiltInGeneralPurposeAgentProfile() {
  return {
    name: DEFAULT_SUBAGENT_TYPE,
    description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
    // 内置子智能体使用显式身份色，避免 UI 按名称 hash 后把 general-purpose 显示为红色。
    color: "blue",
    injectAgentsMd: true,
    source: "built-in",
    systemPrompt: buildGeneralPurposeSystemPrompt(),
    tools: ["*"]
  };
}
function createBuiltInExploreAgentProfile() {
  return {
    name: EXPLORE_AGENT_TYPE,
    description: `Read-only search agent for broad fan-out searches - when answering means sweeping many files, directories, or naming conventions and you only need the conclusion, not the file dumps. It reads excerpts rather than whole files, so it locates code; it doesn't review or audit it. Specify search breadth: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions.`,
    color: "cyan",
    injectAgentsMd: false,
    source: "built-in",
    systemPrompt: "",
    tools: ["Bash", "Glob", "Grep", "Read", "WebFetch", "WebSearch", "TodoWrite"]
  };
}
function normalizeAgentProfiles(profiles) {
  const active = /* @__PURE__ */ new Map();
  active.set(
    DEFAULT_SUBAGENT_TYPE,
    createBuiltInGeneralPurposeAgentProfile()
  );
  active.set(
    EXPLORE_AGENT_TYPE,
    createBuiltInExploreAgentProfile()
  );
  for (const profile of profiles) {
    active.set(profile.name, profile);
  }
  return Array.from(active.values());
}
function isBuiltInExploreAgentProfile(profile) {
  return profile.name === EXPLORE_AGENT_TYPE && profile.source === "built-in";
}
function normalizeToolNameAlias(toolName) {
  return toolName === "web_search" ? "WebSearch" : toolName;
}
function getToolRuleName(rule) {
  const trimmed = rule.trim();
  const parenIndex = trimmed.indexOf("(");
  const rawName = parenIndex > 0 ? trimmed.slice(0, parenIndex) : trimmed;
  return normalizeToolNameAlias(rawName);
}
function createToolRuleNameSet(rules) {
  if (!rules || rules.length === 0) return void 0;
  const names = /* @__PURE__ */ new Set();
  for (const rule of rules) {
    const name = getToolRuleName(rule);
    if (name) names.add(name);
  }
  return names.size > 0 ? names : void 0;
}
function filterDisallowedToolNames(toolNames, disallowedTools) {
  const disallowed = createToolRuleNameSet(disallowedTools);
  if (!disallowed) return toolNames;
  return toolNames.filter((toolName) => !disallowed.has(normalizeToolNameAlias(toolName)));
}
var SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS = [
  "EnterPlanMode",
  "ExitPlanMode"
];
function buildSubagentChildDisallowRules(disallowedTools) {
  return [...SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS, ...disallowedTools ?? []];
}
function filterSubagentChildToolNames(toolNames, disallowedTools) {
  return filterDisallowedToolNames(toolNames, buildSubagentChildDisallowRules(disallowedTools));
}
function formatAgentProfilesForPrompt(profiles, options = {}) {
  const active = normalizeAgentProfiles(profiles);
  if (active.length === 0) return null;
  return [
    "Available agent types and the tools they have access to:",
    ...active.map((profile) => {
      const tools = isBuiltInExploreAgentProfile(profile) ? formatExploreAllowedToolsForAgentDescription(options) : profile.tools ? filterSubagentChildToolNames(profile.tools, profile.disallowedTools) : void 0;
      const toolText = typeof tools === "string" ? tools : tools?.join(", ");
      const suffix = toolText ? ` (Tools: ${toolText})` : "";
      return `- ${profile.name}: ${profile.description}${suffix}`;
    })
  ].join("\n");
}
function builtInAgentProfiles() {
  return normalizeAgentProfiles([
    createBuiltInGeneralPurposeAgentProfile(),
    createBuiltInExploreAgentProfile()
  ]);
}

// src/env-live.ts
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { release } from "node:os";
var GIT_TIMEOUT_MS = 2e3;
var MAX_GIT_STATUS_BYTES = 2e4;
var MAX_RECENT_COMMITS = 5;
function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }).toString().trimEnd();
  } catch {
    return void 0;
  }
}
function collectEnvInfo(cwd) {
  const shellPath = process.env.SHELL ?? process.env.ComSpec ?? process.env.COMSPEC ?? "";
  const shell = shellPath ? basename(shellPath) : "unknown";
  const revParse = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (revParse !== "true") {
    return {
      cwd,
      isGitRepository: false,
      platform: process.platform,
      shell,
      osVersion: release(),
      gitStatus: "not_repo"
    };
  }
  const branch = git(["branch", "--show-current"], cwd);
  const statusLines = git(["status", "--short"], cwd);
  const statusRaw = statusLines === void 0 ? void 0 : statusLines.slice(0, MAX_GIT_STATUS_BYTES);
  const status = statusRaw !== void 0 && statusRaw.length > 0 ? "dirty" : "clean";
  const recentCommits = git(
    ["log", "--oneline", `-${MAX_RECENT_COMMITS}`, "--format=%h %s"],
    cwd
  )?.split("\n");
  const info = {
    cwd,
    isGitRepository: true,
    platform: process.platform,
    shell,
    osVersion: release(),
    gitStatus: status
  };
  if (branch) info.gitBranch = branch;
  if (statusRaw !== void 0 && statusRaw.length > 0) info.gitStatusLines = statusRaw.split("\n");
  if (recentCommits && recentCommits.length > 0) info.recentCommits = recentCommits;
  return info;
}
function memoryRootFor(cwd) {
  return join(cwd, ".zcode", "memory");
}
function localIsoDate(now = /* @__PURE__ */ new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// src/tools/agent.ts
function unknownAgentTypeError(subagentType) {
  return `Agent type '${subagentType}' not found. Available agents: general-purpose, Explore`;
}
var DSH_TOOL = {
  Bash: "bash",
  Glob: "glob",
  Grep: "grep",
  Read: "read",
  Write: "write",
  Edit: "edit",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  TodoWrite: "todo_write",
  TodoRead: "todo_read",
  Skill: "skill",
  Agent: "agent",
  Task: "task",
  AskUserQuestion: "ask_user_question"
};
function mapTools(officialNames) {
  const out = [];
  for (const name of officialNames) {
    const dsh = DSH_TOOL[name];
    if (dsh !== void 0 && !out.includes(dsh)) out.push(dsh);
  }
  return out;
}
var EXPLORE_OFFICIAL_TOOLS = ["Bash", "Glob", "Grep", "Read", "WebFetch", "WebSearch", "TodoWrite"];
function childPersona(profile, cwd) {
  const base = profile.systemPrompt.trim() === "" ? buildExploreAgentPrompt({ embeddedSearchEnabled: false }) : profile.systemPrompt;
  const notes = buildSubagentCommonNotes();
  const env = buildSubagentEnvironmentContext({
    agentPrompt: base,
    envInfo: { ...collectEnvInfo(cwd), cwd }
  });
  return [base, "", notes, "", env].join("\n");
}
function childShapes(cwd) {
  const explore = createBuiltInExploreAgentProfile();
  const general = createBuiltInGeneralPurposeAgentProfile();
  return {
    "general-purpose": {
      persona: childPersona(general, cwd),
      // official general-purpose profile: tools: "*"
      toolFilter: { allow: mapTools(["Bash", "Glob", "Grep", "Read", "Write", "Edit", "WebFetch", "WebSearch", "TodoWrite", "TodoRead", "Skill", "Agent", "AskUserQuestion"]) },
      continuable: true
    },
    Explore: {
      persona: childPersona(explore, cwd),
      toolFilter: { allow: mapTools(EXPLORE_OFFICIAL_TOOLS) },
      continuable: false
    }
  };
}
function routeAgentType(subagentType) {
  if (subagentType === void 0 || subagentType === "general-purpose") return "general-purpose";
  if (subagentType === "Explore") return "Explore";
  throw new Error(unknownAgentTypeError(subagentType));
}
function renderAgentResult(value) {
  if (value.kind === "continuable") {
    return [{ type: "text", text: `Agent running with ID: ${value.subagentId} (use send_message with agent_id '${value.subagentId}' to continue this agent)` }];
  }
  if (value.kind === "background") {
    return [{ type: "text", text: `Agent running in background with ID: ${value.backgroundTaskId}. You will be notified when it completes.` }];
  }
  const finalText = textOf(value.output);
  return [{ type: "text", text: `${finalText}
agentId: ${value.runId} (use send_message with agent_id '${value.runId}' to continue this agent)` }];
}
function textOf(output) {
  if (!Array.isArray(output)) return "";
  return output.filter((block) => typeof block === "object" && block !== null && !Array.isArray(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function agentToolDescription() {
  const roster = formatAgentProfilesForPrompt([
    createBuiltInGeneralPurposeAgentProfile(),
    createBuiltInExploreAgentProfile()
  ]) ?? "";
  return [
    "Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.",
    "",
    roster,
    "",
    "When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.",
    "",
    "## When to use",
    "",
    "Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files \u2014 delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself \u2014 wait for the result.",
    "",
    "- The agent's final message is returned to you as the tool result; it is not shown to the user \u2014 relay what matters.",
    "- A new Agent call starts fresh, so the prompt must be self-contained.",
    "- `run_in_background: true` runs the agent asynchronously; you'll be notified when it completes.",
    "- When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently."
    // Official gate-closed branch: the CreateWorkflow bullet is omitted because
    // this deployment ships no CreateWorkflow tool.
  ].join("\n");
}
function registerAgentTool(ctx) {
  const cwd = process.cwd();
  const shapes = childShapes(cwd);
  const description = agentToolDescription();
  ctx.tools.register(defineTool3({
    name: "agent",
    description,
    parameters: {
      description: { type: "string", required: true, description: "A short (3-5 word) description of the task" },
      prompt: { type: "string", required: true, description: "The task for the agent to perform" },
      subagent_type: { type: "string", description: "The type of specialized agent to use for this task" },
      run_in_background: {
        type: "boolean",
        description: "Set to true to run this agent in the background. You will be notified when it completes."
      }
    },
    output: {
      schema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", required: true, const: "foreground" },
              runId: { type: "string", required: true },
              output: { type: "array", required: true }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", required: true, const: "continuable" },
              subagentId: { type: "string", required: true }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", required: true, const: "background" },
              backgroundTaskId: { type: "string", required: true }
            }
          }
        ]
      },
      render: (_args, value) => renderAgentResult(value)
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error("agent tool requires a calling agent (exec.agent was undefined)");
      const childType = routeAgentType(args.subagent_type);
      const shape = shapes[childType];
      const runInBackground = args.run_in_background ?? shape.continuable;
      const startRequest = {
        label: args.description,
        prompt: [{ type: "text", text: args.prompt }],
        parent,
        persona: shape.persona,
        toolFilter: { allow: [...shape.toolFilter.allow] }
      };
      if (runInBackground && shape.continuable) {
        const started = await ctx.subagents.startContinuable({
          provider: "spawn",
          label: args.description,
          request: startRequest,
          signal: exec.signal
        });
        return { kind: "continuable", subagentId: String(started.childId) };
      }
      if (runInBackground) {
        const jobs = ctx.get("jobs");
        if (jobs === void 0) {
          throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
        }
        const id = jobs.start({
          kind: "subagent",
          label: args.description,
          owner: SessionId(parent.session.id),
          run: () => {
            const controller = new AbortController();
            const start = ctx.subagents.start("spawn", { ...startRequest, signal: controller.signal });
            return {
              cancel: (reason) => {
                controller.abort(reason ?? "background agent task killed");
              },
              done: settleStart(start, controller.signal)
            };
          }
        });
        return { kind: "background", backgroundTaskId: String(id) };
      }
      const run = await ctx.subagents.start("spawn", { ...startRequest, signal: exec.signal });
      return await settleForegroundRun(run);
    }
  }));
}
async function settleForegroundRun(run) {
  let result;
  try {
    result = await run.result;
  } finally {
  }
  if (result.stopReason !== "completed") {
    const detail = result.diagnostic !== void 0 ? ` (${result.diagnostic})` : "";
    throw new Error(`subagent ended with stopReason '${result.stopReason}'${detail}`);
  }
  return {
    kind: "foreground",
    runId: String(run.id),
    output: result.output.map((block) => JSON.parse(JSON.stringify(block)))
  };
}
async function settleStart(start, signal) {
  try {
    const run = await start;
    const result = await run.result;
    const text = textOf(result.output);
    if (result.stopReason !== "completed") {
      return { status: "failed", detail: `stopReason ${result.stopReason}${result.diagnostic !== void 0 ? `: ${result.diagnostic}` : ""}`, result: text };
    }
    return { status: "completed", result: text };
  } catch (error) {
    if (signal.aborted) return { status: "killed", detail: "cancelled" };
    return { status: "failed", detail: String(error.message ?? error) };
  }
}

// src/tools/reminders.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// src/official/plan-workflow.ts
var EXPLORE_AGENT_TYPE2 = "Explore";
var ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
var EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";
var planResearchAgentCount = 3;
var RUNTIME_MODE_REMINDER_CONFIG = Object.freeze({
  TURNS_BETWEEN_ATTACHMENTS: 5,
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5
});
function buildPlanWorkflow() {
  return `## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the ${EXPLORE_AGENT_TYPE2} subagent type.

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused \u2014 avoid proposing new code when suitable implementations already exist.

2. **Launch up to ${planResearchAgentCount} ${EXPLORE_AGENT_TYPE2} agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - ${planResearchAgentCount} agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigating testing patterns

### Phase 2: Design
Goal: Design an implementation approach.

**Guidelines:**
- Use the context gathered in Phase 1, including relevant files and code paths.
- Account for the user's requirements and constraints.
- Produce a concrete implementation plan that is detailed enough to execute.
- Consider useful perspectives for the task type:
  - New feature: simplicity vs performance vs maintainability
  - Bug fix: root cause vs workaround vs prevention
  - Refactoring: minimal change vs clean architecture

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use ${ASK_USER_QUESTION_TOOL_NAME} to clarify any remaining questions with the user

### Phase 4: Call ${EXIT_PLAN_MODE_TOOL_NAME}
At the very end of your turn, once you have asked the user questions and are happy with your final plan - you should always call ${EXIT_PLAN_MODE_TOOL_NAME} to indicate to the user that you are done planning.
This is critical - your turn should only end with either using the ${ASK_USER_QUESTION_TOOL_NAME} tool OR calling ${EXIT_PLAN_MODE_TOOL_NAME}. Do not stop unless it's for these 2 reasons

**Important:** Use ${ASK_USER_QUESTION_TOOL_NAME} ONLY to clarify requirements or choose between approaches. Use ${EXIT_PLAN_MODE_TOOL_NAME} to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ${EXIT_PLAN_MODE_TOOL_NAME}.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using the ${ASK_USER_QUESTION_TOOL_NAME} tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.`;
}
var PLAN_MODE_FULL_REMINDER = [
  "Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.",
  buildPlanWorkflow()
];
var PLAN_MODE_SPARSE_REMINDER = [
  `Plan mode still active (see full instructions earlier in conversation). Read-only. Follow 4-phase workflow. End turns with ${ASK_USER_QUESTION_TOOL_NAME} (for clarifications) or ${EXIT_PLAN_MODE_TOOL_NAME} (for plan approval). Never ask about plan approval via text or AskUserQuestion.`
];
function buildPlanModeFullReminderBody() {
  return PLAN_MODE_FULL_REMINDER.join("\n");
}
function buildPlanModeSparseReminderBody() {
  return PLAN_MODE_SPARSE_REMINDER.join("\n");
}

// src/tools/reminders.ts
var TODO_REMINDER_CONFIG = Object.freeze({
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10
});
var PLAN_MODE_REMINDER_CONFIG = Object.freeze({
  TURNS_BETWEEN_ATTACHMENTS: 5,
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5
});
var states = /* @__PURE__ */ new Map();
function stateFor(agent) {
  const key = String(agent.session.id);
  let s = states.get(key);
  if (s === void 0) {
    s = { turnsSinceTodoWrite: 0, turnsSinceTodoReminder: 0, planReminderCount: 0, turnsSincePlanReminder: 0 };
    states.set(key, s);
  }
  return s;
}
function resetCountersOnPlanMode(s) {
  s.planReminderCount = 0;
  s.turnsSincePlanReminder = 0;
}
function todoReminderBody(todos) {
  const lines = [
    "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if it has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable."
  ];
  if (todos.length > 0) {
    const currentTodos = `[${todos.map((t) => `${JSON.stringify(t.content)}, ${t.status}, ${t.priority}`).join("\n")}]`;
    lines.push("", "Here are the existing contents of your todo list:", "", currentTodos);
  }
  return lines.join("\n");
}
function installReminders(agentCtx, getTodos, isPlanMode) {
  agentCtx.on("agent/pre-step", async ({ agent, step, signal }, next) => {
    const decision = await next();
    signal.throwIfAborted();
    if (decision.kind === "reject") return decision;
    if (step === 1 && decision.messages.length === 0) return decision;
    const state = stateFor(agent);
    const planMode = isPlanMode(agent);
    if (!planMode) resetCountersOnPlanMode(state);
    const reminders = [];
    if (!planMode && state.turnsSinceTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE && state.turnsSinceTodoReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS) {
      const todos = await getTodos(agent) ?? [];
      reminders.push(todoReminderBody(todos));
      state.turnsSinceTodoReminder = 0;
    }
    if (planMode && state.turnsSincePlanReminder >= PLAN_MODE_REMINDER_CONFIG.TURNS_BETWEEN_ATTACHMENTS) {
      state.planReminderCount++;
      reminders.push(
        state.planReminderCount % PLAN_MODE_REMINDER_CONFIG.FULL_REMINDER_EVERY_N_ATTACHMENTS === 1 ? buildPlanModeFullReminderBody() : buildPlanModeSparseReminderBody()
      );
      state.turnsSincePlanReminder = 0;
    }
    if (reminders.length === 0) return decision;
    const injected = reminders.map((text) => createUserMessage({
      content: [{ type: "text", text: `<system-reminder>
${text}
</system-reminder>` }],
      source: { kind: "zcode-official:reminder", form: "reminder" }
    }));
    return { ...decision, messages: [...decision.messages, ...injected] };
  });
}
function noteTodoWrite(agent) {
  const s = stateFor(agent);
  s.turnsSinceTodoWrite = 0;
  s.turnsSinceTodoReminder = 0;
}

// src/official/identity.ts
var SECURITY_NOTICE = "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";
function buildSecurityNotice() {
  return SECURITY_NOTICE;
}
function buildHarnessBlock() {
  return [
    "# Harness",
    "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
    "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
    "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
    "- Reference code as `file_path:line_number` \u2014 it's clickable."
  ].join("\n");
}

// src/official/tool-descriptions.ts
var READ_DEFAULT_MAX_LINES = 2e3;
var DEFAULT_BASH_TIMEOUT_MS = 12e4;
var DEFAULT_BASH_MAX_TIMEOUT_MS = 6e5;
function buildBashProviderDescription(input) {
  return [
    "Executes a bash command and returns its output.",
    "",
    "- Working directory persists between calls, but prefer absolute paths \u2014 `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
    "- IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.",
    `- \`timeout\` is in milliseconds: default ${input.defaultTimeoutMs}, max ${input.maxTimeoutMs}.`,
    "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
    "",
    "# Git",
    "- Interactive flags (`-i`, e.g. `git rebase -i`) are not supported in this environment.",
    "- Use the `gh` CLI for GitHub operations (PRs, issues, API).",
    "- Commit or push only when the user asks. If on the default branch, branch first."
  ].join("\n");
}
function buildReadDescription() {
  return [
    "Reads a file from the local filesystem.",
    "",
    "- `file_path` must be an absolute path.",
    `- Reads up to ${READ_DEFAULT_MAX_LINES} lines by default.`,
    "- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters",
    "- Results are returned using cat -n format, with line numbers starting at 1",
    "- Reads images (PNG, JPG, \u2026) and presents them visually.",
    "- Reads videos (MP4, MOV, WEBM, \u2026) and presents them as video input (subject to ZCode's video input limit).",
    "- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.",
    "- Do NOT re-read a file you just edited to verify \u2014 Edit/Write would have errored if the change failed, and the harness tracks file state for you."
  ].join("\n");
}
function buildWriteDescription() {
  return "Writes a file to the local filesystem, overwriting if one exists.\n\nWhen to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead.";
}
function buildEditDescription() {
  return "Performs exact string replacement in a file.\n\n- You must Read the file in this conversation before editing, or the call will fail.\n- `old_string` must match the file exactly, including indentation, and be unique \u2014 the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.\n- `replace_all: true` replaces every occurrence instead.";
}
function buildGlobDescription() {
  return 'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.';
}
function buildGrepDescription() {
  return 'Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash \u2014 results integrate with the permission UI and file links.\n\n- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep \u2014 escape literal braces (`interface\\{\\}`).\n- Filter with `glob` (e.g. "**/*.tsx") or `type` (e.g. "js", "py", "rust").\n- `output_mode`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".\n- `multiline: true` for patterns that span lines.';
}
function buildWebFetchDescription() {
  return "Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model.\n\n- Fails on authenticated/private URLs \u2014 use an authenticated MCP tool or `gh` for those instead.\n- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.\n- Responses are cached for 15 minutes per URL.";
}
var WEBSEARCH_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
function buildWebSearchProviderDescription(now = /* @__PURE__ */ new Date()) {
  const currentMonth = `${WEBSEARCH_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  return [
    "Search the web. Returns result blocks with titles and URLs. US-only.",
    "",
    `- The current month is ${currentMonth} \u2014 use this when searching for recent information.`,
    "- `allowed_domains` / `blocked_domains` filter results.",
    "Sources:"
  ].join("\n");
}
var TODO_READ_DESCRIPTION2 = "Read the current session todo list";
function buildTodoWriteDescription() {
  return 'Create and update a task list for the current session. The list is rendered to the user as your working plan.\n\n- Each todo has \\`content\\`, \\`status\\` ("pending" | "in_progress" | "completed"), and \\`priority\\` ("high" | "medium" | "low").\n- Send the full list each call; it replaces the previous one.\n- Keep one item \\`in_progress\\` at a time and mark it \\`completed\\` when done.';
}
function buildSkillDescription() {
  return 'Execute a skill within the main conversation\n\nWhen users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.\n\nWhen users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.\n\nHow to invoke:\n- Set \\`skill\\` to the exact name of an available skill (no leading slash). For plugin-namespaced skills use the fully qualified \\`plugin:skill\\` form.\n- Set \\`args\\` to pass optional arguments.\n\nImportant:\n- Available skills are listed in system-reminder messages in the conversation\n- Only invoke a skill that appears in that list, or one the user explicitly typed as \\`/<name>\\` in their message. Never guess or invent a skill name from training data; otherwise do not call this tool\n- When a skill matches the user\'s request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task\n- NEVER mention a skill without actually calling this tool\n- Do not invoke a skill that is already running\n- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)\n- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again\n';
}
var ASK_USER_QUESTION_DESCRIPTION2 = "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.\n\nUsage notes:\nOther\n- Use multiSelect: true to allow multiple answers to be selected for a question\n(Recommended)\n\nIs my plan ready?\nShould I proceed?\nthe plan\n\nReserve this for decisions where the user's answer changes what you do next \u2014 not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.\n\nPreview feature:\nUse the optional `preview` field on options when presenting concrete artifacts that users need to visually compare:\n- ASCII mockups of UI layouts or components\n- Code snippets showing different implementations\n- Diagram variations\n- Configuration examples\n\nPreview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).\n";
var EXIT_PLAN_MODE_MODEL_INSTRUCTIONS = [
  `Use this tool when you have finished writing your plan and are ready for user approval.

## How This Tool Works
- You should have already explored the codebase and finalized the plan you want the user to review
- Pass the complete plan in the plan field; the user will review that content before approving implementation
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of the plan parameter when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion before finalizing your plan
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.`
];
function buildAgentProviderDescription(agentList) {
  return [
    "Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.",
    "",
    agentList,
    "",
    "When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.",
    "",
    "## When to use",
    "",
    "Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files \u2014 delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself \u2014 wait for the result.",
    "",
    "- The agent's final message is returned to you as the tool result; it is not shown to the user \u2014 relay what matters.",
    "- A new Agent call starts fresh, so the prompt must be self-contained.",
    "- `run_in_background: true` runs the agent asynchronously; you'll be notified when it completes.",
    "- When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently."
  ].join("\n");
}
function buildTaskDescription(agentDescription) {
  return [
    "Claude Code-compatible alias for the Agent tool. Use this when plugin instructions ask for the Task tool.",
    "",
    agentDescription
  ].join("\n");
}

// src/official/dynamic-sections.ts
var COMMUNICATION_PROMPTS = {
  default: "Write code that reads like the surrounding code: match its comment density, naming, and idiom.",
  additional: {
    beforeDefault: [
      "# Communicating with the user",
      "",
      "Your text output is what the user reads; they usually can't see your thinking or the raw tool results. Write it for a teammate who stepped away and is catching up, not for a log file: they don't know the codenames or shorthand you created along the way, and they didn't watch your process unfold. Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.",
      "",
      "Text you write between tool calls may not be shown to the user. Everything the user needs from this turn \u2014 answers, summaries, findings, conclusions, deliverables \u2014 must be in the final text message of your turn, with no tool calls after it. Keep text between tool calls to brief status notes. If something important appeared only mid-turn or in your thinking, restate it in that final message.",
      "",
      'Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find" \u2014 the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after, for readers who want them.',
      "",
      "Being readable and being concise are different things, and readable matters more. If the user has to reread your summary or ask you to explain, any time saved by brevity is gone. The way to keep output short is to be selective about what you include (drop details that don't change what the reader would do next), not to compress the writing into fragments, abbreviations, arrow chains like `A \u2192 B \u2192 fails`, or jargon. What you do include, write in complete sentences with the technical terms spelled out. Don't make the reader cross-reference labels or numbering you invented earlier; say what you mean in place.",
      "",
      "Match the response to the question: a simple question gets a direct answer in prose, not headers and sections. Use tables only for short enumerable facts, with explanations in the surrounding prose rather than the cells. Calibrate to the user \u2014 a bit tighter for an expert, more explanatory for someone newer."
    ].join("\n"),
    afterDefault: "Only write a code comment to state a constraint the code itself can't show \u2014 never to say where it came from, what the next line does, or why your change is correct; that's you talking to the reviewer, not the next reader, and it's noise the moment the PR merges."
  }
};
var CONTEXT_MANAGEMENT_PROMPTS = {
  default: [
    "# Context management",
    "When the conversation grows long, some or all of the current context is summarized; the summary, along with any remaining unsummarized context, is provided in the next context window so work can continue \u2014 you don't need to wrap up early or hand off mid-task."
  ].join("\n"),
  additional: [
    "When you have enough information to act, act. Do not re-derive facts already established in the conversation, re-litigate a decision the user has already made, or narrate options you will not pursue. If you are weighing a choice, give a recommendation, not an exhaustive survey",
    "",
    "You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to\u2026?' or 'Shall I\u2026?' will block the work. For reversible actions that follow from the original request, proceed without asking. Stop only for destructive actions or genuine scope changes the user must decide. Offering follow-ups after the task is done is fine; asking permission before doing the work is not.",
    "",
    "Exception: when the user is describing a problem, asking a question, or thinking out loud rather than requesting a change, the deliverable is your assessment. Report your findings and stop. Don't apply a fix until they ask for one.",
    "",
    "Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done ('I'll\u2026', 'let me know when\u2026'), do that work now with tool calls. That includes retrying after errors and gathering missing information yourself. Do not stop because the context or session is long. End your turn only when the task is complete or you are blocked on input only the user can provide.",
    "",
    "Before running a command that changes system state \u2014 restarts, deletes, config edits \u2014 check that the evidence actually supports that specific action. A signal that pattern-matches to a known failure may have a different cause."
  ].join("\n")
};
function buildDynamicBehaviorText() {
  return [
    COMMUNICATION_PROMPTS.additional.beforeDefault,
    "",
    COMMUNICATION_PROMPTS.default,
    COMMUNICATION_PROMPTS.additional.afterDefault,
    "",
    "For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next. Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target \u2014 if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging."
  ].join("\n");
}
function buildContextManagementText() {
  return [CONTEXT_MANAGEMENT_PROMPTS.default, "", CONTEXT_MANAGEMENT_PROMPTS.additional].join("\n");
}

// src/official/memory.ts
function buildMemoryText(memoryRoot) {
  return [
    "# Memory",
    "",
    `You have a persistent file-based memory at \`${memoryRoot}/\`. This directory already exists \u2014 write to it directly with the Write tool (do not run mkdir or check for its existence). Each memory is one file holding one fact, with frontmatter:`,
    "",
    "```markdown",
    "---",
    "name: <short-kebab-case-slug>",
    "description: <one-line summary \u2014 used to decide relevance during recall>",
    "metadata:",
    "  type: user | feedback | project | reference",
    "---",
    "",
    "<the fact; for feedback/project, follow with **Why:** and **How to apply:** lines. Link related memories with [[their-name]].>",
    "```",
    "",
    "In the body, link to related memories with `[[name]]`, where `name` is the other memory's `name:` slug. Link liberally \u2014 a `[[name]]` that doesn't match an existing memory yet is fine; it marks something worth writing later, not an error.",
    "",
    "`user` \u2014 who the user is (role, expertise, preferences). `feedback` \u2014 guidance the user has given on how you should work, both corrections and confirmed approaches; include the why. `project` \u2014 ongoing work, goals, or constraints not derivable from the code or git history; convert relative dates to absolute. `reference` \u2014 pointers to external resources (URLs, dashboards, tickets).",
    "",
    "After writing the file, add a one-line pointer in `MEMORY.md` (`- [Title](file.md) \u2014 hook`). `MEMORY.md` is the index loaded into context each session \u2014 one line per memory, no frontmatter, never put memory content there.",
    "",
    "Before saving, check for an existing file that already covers it \u2014 update that file rather than creating a duplicate; delete memories that turn out to be wrong. Don't save what the repo already records (code structure, past fixes, git history, AGENTS.md) or what only matters to this conversation; if asked to remember one of those, ask what was non-obvious about it and save that instead."
  ].join("\n");
}

// src/index.ts
var CLI_PREFIX_PROMPT = "You are ZCode, an interactive coding agent";
var ZCODE_NAME = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  todo_read: "TodoRead",
  todo_write: "TodoWrite",
  skill: "Skill",
  agent: "Agent",
  task: "Task",
  goal_read: "GoalRead",
  ask_user_question: "AskUserQuestion"
};
var PARAMETER_NOTES = {
  bash: "ZCode parameter: `timeout` in milliseconds (default 120000, max 600000); `run_in_background` runs detached and re-invokes you on exit.",
  edit: "ZCode requires the file to have been Read in this conversation before editing; `old_string` must match exactly including indentation and be unique; `replace_all` replaces every occurrence.",
  web_search: "ZCode notes results are US-only.",
  goal_read: "DSH-specific (no ZCode counterpart): the goal text is the authoritative long-running objective; do not mark the goal complete without real evidence of achievement \u2014 a finished plan or todo list is not completion evidence.",
  skill: "ZCode session guidance, verbatim:\n- When the user types `/<skill-name>`, invoke it via Skill. Only use skills listed in the user-invocable skills section \u2014 don't guess."
};
var SURFACE_NOTES = [
  "- `EnterPlanMode` / `ExitPlanMode`: plan mode in this deployment is entered by the user (`/plan`); `exit_plan_mode` submits the plan for approval. A user's conversational agreement approves nothing \u2014 only exiting plan mode requests approval.",
  "- `SendMessage`: continue a background subagent with a follow-up message instead of starting a new one (`send_message`).",
  "- `TaskOutput` is DEPRECATED upstream: never poll for background results; collect finished background work with `job_output` (wait only when genuinely blocked) and stop irrelevant work with `job_kill` (`TaskStop`).",
  "- `ApplyPatch`: never call a patch tool directly \u2014 perform the same edit with `write`/`edit` (upstream dispatches ApplyPatch to Write/Edit).",
  "- `ReadSessionContext`: read context from another persisted session with the `session_search`, `session_event_search`, `session_trace`, `session_event_trace`, and `session_event_read` tools (e.g. when the user references a prior session or asks to continue it).",
  "- `CreateWorkflow`/`SaveWorkflow`/`AmendWorkflow` and the other dynamic-workflow tools are not available in this deployment (the official gate-closed branch): never fabricate workflow tool calls."
];
function buildSections(env) {
  const info = collectEnvInfo(env.cwd);
  const profileRoster = formatAgentProfilesForPrompt(builtInAgentProfiles());
  const descriptions = {
    read: buildReadDescription(),
    write: buildWriteDescription(),
    edit: buildEditDescription(),
    bash: buildBashProviderDescription({ defaultTimeoutMs: DEFAULT_BASH_TIMEOUT_MS, maxTimeoutMs: DEFAULT_BASH_MAX_TIMEOUT_MS }),
    glob: buildGlobDescription(),
    grep: buildGrepDescription(),
    web_fetch: buildWebFetchDescription(),
    web_search: buildWebSearchProviderDescription(),
    todo_read: TODO_READ_DESCRIPTION2,
    todo_write: buildTodoWriteDescription(),
    skill: buildSkillDescription(),
    agent: buildAgentProviderDescription(profileRoster ?? ""),
    task: buildTaskDescription(buildAgentProviderDescription(profileRoster ?? "")),
    goal_read: "Reads the current session goal state. The goal text is authoritative for the long-running objective; a later GoalRead result or runtime goal event updates it. Do not mark the goal complete unless real evidence shows the objective has been achieved. A completed plan, todo list, checklist, or planning phase is not completion evidence unless the objective was only to produce that artifact.",
    ask_user_question: ASK_USER_QUESTION_DESCRIPTION2
  };
  const blocks = [
    "# ZCode tool semantics",
    "",
    "The tools available in this session are DSH tools. Their ZCode semantics follow; where a note names ZCode parameters, apply it to the corresponding DSH tool.",
    "",
    "## ZCode tools mapped to DSH equivalents",
    "",
    ...SURFACE_NOTES,
    ""
  ];
  for (const [dshName, description] of Object.entries(descriptions)) {
    const zcodeName = ZCODE_NAME[dshName] ?? dshName;
    blocks.push(`## ${zcodeName}`, "", description.trim());
    const note = PARAMETER_NOTES[dshName];
    if (note !== void 0) blocks.push("", note);
    blocks.push("");
  }
  const sections = [
    { name: "zcode-official:cli-prefix", order: 50, text: CLI_PREFIX_PROMPT },
    {
      name: "zcode-official:identity",
      order: 100,
      text: ["", "You are an interactive ZCode agent that helps users with software engineering tasks.", "", buildSecurityNotice(), "", buildHarnessBlock()].join("\n")
    },
    { name: "zcode-official:dynamic-behavior", order: 110, text: buildDynamicBehaviorText() },
    { name: "zcode-official:context-management", order: 120, text: buildContextManagementText() },
    { name: "zcode-official:env", order: 300, text: buildEnvText(info, env.model) },
    { name: "zcode-official:memory", order: 340, text: buildMemoryText(memoryRootFor(env.cwd)) },
    { name: "zcode-official:tool-semantics", order: 460, text: blocks.join("\n").trimEnd() },
    { name: "zcode-official:date", order: 490, text: `# currentDate
Today's date is ${localIsoDate()}.` }
  ];
  if (info.isGitRepository) {
    sections.splice(5, 0, { name: "zcode-official:sysctx", order: 320, text: buildGitSystemContextText(info) });
  }
  return sections;
}
var inject = ["systemPrompt", "tools", "sessionProjections", "subagents", "userQuestions"];
function apply(ctx) {
  const env = { cwd: process.cwd() };
  registerTodoTools(ctx);
  registerAgentTool(ctx);
  registerAskUserShadow(ctx);
  ctx.on("agent/created", async ({ agent }) => {
    installReminders(
      agent.ctx,
      (agentArg) => {
        const snapshot = ctx.sessionProjections.snapshot(agentArg.session, ["todos"]);
        const stripped = snapshot.values["todos"] ?? [];
        return Promise.resolve(stripped.map((item) => ({
          content: item.content,
          status: item.status,
          priority: todoPriorityOf(agentArg, item.content)
        })));
      },
      (agentArg) => {
        try {
          return ctx.planMode.get(agentArg).active;
        } catch {
          return false;
        }
      }
    );
  });
  ctx.on("tools/post-execute", async (exec, _result, next) => {
    if (exec.name === "todo_write" && exec.agent !== void 0) noteTodoWrite(exec.agent);
    return next();
  });
  ctx.effect(function* () {
    for (const section of buildSections(env)) {
      yield ctx.systemPrompt.section({
        name: section.name,
        order: section.order,
        text: section.text
      });
    }
  }, "zcode-official sections");
}
export {
  DEFAULT_BASH_MAX_TIMEOUT_MS,
  DEFAULT_BASH_TIMEOUT_MS,
  EXIT_PLAN_MODE_MODEL_INSTRUCTIONS,
  EXPLORE_AGENT_ALLOWED_TOOLS,
  EXPLORE_AGENT_TYPE,
  GENERAL_PURPOSE_AGENT_TYPE,
  apply,
  buildAgentProviderDescription,
  buildBashProviderDescription,
  buildExploreAgentPrompt,
  buildGeneralPurposeSystemPrompt,
  buildPlanModeFullReminderBody,
  buildPlanModeSparseReminderBody,
  buildPlanWorkflow,
  buildReadDescription,
  buildSections,
  buildSkillDescription,
  buildSubagentCommonNotes,
  buildSubagentEnvironmentContext,
  buildTodoWriteDescription,
  buildWebSearchProviderDescription,
  builtInAgentProfiles,
  collectEnvInfo,
  formatExploreAllowedToolsForAgentDescription,
  inject,
  localIsoDate,
  memoryRootFor
};
