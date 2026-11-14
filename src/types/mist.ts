export type FileLanguage = 'tsx' | 'ts' | 'css' | 'html' | 'json';

export interface ProjectFile {
  id: string;
  path: string;
  language: FileLanguage;
  content: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  changedFiles?: string[];
}

export interface MistProject {
  id: string;
  name: string;
  description: string;
  prompt: string;
  templateId?: string;
  files: ProjectFile[];
  chatHistory: ChatMessage[];
  publishedSlug?: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AiProviderId = 'gemini' | 'openrouter' | 'groq' | 'custom';

export interface AiProviderConfig {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
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
