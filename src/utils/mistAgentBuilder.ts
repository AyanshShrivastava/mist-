import type {
  AgentToolActivity,
  AiProviderConfig,
  McpApprovalRequest,
  McpServerConfig,
  McpServerCredential,
  McpToolDefinition,
  MistProject,
  PreviewConsoleEntry,
  PreviewHealthSnapshot,
  ProjectFile,
  TerminalLogEntry,
  WebSearchConfig,
  WebSearchMode,
  WebSearchOutcome,
} from '../types/mist';
import {
  callByokAgentTurn,
  callByokCompletionRaw,
  type ByokChatMessage,
  type ByokMessageContentPart,
  type ByokToolCall,
  type ByokToolDefinition,
} from './byokClient';
import { redactSecrets } from './aiErrors';
import { createSafeId, maskApiKey, mergeProjectFiles, normalizeProjectFilePath } from './projectOps';
import {
  applyVfsEditFile,
  applyVfsWriteFile,
  executeSandboxTerminalCommand,
  type SandboxBuildBundleFn,
} from './mistSandboxRunner';
import {
  classifyMcpToolSensitivity,
  connectAndDiscoverMcpTools,
  invokeMcpServerTool,
  sanitizeMcpError,
} from './mcpClient';
import {
  formatRetrievedSourcesForPrompt,
  formatSearchFailureForPrompt,
  MAX_SEARCH_REQUESTS_PER_INTERACTION,
  WebSearchError,
  type WebSearchService,
} from './webSearchService';
import {
  needsWebSearch,
  validateAndExtractCitations,
} from '../data/webSearch';
import { validateProjectFilesPayload, sanitizeErrorMessage, type LookupFn } from './serverSecurity';

export interface ConnectedMcpToolBinding {
  qualifiedName: string;
  server: McpServerConfig;
  credential?: McpServerCredential;
  tool: McpToolDefinition;
}

export interface AgentBuilderParams {
  mode: 'generate' | 'refine' | 'verify_preview';
  instruction: string;
  projectName?: string;
  initialFiles?: ProjectFile[];
  selectedElement?: { tagName: string; textContent: string; className: string };
  enableAppAi: boolean;
  config: AiProviderConfig;
  searchMode?: WebSearchMode;
  searchConfig?: WebSearchConfig;
  searchService?: WebSearchService;
  mcpServers?: McpServerConfig[];
  mcpCredentials?: Record<string, McpServerCredential>;
  onMcpCredentialUpdated?: (updated: McpServerCredential) => Promise<void> | void;
  requestMcpApproval?: (req: McpApprovalRequest) => Promise<boolean>;
  previewConsoleEntries?: PreviewConsoleEntry[];
  previewHealth?: PreviewHealthSnapshot;
  runBundle: SandboxBuildBundleFn;
  signal: AbortSignal;
  aiFetchImpl?: typeof fetch;
  searchFetchImpl?: typeof fetch;
  mcpFetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  maxIterations?: number;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface AgentBuilderResult {
  projectName: string;
  description: string;
  summary: string;
  files: ProjectFile[];
  changedFiles: string[];
  toolActivities: AgentToolActivity[];
  terminalEntries: TerminalLogEntry[];
  searchOutcome?: WebSearchOutcome;
  buildVerified: boolean;
  buildError?: string;
}

const MIST_AGENT_SYSTEM_PROMPT = `You are Mist Agent, an elite autonomous software architect, product designer, UI engineer, and debugger.
You operate inside Mist's isolated project workspace with real tools and a real sandboxed terminal.
Never pretend you edited files or ran checks without actually invoking tools and reading their outputs.

BUILT-IN CAPABILITIES & WORKFLOW:
1. Explore & Plan:
   - In refine or debug tasks, use \`list_files\`, \`read_file\`, and \`search_files\` to inspect existing code before editing.
   - Never delete or overwrite working functionality unnecessarily. Use \`edit_file\` for surgical multi-line changes and \`write_file\` when creating new files or major rewrites.
2. Build Production Quality Code:
   - Build complete React 19 + TypeScript (.tsx) + Tailwind CSS v4 (CSS starts with \`@import "tailwindcss";\`) + Three.js / Canvas apps with genuine interactive state, form validation, accessibility, responsive layout (390px mobile to desktop), and crisp contrast.
   - "src/App.tsx" MUST exist and export \`export default function App()\`.
   - "src/index.css" MUST exist and start with \`@import "tailwindcss";\`.
   - Allowed imports: \`react\`, \`react-dom/client\`, \`lucide-react\`, \`three\`, \`three/addons/*\`, and local relative imports (\`./components/...\`). Never invent non-existent packages or external broken URLs.
   - Never use \`// TODO\`, empty click handlers, \`alert()\`, or \`<a href="/...">\` for buttons (use \`<button type="button" onClick={...}>\`).
   - Generated apps must NEVER prompt end users for API keys. When live App AI is enabled/requested, call \`fetch('/api/app-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, messages, systemInstruction }) })\` or \`window.mistAI\`.
3. Mandatory Terminal Build Verification & Auto-Debug:
   - Before presenting your final answer, ALWAYS call \`run_terminal\` with \`{ "command": "build" }\` (runs Mist's real TypeScript compiler + esbuild + Tailwind compiler in the isolated project sandbox).
   - If \`run_terminal\` returns non-zero exitCode or any TS/syntax/semicolon/import errors, read the affected file, fix every error cleanly, and re-run \`run_terminal({ command: "build" })\` until exitCode === 0.
4. External Tools & Live Search:
   - Use \`web_search\` when live documentation or current facts are required.
   - Use connected MCP server tools when inspecting or managing external services (Render, GitHub, etc.). Never fabricate MCP tool output.
5. Honest Reporting:
   - In your final response (JSON or clear summary), state only the files actually modified/created and verified build results.`;

function extractJsonObjectSafe(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        const parsed = JSON.parse(candidate.slice(first, last + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildCoreTools(allowWebSearch: boolean): ByokToolDefinition[] {
  const tools: ByokToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all files currently in the Mist project workspace with line and byte counts.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read contents of a file in the project workspace with optional line range.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path, e.g. src/App.tsx' },
            startLine: { type: 'integer', description: '1-based start line (optional)' },
            endLine: { type: 'integer', description: '1-based inclusive end line (optional)' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for a text or regex pattern across all project workspace files.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Substring or regex pattern to match' },
            pathFilter: { type: 'string', description: 'Optional path filter substring' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create a new file or completely replace an existing file in the project workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path such as src/App.tsx or src/components/Header.tsx' },
            content: { type: 'string', description: 'Complete file content (never truncated)' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Perform an exact, surgical search-and-replace inside an existing workspace file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Existing file path, e.g. src/App.tsx' },
            target: { type: 'string', description: 'Exact verbatim snippet to replace (must match uniquely)' },
            replacement: { type: 'string', description: 'Replacement snippet' },
          },
          required: ['path', 'target', 'replacement'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete an unneeded file from the project workspace (cannot delete src/App.tsx).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path to remove' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_terminal',
        description:
          'Run a real command inside Mist’s isolated project sandbox terminal. Use "build" (tsc + esbuild + Tailwind), "typecheck", "ls", "cat <path>", "grep <pattern>", or "node <script.ts>".',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Sandbox command to execute, e.g. "build", "typecheck", "node src/test.ts"',
            },
          },
          required: ['command'],
        },
      },
    },
  ];

  if (allowWebSearch) {
    tools.push({
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the live web for real documentation, libraries, facts, or API details.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string' },
          },
          required: ['query'],
        },
      },
    });
  }

  return tools;
}

