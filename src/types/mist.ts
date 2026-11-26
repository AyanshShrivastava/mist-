export type FileLanguage = 'tsx' | 'ts' | 'css' | 'html' | 'json';

export interface ProjectFile {
  id: string;
  path: string;
  language: FileLanguage;
  content: string;
}

export type WebSearchProviderId = 'duckduckgo' | 'brave_llm_context' | 'brave_web' | 'custom_json';
export type WebSearchMode = 'auto' | 'on' | 'off';

export interface WebSearchConfig {
  provider: WebSearchProviderId;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  sessionOnlyKey?: boolean;
  maxResults?: number;
}

export interface WebSearchSource {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  snippet: string;
  hostname?: string;
}

export interface WebSearchOutcome {
  status: 'performed' | 'skipped' | 'no_results' | 'failed' | 'cancelled';
  queries: string[];
  sources: WebSearchSource[];
  citedIds?: string[];
  warning?: string;
  error?: string;
  searchedAt?: string;
  providerName?: string;
}

export interface AgentToolActivity {
  id: string;
  toolName: string;
  serverName?: string;
  status: 'running' | 'done' | 'error' | 'awaiting_approval';
  summary?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface TerminalLogEntry {
  id: string;
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timestamp: string;
  source: 'agent' | 'user' | 'auto_verify';
}

export interface PreviewConsoleEntry {
  id: string;
  level: 'log' | 'warn' | 'error' | 'runtime_error';
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: string;
}

export interface PreviewHealthSnapshot {
  capturedAt: string;
  rootHtmlLength: number;
  textLength: number;
  elementCount: number;
  canvasCount: number;
  horizontalOverflowPx: number;
  viewportWidth: number;
  viewportHeight: number;
  brokenImages: number;
  runtimeErrorCount: number;
  consoleErrorCount: number;
  screenshotDataUrl?: string;
  screenshotFormat?: 'png' | 'svg';
}

export type McpAuthType = 'none' | 'bearer' | 'oauth2';
export type McpTransportType = 'streamable_http' | 'sse';
export type McpConnectionStatus = 'connected' | 'disconnected' | 'auth_expired' | 'error';

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  authType: McpAuthType;
  transport?: McpTransportType;
  clientId?: string;
  scopes?: string[];
  enabled: boolean;
  presetId?: 'render' | 'github' | 'custom';
  createdAt?: string;
  updatedAt?: string;
}

export interface McpServerCredential {
  serverId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  registrationEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  sessionOnly?: boolean;
}

export interface McpServerPublicStatus {
  id: string;
  name: string;
  url: string;
  authType: McpAuthType;
  transport?: McpTransportType;
  enabled: boolean;
  presetId?: 'render' | 'github' | 'custom';
  status: McpConnectionStatus;
  hasCredential: boolean;
  credentialHint?: string;
  tokenExpiresAt?: string;
  lastCheckedAt?: string;
  lastError?: string;
  tools: McpToolDefinition[];
}

export interface McpApprovalRequest {
  approvalId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  changedFiles?: string[];
  searchOutcome?: WebSearchOutcome;
  toolActivities?: AgentToolActivity[];
  terminalEntries?: TerminalLogEntry[];
  previewHealth?: PreviewHealthSnapshot;
}

export interface MistProject {
  id: string;
  ownerId?: string;
  name: string;
  description: string;
  prompt: string;
  templateId?: string;
  appAiEnabled?: boolean;
  files: ProjectFile[];
  chatHistory: ChatMessage[];
  publishedSlug?: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AiProviderId = 'custom' | 'openrouter' | 'groq' | 'gemini';
export type PrimaryProviderId = 'custom';
export type ModelBilling = 'free' | 'paid' | 'unknown' | 'provider_billed';
export type ModelLifecycleStatus = 'active' | 'preview' | 'deprecated' | 'retired' | 'unverified';
export type CatalogSource = 'live' | 'cached' | 'preset';
export type AppAiMode = 'on_request' | 'always' | 'off';

export interface ModelCapabilities {
  textGeneration: boolean;
  jsonOutput: boolean | 'unknown';
  streaming: boolean | 'unknown';
  imageInput: boolean | 'unknown';
  toolCalling: boolean | 'unknown';
}

export interface ModelVerificationResult {
  gatewayBaseUrl: string;
  model: string;
  verified: boolean;
  testedAt: string;
  capabilities?: Partial<ModelCapabilities>;
}

export interface AiProviderConfig {
  provider: AiProviderId;
  name?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  sessionOnlyKey?: boolean;
}

export interface AiStreamProgress {
  phase: string;
  activeFile?: string;
  completedFiles: string[];
  charsReceived: number;
  startedAt: number;
  searchState?: 'idle' | 'searching' | 'done' | 'failed';
  searchQueries?: string[];
  searchSources?: WebSearchSource[];
  searchError?: string;
  iteration?: number;
  maxIterations?: number;
  toolActivities?: AgentToolActivity[];
  terminalEntries?: TerminalLogEntry[];
  pendingApproval?: McpApprovalRequest | null;
}

export interface ProjectSyncRecord {
  projectId: string;
  state: 'synced' | 'syncing' | 'local' | 'error';
  cloudFileCount?: number;
  lastSyncedAt?: string;
  error?: string;
}

export interface VisualElementStyles {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  borderRadius: string;
  textAlign: string;
}

export interface SelectedVisualElement {
  mistId: string;
  tagName: string;
  textContent: string;
  className: string;
  styles: VisualElementStyles;
  canEditText: boolean;
}

export interface VisualElementPatch {
  mistId: string;
  originalText?: string;
  newText?: string;
  styles?: Partial<VisualElementStyles>;
  deleted?: boolean;
}

export interface DeploymentRecord {
  slug: string;
  projectId: string;
  title: string;
  url: string;
  updatedAt: string;
}

export type WorkspaceViewMode = 'preview' | 'visual' | 'code' | 'split';
export type ViewportSize = 'desktop' | 'tablet' | 'mobile';

export interface StudioSettings {
  theme: 'dark' | 'light';
  defaultViewMode: WorkspaceViewMode;
  defaultViewport: ViewportSize;
  enableAppAi: boolean;
  appAiMode: AppAiMode;
  webSearchMode?: WebSearchMode;
  notifyOnAnswerDone?: boolean;
}

/**
 * Canonical Authenticated User in Mist.
 * Clerk is the sole authentication provider.
 * Firebase Auth is completely removed from the client and backend.
 */
export interface MistUser {
  /** Canonical Clerk User ID (e.g. 'user_2...') */
  id: string;
  /** Canonical Clerk User ID (alias for id) */
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  emailVerified: boolean;
  /** Resolves the active Clerk session JWT token for authenticating backend API requests */
  getIdToken: () => Promise<string | null>;
}

export type User = MistUser;

