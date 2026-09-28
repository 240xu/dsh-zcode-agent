/**
 * zcode-official preset plugin: registers the official ZCode prompt sections.
 *
 * All section text is ported from the official open-source repository
 * zai-org/ZCode@872ad96 (Apache-2.0), `apps/zcode-cli/packages/core/src/`,
 * preserving the official builder-function shape (see ./official/*). The
 * agent loop, tool pipeline, permissions, and session log remain DSH's own.
 *
 * Section orders sit between the deployment persona prefix (0) and the plan
 * policy (500):
 * - 50   CLI prefix (official cli-prefix.ts)
 * - 100  identity (official identity.ts: intro + security notice + Harness)
 * - 110  dynamic behavior (official dynamic-sections.ts)
 * - 120  context management (official dynamic-sections.ts)
 * - 300  environment info (official env-info.ts, live values)
 * - 320  git system context (official env-info.ts, snapshot; dropped outside repos)
 * - 340  memory (official memory.ts, file-based memory format)
 * - 460  tool semantics (official description builders, keyed by DSH tool names)
 * - 490  current date (official current-date.ts wording)
 * @module @deepseek-ai/dsh-zcode-official
 */
import type { Context } from '@deepseek-ai/cordis';
import { collectEnvInfo, localIsoDate, memoryRootFor } from './env-live.ts';
export interface ZcodeSection {
    readonly name: string;
    readonly order: number;
    readonly text: string;
}
/** Model-facing env snapshot used for live sections. */
export interface ZcodeEnv {
    readonly cwd: string;
    readonly model?: {
        readonly providerId: string;
        readonly modelId: string;
    };
}
/** Pure assembly so tests can assert section text without mounting cordis. */
export declare function buildSections(env: ZcodeEnv): ZcodeSection[];
/** Tool + prompt dependencies: sections ride systemPrompt; the official todo
 * and Agent rows shadow the core rows inside the preset scope; the compaction
 * engine rides the compaction realm. */
export declare const inject: readonly ["systemPrompt", "tools", "sessionProjections", "subagents", "userQuestions", "web"];
export interface ZcodePresetConfig {
    /** When 'zcode', mount ZcodeCompactionEngine instead of the core row. */
    engine?: 'zcode';
}
export declare function apply(ctx: Context, config?: ZcodePresetConfig & {
    role?: 'preset' | 'compaction';
}): void;
export { collectEnvInfo, memoryRootFor, localIsoDate };
export { EXPLORE_AGENT_TYPE, GENERAL_PURPOSE_AGENT_TYPE, buildExploreAgentPrompt, buildGeneralPurposeSystemPrompt, buildSubagentCommonNotes, buildSubagentEnvironmentContext, EXPLORE_AGENT_ALLOWED_TOOLS, formatExploreAllowedToolsForAgentDescription, builtInAgentProfiles, } from './official/subagents.ts';
export { buildPlanWorkflow, buildPlanModeFullReminderBody, buildPlanModeSparseReminderBody, } from './official/plan-workflow.ts';
export { DEFAULT_BASH_TIMEOUT_MS, DEFAULT_BASH_MAX_TIMEOUT_MS, buildAgentProviderDescription, buildBashProviderDescription, buildReadDescription, buildSkillDescription, buildTodoWriteDescription, buildWebSearchProviderDescription, EXIT_PLAN_MODE_MODEL_INSTRUCTIONS, } from './official/tool-descriptions.ts';
export { ZcodeCompactionEngine } from './tools/compaction-zcode.ts';
//# sourceMappingURL=index.d.ts.map