function buildActiveKeySummary(config: AiProviderConfig): string {
  const providerTitle = config.name?.trim() || config.provider || 'BYOK Provider';
  const masked = maskApiKey(config.apiKey);
  if (!masked) {
    return `- Active Provider/Model: ${providerTitle} (${config.model})`;
  }
  return `- The user's active BYOK API key (${masked} on ${providerTitle} · ${config.model}) IS ALREADY CONFIGURED AND ACTIVE in Mist — if interactive App AI is enabled, POST /api/app-ai automatically authenticates using that key (never prompt users for an API key).`;
}

function buildInitialUserMessage(
  params: AgentBuilderParams,
  files: ProjectFile[],
  initialSearchContext?: string,
): string | ByokMessageContentPart[] {
  const aiDirective = params.enableAppAi
    ? '- Interactive App AI is ENABLED for this project: use real `fetch("/api/app-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, messages, systemInstruction }) })` or `window.mistAI.complete(...)` with loading/error handling.'
    : '- Do NOT add unrequested chatbots or `/api/app-ai` widgets unless asked.';

  const modelNote = buildActiveKeySummary(params.config);
  const searchSuffix = initialSearchContext ? `\n\n${initialSearchContext}` : '';

  if (params.mode === 'generate') {
    const promptText = `Create a complete, high-craft interactive React + TypeScript + Tailwind CSS application for this request:
"${params.instruction.trim()}"

${aiDirective}
${modelNote}${searchSuffix}

Use \`write_file\` to create cohesive files (starting with \`src/App.tsx\` and \`src/index.css\`), then call \`run_terminal\` with \`{ "command": "build" }\` to verify TypeScript + esbuild compilation cleanly before finishing.
When finished, summarize what you built and respond with:
{"projectName":"Short Title","description":"One sentence summary","summary":"Concise summary of verified work"}`;
    return promptText;
  }

  const fileListOverview = files
    .map((f) => `- ${f.path} (${f.content.split('\n').length} lines, ${f.content.length} bytes)`)
    .join('\n');

  if (params.mode === 'refine') {
    const elemNote = params.selectedElement
      ? `\nSelected visual element in preview: <${params.selectedElement.tagName}> className="${params.selectedElement.className}" text="${params.selectedElement.textContent}"`
      : '';
    return `Refine the existing Mist project "${params.projectName || 'Mist App'}" according to this instruction:
"${params.instruction.trim()}"${elemNote}

${aiDirective}
${modelNote}${searchSuffix}

Current workspace files:
${fileListOverview}

Inspect relevant files with \`read_file\`, apply surgical edits with \`edit_file\` or \`write_file\` across every affected file, and ALWAYS run \`run_terminal\` with \`{ "command": "build" }\` before finishing.
When finished, respond with a concise summary or JSON \`{"summary":"..."}\`.`;
  }

  // verify_preview mode: includes live browser runtime logs + DOM health + optional PNG screenshot!
  const consoleText = (params.previewConsoleEntries || [])
    .slice(-20)
    .map((c) => `[${c.level}] ${c.message}${c.source ? ` (${c.source}:${c.line ?? '?'})` : ''}`)
    .join('\n');

  const h = params.previewHealth;
  const healthSummary = h
    ? [
        `Viewport: ${h.viewportWidth}x${h.viewportHeight}`,
        `Root HTML length: ${h.rootHtmlLength}, Visible text chars: ${h.textLength}, Elements: ${h.elementCount}, Canvases: ${h.canvasCount}`,
        `Horizontal overflow: ${h.horizontalOverflowPx}px, Broken images: ${h.brokenImages}`,
        `Runtime errors: ${h.runtimeErrorCount}, Console errors: ${h.consoleErrorCount}`,
      ].join('\n')
    : 'No DOM health metrics captured.';

  const textPart = `LIVE PREVIEW INSPECTION & AUTO-FIX REQUEST for "${params.projectName || 'Mist App'}":
User/System context: ${params.instruction}

${modelNote}

Captured Preview DOM & Layout Health:
${healthSummary}

Captured Browser Runtime Console / Errors:
${consoleText || '(none)'}

Current workspace files:
${fileListOverview}

Diagnose every runtime error, blank screen, horizontal overflow, or visual/layout bug shown in the telemetry${h?.screenshotDataUrl?.startsWith('data:image/png;base64,') ? ' and attached preview screenshot' : ''}.
Read the affected file(s), fix all bugs cleanly using \`edit_file\` / \`write_file\`, and run \`run_terminal({ "command": "build" })\` before finishing.
Respond with JSON \`{"summary":"What was fixed and verified"}\`.`;

  if (h?.screenshotDataUrl?.startsWith('data:image/png;base64,')) {
    return [
      { type: 'text', text: textPart },
      { type: 'image_url', image_url: { url: h.screenshotDataUrl, detail: 'high' } },
    ];
  }
  return textPart;
}

export async function runMistBuilderAgent(params: AgentBuilderParams): Promise<AgentBuilderResult> {
  const maxIterations = Math.min(10, Math.max(2, params.maxIterations ?? 8));
  let files: ProjectFile[] = params.initialFiles ? validateProjectFilesPayload(params.initialFiles) : [];
  const changedFiles = new Set<string>();
  const toolActivities: AgentToolActivity[] = [];
  const terminalEntries: TerminalLogEntry[] = [];
  let dirtySinceLastBuild = false;
  let lastBuildResult: { exitCode: number; stdout: string; stderr: string } | null = null;

  let searchRequestsUsed = 0;
  let searchOutcome: WebSearchOutcome = {
    status: 'skipped',
    queries: [],
    sources: [],
  };

  const emit = (event: Record<string, unknown>) => {
    params.onEvent?.(event);
  };

  // Automatic initial web research when enabled / requested
  let initialSearchContext = '';
  const searchDecision =
    params.searchService && params.mode !== 'verify_preview'
      ? needsWebSearch(params.instruction, params.searchMode || 'auto')
      : { shouldSearch: false };

  if (searchDecision.shouldSearch && params.searchService) {
    const initialQuery = params.instruction.trim().slice(0, 180);
    emit({
      type: 'search_start',
      queries: [initialQuery],
      phase: 'Searching live web sources...',
    });

    try {
      const resSearch = await params.searchService.search({
        rawConfig: params.searchConfig,
        queries: [initialQuery],
        maxRequestsInTurn: MAX_SEARCH_REQUESTS_PER_INTERACTION,
        signal: params.signal,
        fetchImpl: params.searchFetchImpl,
        skipDnsLookup: params.skipDnsLookup,
      });
      searchOutcome = resSearch.outcome;
      searchRequestsUsed = resSearch.requestsUsed;
      emit({
        type: 'search_results',
        queries: searchOutcome.queries,
        sources: searchOutcome.sources,
        warning: searchOutcome.warning,
      });
      initialSearchContext = formatRetrievedSourcesForPrompt({
        sources: searchOutcome.sources,
        queries: searchOutcome.queries,
        allowFollowUpSearch: searchRequestsUsed < MAX_SEARCH_REQUESTS_PER_INTERACTION,
        remainingSearchBudget: Math.max(0, MAX_SEARCH_REQUESTS_PER_INTERACTION - searchRequestsUsed),
      });
    } catch (err) {
      if (err instanceof WebSearchError && err.code === 'CANCELLED') throw err;
      if (params.signal.aborted) throw err;
      const errMsg =
        err instanceof WebSearchError
          ? err.message
          : sanitizeErrorMessage(err) || 'Web search failed.';
      searchOutcome = {
        status: 'failed',
        queries: [initialQuery],
        sources: [],
        error: errMsg,
        searchedAt: new Date().toISOString(),
        providerName: params.searchConfig?.name,
      };
      emit({ type: 'search_error', queries: [initialQuery], error: errMsg });
      initialSearchContext = formatSearchFailureForPrompt(errMsg);
    }
  }

  // Discover connected MCP server tools upfront (genuine live discovery only, skipping failed servers honestly)
  const mcpBindings = new Map<string, ConnectedMcpToolBinding>();
  const mcpToolDefs: ByokToolDefinition[] = [];
  const enabledMcpServers = (params.mcpServers || []).filter((s) => s.enabled);

  if (enabledMcpServers.length > 0) {
    emit({ type: 'phase', phase: `Checking ${enabledMcpServers.length} connected MCP server(s)...` });
    for (let idx = 0; idx < enabledMcpServers.length; idx++) {
      const server = enabledMcpServers[idx];
      const cred = params.mcpCredentials?.[server.id];
      if (server.authType !== 'none' && !cred?.accessToken?.trim()) {
        continue;
      }
      try {
        const discovery = await connectAndDiscoverMcpTools({
          server,
          credential: cred,
          options: {
            fetchImpl: params.mcpFetchImpl,
            skipDnsLookup: params.skipDnsLookup,
            lookupFn: params.lookupFn,
            signal: params.signal,
            onCredentialUpdated: params.onMcpCredentialUpdated,
          },
        });
        for (const tool of discovery.tools.slice(0, 20)) {
          const safeTool = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
          const qualified = `mcp_${idx}_${safeTool}`;
          mcpBindings.set(qualified, {
            qualifiedName: qualified,
            server,
            credential: cred,
            tool,
          });
          mcpToolDefs.push({
            type: 'function',
            function: {
              name: qualified,
              description: `[MCP: ${server.name}] ${tool.description || tool.name}`,
              parameters:
                tool.inputSchema && typeof tool.inputSchema === 'object'
                  ? tool.inputSchema
                  : { type: 'object', properties: {} },
            },
          });
        }
      } catch (err) {
        emit({
          type: 'tool_result',
          toolName: `mcp:${server.name}`,
          status: 'error',
          summary: sanitizeMcpError(err),
        });
      }
    }
  }

  const allowWebSearch = Boolean(params.searchService && params.searchMode !== 'off');
  const allTools: ByokToolDefinition[] = [...buildCoreTools(allowWebSearch), ...mcpToolDefs.slice(0, 32)];

  const mcpPromptHint =
    mcpToolDefs.length > 0
      ? `\n\nCONNECTED EXTERNAL MCP TOOLS (${mcpToolDefs.length}):\n${Array.from(mcpBindings.values())
          .map((b) => `- ${b.qualifiedName} (${b.server.name}): ${b.tool.description || b.tool.name}`)
          .join('\n')}`
      : '';

  const messages: ByokChatMessage[] = [
    { role: 'system', content: `${MIST_AGENT_SYSTEM_PROMPT}${mcpPromptHint}` },
    { role: 'user', content: buildInitialUserMessage(params, files, initialSearchContext) },
  ];

  let finalProjectName = params.projectName || '';
  let finalDescription = '';
  let finalSummary = '';
  let usedToolsFallbackMode = false;

  const recordFilesFromParsedJson = (parsed: Record<string, unknown>) => {
    if (typeof parsed.projectName === 'string' && parsed.projectName.trim()) {
      finalProjectName = parsed.projectName.trim().slice(0, 120);
    }
    if (typeof parsed.description === 'string' && parsed.description.trim()) {
      finalDescription = parsed.description.trim().slice(0, 500);
    }
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      finalSummary = parsed.summary.trim();
    }
    if (Array.isArray(parsed.files) && parsed.files.length > 0) {
      const incoming = parsed.files
        .filter((f): f is { path: string; content: string; language?: ProjectFile['language'] } =>
          Boolean(f && typeof f === 'object' && typeof (f as any).path === 'string' && typeof (f as any).content === 'string'),
        )
        .map((f) => {
          const clean = normalizeProjectFilePath(f.path);
          changedFiles.add(clean);
          dirtySinceLastBuild = true;
          emit({ type: 'file_done', path: clean });
          return { path: clean, language: f.language, content: f.content };
        });
      if (incoming.length > 0) {
        files = validateProjectFilesPayload(mergeProjectFiles(files, incoming));
      }
    }
  };

  const executeSingleTool = async (call: ByokToolCall): Promise<string> => {
    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return JSON.stringify({ ok: false, error: 'Invalid JSON arguments passed to tool.' });
    }

    const toolId = createSafeId('tool');
    const startedAt = new Date().toISOString();
    const binding = mcpBindings.get(call.function.name);
    const displayToolName = binding ? `${binding.server.name}:${binding.tool.name}` : call.function.name;

    const activity: AgentToolActivity = {
      id: toolId,
      toolName: displayToolName,
      serverName: binding?.server.name,
      status: 'running',
      startedAt,
    };
    toolActivities.push(activity);
    emit({ type: 'tool_start', activity });

    const finishActivity = (status: AgentToolActivity['status'], summary: string) => {
      activity.status = status;
      activity.summary = summary.slice(0, 240);
      activity.finishedAt = new Date().toISOString();
      emit({ type: 'tool_result', activity });
    };

    try {
      switch (call.function.name) {
        case 'list_files': {
          const listing = files.map((f) => ({
            path: f.path,
            language: f.language,
            lines: f.content.split('\n').length,
            bytes: f.content.length,
          }));
          finishActivity('done', `Listed ${listing.length} file(s)`);
          return JSON.stringify({ ok: true, files: listing });
        }

        case 'read_file': {
          const rawPath = typeof args.path === 'string' ? normalizeProjectFilePath(args.path) : '';
          const match = files.find((f) => f.path.toLowerCase() === rawPath.toLowerCase());
          if (!match) {
            finishActivity('error', `Not found: ${rawPath}`);
            return JSON.stringify({ ok: false, error: `File "${rawPath}" does not exist.` });
          }
          const lines = match.content.split('\n');
          const start = typeof args.startLine === 'number' && args.startLine > 0 ? Math.floor(args.startLine) : 1;
          const end =
            typeof args.endLine === 'number' && args.endLine >= start
              ? Math.min(lines.length, Math.floor(args.endLine))
              : Math.min(lines.length, start + 299);
          const snippet = lines
            .slice(start - 1, end)
            .map((line, i) => `${start + i}: ${line}`)
            .join('\n');
          finishActivity('done', `Read ${match.path} (${start}-${end})`);
          return JSON.stringify({ ok: true, path: match.path, totalLines: lines.length, content: snippet });
        }

        case 'search_files': {
          const patternStr = typeof args.pattern === 'string' ? args.pattern : '';
          const pathFilter = typeof args.pathFilter === 'string' ? args.pathFilter.toLowerCase() : '';
          if (!patternStr) {
            finishActivity('error', 'Empty search pattern');
            return JSON.stringify({ ok: false, error: 'pattern is required' });
          }
          let re: RegExp;
          try {
            re = new RegExp(patternStr, 'i');
          } catch {
            re = new RegExp(patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          }
          const hits: Array<{ path: string; line: number; text: string }> = [];
          for (const f of files) {
            if (pathFilter && !f.path.toLowerCase().includes(pathFilter)) continue;
            const lines = f.content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                hits.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 180) });
                if (hits.length >= 60) break;
              }
            }
            if (hits.length >= 60) break;
          }
          finishActivity('done', `${hits.length} match(es) for "${patternStr}"`);
          return JSON.stringify({ ok: true, matches: hits });
        }

        case 'write_file': {
          const filePath = typeof args.path === 'string' ? args.path : '';
          const content = typeof args.content === 'string' ? args.content : '';
          if (!filePath.trim()) {
            finishActivity('error', 'Missing file path');
            return JSON.stringify({ ok: false, error: 'path is required' });
          }
          emit({
            type: 'file_start',
            path: normalizeProjectFilePath(filePath),
            completedFiles: Array.from(changedFiles),
          });
          const res = applyVfsWriteFile({ files, path: filePath, content });
          files = res.files;
          changedFiles.add(res.changedPath);
          dirtySinceLastBuild = true;
          emit({ type: 'file_done', path: res.changedPath });
          finishActivity('done', `Wrote ${res.changedPath} (${content.length} chars)`);
          return JSON.stringify({ ok: true, path: res.changedPath, bytes: content.length });
        }

        case 'edit_file': {
          const filePath = typeof args.path === 'string' ? args.path : '';
          const target = typeof args.target === 'string' ? args.target : '';
          const replacement = typeof args.replacement === 'string' ? args.replacement : '';
          emit({
            type: 'file_start',
            path: normalizeProjectFilePath(filePath),
            completedFiles: Array.from(changedFiles),
          });
          const res = applyVfsEditFile({ files, path: filePath, target, replacement });
          files = res.files;
          changedFiles.add(res.changedPath);
          dirtySinceLastBuild = true;
          emit({ type: 'file_done', path: res.changedPath });
          finishActivity('done', `Edited ${res.changedPath}`);
          return JSON.stringify({ ok: true, path: res.changedPath, replacements: res.replacements });
        }

        case 'delete_file': {
          const clean = typeof args.path === 'string' ? normalizeProjectFilePath(args.path) : '';
          if (clean.toLowerCase() === 'src/app.tsx') {
            finishActivity('error', 'Cannot delete root src/App.tsx');
            return JSON.stringify({ ok: false, error: 'Cannot delete root entry src/App.tsx' });
          }
          const beforeLen = files.length;
          files = files.filter((f) => f.path.toLowerCase() !== clean.toLowerCase());
          if (files.length === beforeLen) {
            finishActivity('error', `Not found: ${clean}`);
            return JSON.stringify({ ok: false, error: `File "${clean}" not found.` });
          }
          changedFiles.add(clean);
          dirtySinceLastBuild = true;
          finishActivity('done', `Deleted ${clean}`);
          return JSON.stringify({ ok: true, deleted: clean });
        }

        case 'run_terminal': {
          const command = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : 'build';
          emit({ type: 'phase', phase: `Running Mist terminal: ${command}` });
          const termRes = await executeSandboxTerminalCommand({
            files,
            command,
            source: 'agent',
            runBundle: params.runBundle,
          });
          terminalEntries.push(termRes);
          emit({ type: 'terminal_output', entry: termRes });

          const lowerCmd = command.toLowerCase();
          if (lowerCmd === 'build' || lowerCmd === 'verify' || lowerCmd === 'npm run build') {
            lastBuildResult = { exitCode: termRes.exitCode, stdout: termRes.stdout, stderr: termRes.stderr };
            if (termRes.exitCode === 0) {
              dirtySinceLastBuild = false;
            }
          }

          finishActivity(
            termRes.exitCode === 0 ? 'done' : 'error',
            `${command} (exit ${termRes.exitCode}, ${termRes.durationMs}ms)`,
          );
          return JSON.stringify({
            ok: termRes.exitCode === 0,
            exitCode: termRes.exitCode,
            stdout: termRes.stdout,
            stderr: termRes.stderr,
          });
        }

        case 'web_search': {
          const query = typeof args.query === 'string' ? args.query.trim() : '';
          if (!query || !params.searchService) {
            finishActivity('error', 'Search query empty or service unavailable');
            return JSON.stringify({ ok: false, error: 'Search query is required.' });
          }
          if (searchRequestsUsed >= MAX_SEARCH_REQUESTS_PER_INTERACTION) {
            finishActivity('error', 'Search budget exhausted');
            return JSON.stringify({ ok: false, error: 'Per-turn web search budget reached.' });
          }
          emit({ type: 'search_start', queries: [query], phase: `Searching web: "${query}"...` });
          try {
            const searchRes = await params.searchService.search({
              rawConfig: params.searchConfig,
              queries: [query],
              existingSources: searchOutcome.sources,
              maxRequestsInTurn: MAX_SEARCH_REQUESTS_PER_INTERACTION,
              usedRequestsSoFar: searchRequestsUsed,
              signal: params.signal,
              fetchImpl: params.searchFetchImpl,
              skipDnsLookup: params.skipDnsLookup,
            });
            searchRequestsUsed = searchRes.requestsUsed;
            searchOutcome = {
              ...searchRes.outcome,
              queries: Array.from(new Set([...searchOutcome.queries, ...searchRes.outcome.queries])),
            };
            emit({
              type: 'search_results',
              queries: searchOutcome.queries,
              sources: searchOutcome.sources,
              warning: searchOutcome.warning,
            });
            finishActivity('done', `Found ${searchOutcome.sources.length} source(s)`);
            return formatRetrievedSourcesForPrompt({
              sources: searchOutcome.sources,
              queries: searchOutcome.queries,
              allowFollowUpSearch: searchRequestsUsed < MAX_SEARCH_REQUESTS_PER_INTERACTION,
              remainingSearchBudget: MAX_SEARCH_REQUESTS_PER_INTERACTION - searchRequestsUsed,
            });
          } catch (err) {
            if (err instanceof WebSearchError && err.code === 'CANCELLED') throw err;
            const msg = err instanceof WebSearchError ? err.message : sanitizeErrorMessage(err);
            emit({ type: 'search_error', queries: [query], error: msg });
            finishActivity('error', msg);
            return JSON.stringify({ ok: false, error: msg });
          }
        }

        default: {
          if (!binding) {
            finishActivity('error', `Unknown tool ${call.function.name}`);
            return JSON.stringify({ ok: false, error: `Unknown tool "${call.function.name}"` });
          }

          const sensitivity = classifyMcpToolSensitivity(binding.tool);
          if (sensitivity.sensitive) {
            if (!params.requestMcpApproval) {
              finishActivity('error', 'Approval handler unavailable for sensitive MCP action');
              return JSON.stringify({
                ok: false,
                error: `External tool "${binding.tool.name}" on "${binding.server.name}" requires explicit user approval (${sensitivity.reason}).`,
              });
            }
            const approvalReq: McpApprovalRequest = {
              approvalId: createSafeId('mcp_apr'),
              serverId: binding.server.id,
              serverName: binding.server.name,
              toolName: binding.tool.name,
              description: binding.tool.description,
              arguments: args,
              reason: sensitivity.reason,
            };
            activity.status = 'awaiting_approval';
            activity.summary = `Awaiting approval for ${binding.tool.name}`;
            emit({ type: 'approval_required', approval: approvalReq, activity });

            const approved = await params.requestMcpApproval(approvalReq);
            if (!approved) {
              finishActivity('error', `User declined ${binding.tool.name}`);
              return JSON.stringify({
                ok: false,
                rejectedByUser: true,
                error: `User declined executing "${binding.tool.name}" on "${binding.server.name}". Do not retry unless the user asks again.`,
              });
            }
          }

          const mcpResult = await invokeMcpServerTool({
            server: binding.server,
            credential: binding.credential,
            toolName: binding.tool.name,
            args,
            options: {
              fetchImpl: params.mcpFetchImpl,
              skipDnsLookup: params.skipDnsLookup,
              lookupFn: params.lookupFn,
              signal: params.signal,
              onCredentialUpdated: params.onMcpCredentialUpdated,
            },
          });
          finishActivity(
            mcpResult.isError ? 'error' : 'done',
            `${binding.tool.name} (${mcpResult.isError ? 'error' : 'ok'})`,
          );
          return JSON.stringify({
            ok: !mcpResult.isError,
            server: binding.server.name,
            tool: binding.tool.name,
            result: mcpResult.text,
          });
        }
      }
    } catch (err) {
      if (params.signal.aborted) throw err;
      const msg = sanitizeErrorMessage(err);
      finishActivity('error', msg);
      return JSON.stringify({ ok: false, error: msg });
    }
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (params.signal.aborted) {
      throw new Error('Request cancelled.');
    }

    emit({
      type: 'phase',
      phase:
        iteration === 1
          ? `Agent planning with ${params.config.name || params.config.provider} (${params.config.model})...`
          : `Agent step ${iteration}/${maxIterations}...`,
      iteration,
      maxIterations,
    });

    let turn;
    try {
      turn = await callByokAgentTurn({
        config: params.config,
        messages,
        tools: usedToolsFallbackMode ? undefined : allTools,
        toolChoice: 'auto',
        jsonMode: usedToolsFallbackMode,
        temperature: 0.25,
        maxTokens: 12288,
        signal: params.signal,
        fetchImpl: params.aiFetchImpl,
        skipDnsLookup: params.skipDnsLookup,
      });
    } catch (err) {
      // If a multimodal vision turn fails with 400 on a non-vision model, degrade cleanly to text-only telemetry once!
      const msg = err instanceof Error ? err.message : '';
      const firstUser = messages[1];
      if (
        iteration === 1 &&
        Array.isArray(firstUser?.content) &&
        /400|image|vision|multimodal/i.test(msg)
      ) {
        const textOnly = firstUser.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        messages[1] = {
          role: 'user',
          content: `${textOnly}\n\n[Note: Active model rejected image attachments; using DOM & console telemetry only.]`,
        };
        turn = await callByokAgentTurn({
          config: params.config,
          messages,
          tools: usedToolsFallbackMode ? undefined : allTools,
          toolChoice: 'auto',
          jsonMode: usedToolsFallbackMode,
          temperature: 0.25,
          maxTokens: 12288,
          signal: params.signal,
          fetchImpl: params.aiFetchImpl,
          skipDnsLookup: params.skipDnsLookup,
        });
      } else {
        throw err;
      }
    }

    if (turn.toolsUnsupported) {
      usedToolsFallbackMode = true;
    }

    if (turn.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: turn.text || null,
        tool_calls: turn.toolCalls,
      });

      for (const call of turn.toolCalls) {
        const toolOutput = await executeSingleTool(call);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: toolOutput,
        });
      }
      continue;
    }

    // Model ended without tool calls
    const parsedFinal = extractJsonObjectSafe(turn.text);

    // Support search_more follow-up protocol for models without native tool calling
    if (
      parsedFinal?.action === 'search_more' &&
      Array.isArray(parsedFinal.queries) &&
      parsedFinal.queries.length > 0 &&
      params.searchService &&
      searchOutcome.status !== 'failed' &&
      searchRequestsUsed < MAX_SEARCH_REQUESTS_PER_INTERACTION &&
      iteration < maxIterations
    ) {
      const followUpQueries = parsedFinal.queries
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_SEARCH_REQUESTS_PER_INTERACTION - searchRequestsUsed);
      if (followUpQueries.length > 0) {
        emit({
          type: 'search_start',
          queries: followUpQueries,
          phase: 'Running follow-up web research...',
        });
        try {
          const followUpRes = await params.searchService.search({
            rawConfig: params.searchConfig,
            queries: followUpQueries,
            existingSources: searchOutcome.sources,
            maxRequestsInTurn: MAX_SEARCH_REQUESTS_PER_INTERACTION,
            usedRequestsSoFar: searchRequestsUsed,
            signal: params.signal,
            fetchImpl: params.searchFetchImpl,
            skipDnsLookup: params.skipDnsLookup,
          });
          searchRequestsUsed = followUpRes.requestsUsed;
          searchOutcome = {
            ...followUpRes.outcome,
            queries: Array.from(new Set([...searchOutcome.queries, ...followUpRes.outcome.queries])),
          };
          emit({
            type: 'search_results',
            queries: searchOutcome.queries,
            sources: searchOutcome.sources,
            warning: searchOutcome.warning,
          });
          const followContext = formatRetrievedSourcesForPrompt({
            sources: searchOutcome.sources,
            queries: searchOutcome.queries,
            allowFollowUpSearch: false,
            remainingSearchBudget: 0,
          });
          messages[1] = {
            role: 'user',
            content: buildInitialUserMessage(params, files, followContext),
          };
          continue;
        } catch (err) {
          if (err instanceof WebSearchError && err.code === 'CANCELLED') throw err;
          if (params.signal.aborted) throw err;
        }
      }
    }

    if (parsedFinal) {
      recordFilesFromParsedJson(parsedFinal);
    } else if (turn.text.trim()) {
      finalSummary = turn.text.trim();
    }

    // If zero files exist on a 'generate' call and no JSON files were returned, run a single-pass JSON repair
    if (params.mode === 'generate' && files.length === 0) {
      const repaired = await callByokCompletionRaw({
        config: params.config,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict JSON repair formatter. Extract and return ONLY valid JSON preserving every file path and code content faithfully without adding placeholders.',
          },
          {
            role: 'user',
            content: `Convert/repair this output into valid JSON strictly matching { "projectName"?, "description"?, "summary": string, "files": [{ "path": string, "language": string, "content": string }] }:\n\n${turn.text.slice(0, 28000)}`,
          },
        ],
        jsonMode: true,
        maxTokens: 12288,
        signal: params.signal,
        fetchImpl: params.aiFetchImpl,
        skipDnsLookup: params.skipDnsLookup,
      });
      const repairedObj = extractJsonObjectSafe(repaired);
      if (repairedObj) {
        recordFilesFromParsedJson(repairedObj);
      }
    }

    // Ensure every generated/edited project passes real sandbox TypeScript + esbuild compilation BEFORE completing!
    if ((dirtySinceLastBuild || lastBuildResult === null) && files.length > 0) {
      emit({ type: 'phase', phase: 'Verifying TypeScript & production build in Mist sandbox...' });
      const verifyTerm = await executeSandboxTerminalCommand({
        files,
        command: 'build',
        source: 'auto_verify',
        runBundle: params.runBundle,
      });
      terminalEntries.push(verifyTerm);
      emit({ type: 'terminal_output', entry: verifyTerm });
      lastBuildResult = { exitCode: verifyTerm.exitCode, stdout: verifyTerm.stdout, stderr: verifyTerm.stderr };
      if (verifyTerm.exitCode === 0) {
        dirtySinceLastBuild = false;
      }
    }

    if (lastBuildResult && lastBuildResult.exitCode !== 0 && iteration < maxIterations) {
      emit({ type: 'phase', phase: `Fixing build errors detected in Mist sandbox (step ${iteration + 1})...` });
      messages.push({ role: 'assistant', content: turn.text || 'Attempting verification.' });
      messages.push({
        role: 'user',
        content: `The Mist sandbox build failed with exit code ${lastBuildResult.exitCode}. Fix ALL reported errors using \`edit_file\` or \`write_file\` and run \`run_terminal({ "command": "build" })\`:\n\n${lastBuildResult.stderr || lastBuildResult.stdout}`,
      });
      continue;
    }

    break;
  }

  // Ensure root src/index.css exists
  if (files.length > 0 && !files.some((f) => f.path.toLowerCase() === 'src/index.css')) {
    const cssAdd = applyVfsWriteFile({
      files,
      path: 'src/index.css',
      content: '@import "tailwindcss";\n',
    });
    files = cssAdd.files;
  }

  const buildVerified = Boolean(lastBuildResult && lastBuildResult.exitCode === 0 && !dirtySinceLastBuild);
  const buildError =
    lastBuildResult && lastBuildResult.exitCode !== 0
      ? redactSecrets(lastBuildResult.stderr || lastBuildResult.stdout)
      : undefined;

  const activeSources = searchOutcome.status === 'performed' ? searchOutcome.sources : [];
  let cleanSummary =
    finalSummary ||
    (changedFiles.size > 0
      ? `Updated ${changedFiles.size} file${changedFiles.size === 1 ? '' : 's'} (${Array.from(changedFiles).join(', ')}).`
      : 'Completed analysis.');

  if (buildError && !cleanSummary.includes(buildError.slice(0, 40))) {
    cleanSummary = `${cleanSummary}\n\nBuild verification note: ${buildError.slice(0, 400)}`;
  }

  const citationCheck = validateAndExtractCitations(cleanSummary, activeSources);
  cleanSummary = citationCheck.cleanedText;
  searchOutcome = {
    ...searchOutcome,
    citedIds: citationCheck.citedIds,
  };

  return {
    projectName: finalProjectName || params.projectName || 'Mist App',
    description: finalDescription,
    summary: cleanSummary,
    files: validateProjectFilesPayload(files),
    changedFiles: Array.from(changedFiles),
    toolActivities,
    terminalEntries,
    searchOutcome,
    buildVerified,
    buildError,
  };
}
