import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  AiStreamProgress,
  DeploymentRecord,
  MistProject,
  ProjectFile,
  SelectedVisualElement,
  StudioSettings,
} from './types/mist';
import type { ModelHealthIncident } from './utils/aiErrors';
import {
  DEFAULT_BYOK_CONFIG,
  normalizeProviderConfigToStudio,
} from './data/models';
import {
  applyVisualPatchToFiles,
  buildExportManifest,
  createSafeId,
  duplicateProjectData,
  inferLanguageFromPath,
  mergeProjectFiles,
  normalizeProjectFilePath,
  sanitizeSlug,
} from './utils/projectOps';
import {
  fetchUserProfilePreferences,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  syncUserProfile,
} from './firebase/client';
import {
  clearKnownCloudProjects,
  deleteProjectFromFirestore,
  listUserProjectsFromFirestore,
  saveDeploymentToFirestore,
  saveProjectToFirestore,
  syncLocalProjectsToFirestore,
} from './firebase/store';
import HomeView from './components/HomeView';
import WorkspaceView from './components/WorkspaceView';
import SettingsView from './components/SettingsView';
import VoiceChatModal from './components/VoiceChatModal';
import {
  AccountModal,
  DeploymentsModal,
  DeployModal,
  ProvidersModal,
} from './components/Modals';

const STORAGE_PROJECTS_KEY = 'mist_projects_v1';
const STORAGE_PROVIDER_KEY = 'mist_provider_v1';
const STORAGE_SETTINGS_KEY = 'mist_settings_v1';
const STORAGE_THEME_KEY = 'mist_theme_v1';

const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  theme: 'dark',
  defaultViewMode: 'preview',
  defaultViewport: 'desktop',
  enableAppAi: true,
};

function loadLocalProjects(): MistProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MistProject[]) : [];
  } catch {
    return [];
  }
}

function loadProviderConfig(): AiProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER_KEY);
    if (raw) {
      return normalizeProviderConfigToStudio(JSON.parse(raw) as AiProviderConfig);
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_BYOK_CONFIG };
}

function loadStudioSettings(): StudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_STUDIO_SETTINGS, ...(JSON.parse(raw) as Partial<StudioSettings>) };
    }
    const legacyTheme = localStorage.getItem(STORAGE_THEME_KEY);
    if (legacyTheme === 'light' || legacyTheme === 'dark') {
      return { ...DEFAULT_STUDIO_SETTINGS, theme: legacyTheme };
    }
  } catch {
    // ignore
  }
  return DEFAULT_STUDIO_SETTINGS;
}

interface SseStreamPayload {
  type: 'phase' | 'file_start' | 'file_done' | 'progress' | 'complete' | 'error';
  phase?: string;
  path?: string;
  activeFile?: string;
  completedFiles?: string[];
  chars?: number;
  result?: Record<string, unknown>;
  error?: string;
  incident?: ModelHealthIncident;
}

async function consumeAiSseStream(
  resp: Response,
  onEvent: (ev: SseStreamPayload) => void,
): Promise<Record<string, unknown>> {
  if (!resp.body) {
    throw new Error('Streaming response body unavailable.');
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completedResult: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nlIndex: number;
    while ((nlIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIndex).trim();
      buffer = buffer.slice(nlIndex + 1);
      if (!line.startsWith('data:')) continue;
      const rawJson = line.slice(5).trim();
      if (!rawJson) continue;
      const ev = JSON.parse(rawJson) as SseStreamPayload;
      onEvent(ev);
      if (ev.type === 'error') {
        const err = new Error(ev.incident?.message || ev.error || 'AI request failed.') as Error & {
          incident?: ModelHealthIncident;
        };
        err.incident = ev.incident;
        throw err;
      }
      if (ev.type === 'complete' && ev.result) {
        completedResult = ev.result;
      }
    }
  }

  if (!completedResult) {
    throw new Error('AI stream ended before returning generated files.');
  }
  return completedResult;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const pendingGeneratePromptRef = useRef<string | null>(null);

  const [projects, setProjects] = useState<MistProject[]>(() => loadLocalProjects());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<'home' | 'settings'>('home');
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig>(() => loadProviderConfig());
  const providerConfigRef = useRef(providerConfig);
  providerConfigRef.current = providerConfig;

  const [studioSettings, setStudioSettings] = useState<StudioSettings>(() => loadStudioSettings());
  const studioSettingsRef = useRef(studioSettings);
  studioSettingsRef.current = studioSettings;

  const [modelIncident, setModelIncident] = useState<ModelHealthIncident | null>(null);

  // Live preview bundling state
  const [bundledHtml, setBundledHtml] = useState<string>('');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [isBundling, setIsBundling] = useState(false);

  // AI generation & refinement streaming state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [aiStreamProgress, setAiStreamProgress] = useState<AiStreamProgress | null>(null);

  // Deploy & Modals state
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const [providersOpen, setProvidersOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploymentsListOpen, setDeploymentsListOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const darkMode = studioSettings.theme === 'dark';
  const bundleTimerRef = useRef<number | null>(null);
  const cloudSaveTimerRef = useRef<number | null>(null);

  // Sync dark mode class on <html> + persist studioSettings
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, studioSettings.theme);
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(studioSettings));
    } catch {
      // ignore
    }
  }, [darkMode, studioSettings]);

  // Persist local projects cache
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
    } catch {
      // ignore quota errors
    }
  }, [projects]);

  // Fetch deployments & AI status on mount
  const refreshDeployments = useCallback(async () => {
    try {
      const resp = await fetch('/api/deployments');
      if (resp.ok) {
        const data = (await resp.json()) as { deployments?: DeploymentRecord[] };
        if (Array.isArray(data.deployments)) {
          setDeployments(data.deployments);
        }
      }
    } catch {
      // ignore offline
    }
  }, []);

  useEffect(() => {
    void refreshDeployments();
    void (async () => {
      try {
        const resp = await fetch('/api/ai/status');
        if (resp.ok) {
          const data = (await resp.json()) as { incidents?: ModelHealthIncident[] };
          if (Array.isArray(data.incidents) && data.incidents.length > 0) {
            setModelIncident(data.incidents[0]);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [refreshDeployments]);

  // Bundle active project for live preview
  const runBundle = useCallback(async (project: MistProject) => {
    setIsBundling(true);
    try {
      const resp = await fetch('/api/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: project.files,
          title: project.name,
          includeInspector: true,
        }),
      });
      const data = (await resp.json()) as { html?: string; bundleError?: string; error?: string };
      if (!resp.ok) {
        setBundleError(data.error || 'Preview build failed.');
      } else {
        setBundledHtml(data.html || '');
        setBundleError(data.bundleError || null);
      }
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : 'Preview request failed.');
    } finally {
      setIsBundling(false);
    }
  }, []);

  useEffect(() => {
    if (!activeProject || activePage === 'settings') return;
    if (bundleTimerRef.current) window.clearTimeout(bundleTimerRef.current);
    bundleTimerRef.current = window.setTimeout(() => {
      void runBundle(activeProject);
    }, 180);
    return () => {
      if (bundleTimerRef.current) window.clearTimeout(bundleTimerRef.current);
    };
  }, [activeProject, activePage, runBundle]);

  // Persist project updates to state + background Firestore sync
  const updateActiveProject = useCallback(
    (updater: (prev: MistProject) => MistProject) => {
      if (!activeProjectId) return;
      let updatedProject: MistProject | null = null;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProjectId) return p;
          updatedProject = { ...updater(p), updatedAt: new Date().toISOString() };
          return updatedProject;
        }),
      );

      if (user && updatedProject) {
        const snapshot = updatedProject;
        if (cloudSaveTimerRef.current) window.clearTimeout(cloudSaveTimerRef.current);
        cloudSaveTimerRef.current = window.setTimeout(async () => {
          try {
            await saveProjectToFirestore(snapshot);
          } catch {
            // Logged silently in firebase/client.ts
          }
        }, 700);
      }
    },
    [activeProjectId, user],
  );

  // Core SSE streaming generation executor
  const executeGenerateWebsite = useCallback(
    async (prompt: string, currentUser: User) => {
      const cfg = providerConfigRef.current;
      if (!cfg.apiKey?.trim()) {
        setGenerationError(
          `Add your BYOK API key for ${cfg.name || 'your provider'} before generating.`,
        );
        setProvidersOpen(true);
        return;
      }

      setIsGenerating(true);
      setGenerationError(null);
      const startedAt = Date.now();
      setAiStreamProgress({
        phase: `Connecting to ${cfg.name || 'BYOK Provider'} (${cfg.model})...`,
        completedFiles: [],
        charsReceived: 0,
        startedAt,
      });

      try {
        const resp = await fetch('/api/ai/generate/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            providerConfig: cfg,
            enableAppAi: studioSettingsRef.current.enableAppAi,
          }),
        });

        if (!resp.ok) {
          throw new Error(`Generation failed (${resp.status}).`);
        }

        const data = (await consumeAiSseStream(resp, (ev) => {
          setAiStreamProgress((prev) => {
            const base = prev || {
              phase: 'Generating...',
              completedFiles: [],
              charsReceived: 0,
              startedAt,
            };
            if (ev.type === 'phase') {
              return {
                ...base,
                phase: ev.phase || base.phase,
                completedFiles: ev.completedFiles ?? base.completedFiles,
                charsReceived: ev.chars ?? base.charsReceived,
              };
            }
            if (ev.type === 'file_start') {
              return {
                ...base,
                phase: `Writing ${ev.path || 'file'}...`,
                activeFile: ev.path,
                completedFiles: ev.completedFiles ?? base.completedFiles,
                charsReceived: ev.chars ?? base.charsReceived,
              };
            }
            if (ev.type === 'file_done' && ev.path) {
              const nextCompleted = base.completedFiles.includes(ev.path)
                ? base.completedFiles
                : [...base.completedFiles, ev.path];
              return {
                ...base,
                completedFiles: nextCompleted,
              };
            }
            if (ev.type === 'progress') {
              return {
                ...base,
                activeFile: ev.activeFile ?? base.activeFile,
                completedFiles: ev.completedFiles ?? base.completedFiles,
                charsReceived: ev.chars ?? base.charsReceived,
              };
            }
            return base;
          });
        })) as {
          projectName?: string;
          description?: string;
          summary?: string;
          files?: Array<{ path: string; language?: ProjectFile['language']; content: string }>;
        };

        if (!Array.isArray(data.files) || data.files.length === 0) {
          throw new Error('AI did not return project files.');
        }

        setModelIncident(null);
        const now = new Date().toISOString();
        const newProject: MistProject = {
          id: createSafeId('proj'),
          name: (data.projectName || 'Generated Website').slice(0, 120),
          description: (data.description || prompt).slice(0, 500),
          prompt,
          isPublished: false,
          createdAt: now,
          updatedAt: now,
          files: data.files.map((f) => {
            const cleanPath = normalizeProjectFilePath(f.path);
            return {
              id: createSafeId('file'),
              path: cleanPath,
              language: f.language || inferLanguageFromPath(cleanPath),
              content: f.content,
            };
          }),
          chatHistory: [
            {
              id: createSafeId('msg'),
              role: 'user',
              content: prompt,
              timestamp: now,
            },
            {
              id: createSafeId('msg'),
              role: 'assistant',
              content:
                data.summary ||
                `Generated ${data.files.length} files for ${data.projectName || 'your site'}.`,
              timestamp: now,
              changedFiles: data.files.map((f) => f.path),
            },
          ],
        };

        setProjects((prev) => [newProject, ...prev]);
        setActivePage('home');
        setActiveProjectId(newProject.id);
        if (currentUser) {
          void saveProjectToFirestore(newProject, { isNew: true }).catch(() => {});
        }
      } catch (err) {
        const withIncident = err as Error & { incident?: ModelHealthIncident };
        if (withIncident.incident) setModelIncident(withIncident.incident);
        setGenerationError(err instanceof Error ? err.message : 'Failed to generate website.');
      } finally {
        setIsGenerating(false);
        setAiStreamProgress(null);
      }
    },
    [],
  );

  // Subscribe once to Auth state changes; hydrate settings & background cloud sync
  useEffect(() => {
    const unsub = subscribeToAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setAuthPromptReason(null);
        try {
          const cloudPrefs = await fetchUserProfilePreferences(firebaseUser);
          if (cloudPrefs) {
            if (cloudPrefs.preferredProvider || cloudPrefs.preferredModel) {
              setProviderConfig((prev) => {
                const updated = normalizeProviderConfigToStudio({
                  ...prev,
                  provider: cloudPrefs.preferredProvider || prev.provider,
                  model: cloudPrefs.preferredModel || prev.model,
                });
                try {
                  localStorage.setItem(STORAGE_PROVIDER_KEY, JSON.stringify(updated));
                } catch {
                  // ignore
                }
                return updated;
              });
            }
            setStudioSettings((prev) => ({
              theme: cloudPrefs.theme || prev.theme,
              defaultViewMode: cloudPrefs.defaultViewMode || prev.defaultViewMode,
              defaultViewport: cloudPrefs.defaultViewport || prev.defaultViewport,
              enableAppAi:
                typeof cloudPrefs.enableAppAi === 'boolean'
                  ? cloudPrefs.enableAppAi
                  : prev.enableAppAi,
            }));
          }

          await syncUserProfile(firebaseUser, {
            preferredProvider: cloudPrefs?.preferredProvider || providerConfigRef.current.provider,
            preferredModel: cloudPrefs?.preferredModel || providerConfigRef.current.model,
            theme: cloudPrefs?.theme || studioSettingsRef.current.theme,
            defaultViewMode: cloudPrefs?.defaultViewMode || studioSettingsRef.current.defaultViewMode,
            defaultViewport: cloudPrefs?.defaultViewport || studioSettingsRef.current.defaultViewport,
            enableAppAi:
              typeof cloudPrefs?.enableAppAi === 'boolean'
                ? cloudPrefs.enableAppAi
                : studioSettingsRef.current.enableAppAi,
          });

          const cloudProjects = await listUserProjectsFromFirestore(firebaseUser.uid);
          const cloudIds = new Set(cloudProjects.map((p) => p.id));
          const localOnly = projectsRef.current.filter((p) => !cloudIds.has(p.id));

          setProjects((local) => {
            const merged = new Map<string, MistProject>();
            for (const p of local) merged.set(p.id, p);
            for (const cp of cloudProjects) merged.set(cp.id, cp);
            return Array.from(merged.values()).sort((a, b) =>
              b.updatedAt.localeCompare(a.updatedAt),
            );
          });

          if (localOnly.length > 0) {
            await syncLocalProjectsToFirestore(localOnly, cloudIds);
          }
        } catch {
          // Errors logged silently in firebase/client.ts
        }

        if (pendingGeneratePromptRef.current) {
          const queued = pendingGeneratePromptRef.current;
          pendingGeneratePromptRef.current = null;
          void executeGenerateWebsite(queued, firebaseUser);
        }
      }
    });
    return unsub;
  }, [executeGenerateWebsite]);

  // Require sign-in when clicking Generate Website on the front page
  const handleGenerateWebsite = (prompt: string) => {
    if (!user) {
      pendingGeneratePromptRef.current = prompt;
      setAuthError(null);
      setAuthPromptReason('Sign in to generate and save your website with Mist.');
      setGenerationError('Please sign in to generate a website.');
      setAccountOpen(true);
      return;
    }
    void executeGenerateWebsite(prompt, user);
  };

  const handleDuplicateProject = (target: MistProject) => {
    const copy = duplicateProjectData(target);
    setProjects((prev) => [copy, ...prev]);
    setActiveProjectId(copy.id);
    if (user) {
      void saveProjectToFirestore(copy, { isNew: true }).catch(() => {});
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
    if (user) {
      void deleteProjectFromFirestore(projectId).catch(() => {});
    }
  };

  const handleRefineWithAi = async (
    instruction: string,
    selectedElement?: SelectedVisualElement | null,
  ) => {
    if (!activeProject) return;
    if (!providerConfig.apiKey?.trim()) {
      setRefineError(
        `Add your BYOK API key for ${providerConfig.name || 'your provider'} first.`,
      );
      setProvidersOpen(true);
      return;
    }

    setIsRefining(true);
    setRefineError(null);
    const startedAt = Date.now();
    setAiStreamProgress({
      phase: `Analyzing codebase with ${providerConfig.name || 'BYOK'} (${providerConfig.model})...`,
      completedFiles: [],
      charsReceived: 0,
      startedAt,
    });

    try {
      const resp = await fetch('/api/ai/refine/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          files: activeProject.files,
          selectedElement: selectedElement
            ? {
                tagName: selectedElement.tagName,
                textContent: selectedElement.textContent,
                className: selectedElement.className,
              }
            : undefined,
          providerConfig,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Refinement failed (${resp.status}).`);
      }

      const data = (await consumeAiSseStream(resp, (ev) => {
        setAiStreamProgress((prev) => {
          const base = prev || {
            phase: 'Refining...',
            completedFiles: [],
            charsReceived: 0,
            startedAt,
          };
          if (ev.type === 'phase') {
            return {
              ...base,
              phase: ev.phase || base.phase,
              completedFiles: ev.completedFiles ?? base.completedFiles,
              charsReceived: ev.chars ?? base.charsReceived,
            };
          }
          if (ev.type === 'file_start') {
            return {
              ...base,
              phase: `Editing ${ev.path || 'file'}...`,
              activeFile: ev.path,
              completedFiles: ev.completedFiles ?? base.completedFiles,
              charsReceived: ev.chars ?? base.charsReceived,
            };
          }
          if (ev.type === 'file_done' && ev.path) {
            const nextCompleted = base.completedFiles.includes(ev.path)
              ? base.completedFiles
              : [...base.completedFiles, ev.path];
            return {
              ...base,
              completedFiles: nextCompleted,
            };
          }
          if (ev.type === 'progress') {
            return {
              ...base,
              activeFile: ev.activeFile ?? base.activeFile,
              completedFiles: ev.completedFiles ?? base.completedFiles,
              charsReceived: ev.chars ?? base.charsReceived,
            };
          }
          return base;
        });
      })) as {
        summary?: string;
        files?: Array<{ path: string; language?: ProjectFile['language']; content: string }>;
      };

      if (!Array.isArray(data.files)) {
        throw new Error('Refinement did not return updated files.');
      }

      setModelIncident(null);
      const now = new Date().toISOString();
      const changedPaths = data.files.map((f) => f.path.replace(/^\/+/, ''));

      updateActiveProject((prev) => ({
        ...prev,
        files: mergeProjectFiles(prev.files, data.files!),
        chatHistory: [
          ...prev.chatHistory,
          { id: createSafeId('msg'), role: 'user', content: instruction, timestamp: now },
          {
            id: createSafeId('msg'),
            role: 'assistant',
            content: data.summary || 'Applied your refinement.',
            timestamp: now,
            changedFiles: changedPaths,
          },
        ],
      }));
    } catch (err) {
      const withIncident = err as Error & { incident?: ModelHealthIncident };
      if (withIncident.incident) setModelIncident(withIncident.incident);
      setRefineError(err instanceof Error ? err.message : 'Failed to apply refinement.');
    } finally {
      setIsRefining(false);
      setAiStreamProgress(null);
    }
  };

  const handleExportZip = async () => {
    if (!activeProject) return;
    const manifest = buildExportManifest(activeProject);
    const zip = new JSZip();
    for (const [filePath, content] of Object.entries(manifest)) {
      zip.file(filePath, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeSlug(activeProject.name)}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleDeployProject = async (slug: string) => {
    if (!activeProject) return;
    setIsDeploying(true);
    setDeployError(null);
    try {
      const resp = await fetch('/api/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          projectId: activeProject.id,
          title: activeProject.name,
          files: activeProject.files,
        }),
      });
      const data = (await resp.json()) as {
        slug?: string;
        url?: string;
        htmlBundle?: string;
        error?: string;
      };
      if (!resp.ok || !data.url || !data.slug) {
        throw new Error(data.error || 'Deployment failed.');
      }

      setPublishedUrl(data.url);
      const deployedProject: MistProject = {
        ...activeProject,
        isPublished: true,
        publishedSlug: data.slug,
        updatedAt: new Date().toISOString(),
      };
      updateActiveProject(() => deployedProject);

      if (user && data.htmlBundle) {
        await saveProjectToFirestore(deployedProject);
        await saveDeploymentToFirestore({
          slug: data.slug,
          projectId: activeProject.id,
          title: activeProject.name,
          htmlBundle: data.htmlBundle,
        });
      }
      await refreshDeployments();
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Failed to publish deployment.');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleDeleteDeployment = async (slug: string) => {
    try {
      await fetch(`/api/deployments/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      await refreshDeployments();
    } catch {
      // ignore
    }
  };

  const handleSaveProvider = (rawNext: AiProviderConfig) => {
    const next = normalizeProviderConfigToStudio(rawNext);
    setProviderConfig(next);
    setGenerationError(null);
    setRefineError(null);
    setModelIncident((prev) =>
      prev && (prev.provider !== next.provider || prev.model !== next.model) ? null : prev,
    );
    try {
      localStorage.setItem(STORAGE_PROVIDER_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (user) {
      void syncUserProfile(user, {
        preferredProvider: next.provider,
        preferredModel: next.model,
      }).catch(() => {});
    }
  };

  const handleUpdateSettings = (partial: Partial<StudioSettings>) => {
    setStudioSettings((prev) => {
      const next = { ...prev, ...partial };
      if (user) {
        void syncUserProfile(user, {
          theme: next.theme,
          defaultViewMode: next.defaultViewMode,
          defaultViewport: next.defaultViewport,
          enableAppAi: next.enableAppAi,
        }).catch(() => {});
      }
      return next;
    });
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
      setAccountOpen(false);
      setAuthPromptReason(null);
      setGenerationError(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    try {
      await signOutUser();
      clearKnownCloudProjects();
      setProjects([]);
      setActiveProjectId(null);
      try {
        localStorage.removeItem(STORAGE_PROJECTS_KEY);
      } catch {
        // ignore
      }
      setAccountOpen(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  return (
    <>
      {activePage === 'settings' ? (
        <SettingsView
          user={user}
          projects={projects}
          deployments={deployments}
          providerConfig={providerConfig}
          studioSettings={studioSettings}
          modelIncident={modelIncident}
          onBack={() => setActivePage('home')}
          onSaveProvider={handleSaveProvider}
          onUpdateSettings={handleUpdateSettings}
          onIncident={setModelIncident}
          onSignIn={() => void handleGoogleSignIn()}
          onSignOut={() => void handleSignOut()}
        />
      ) : activeProject ? (
        <WorkspaceView
          key={activeProject.id}
          project={activeProject}
          providerConfig={providerConfig}
          defaultViewMode={studioSettings.defaultViewMode}
          defaultViewport={studioSettings.defaultViewport}
          modelIncident={modelIncident}
          bundledHtml={bundledHtml}
          bundleError={bundleError}
          isBundling={isBundling}
          isRefining={isRefining}
          streamProgress={aiStreamProgress}
          refineError={refineError}
          onBackHome={() => {
            setActiveProjectId(null);
            setPublishedUrl(null);
          }}
          onUpdateProjectName={(name) =>
            updateActiveProject((prev) => ({ ...prev, name: name.slice(0, 120) }))
          }
          onChangeFileContent={(filePath, content) =>
            updateActiveProject((prev) => ({
              ...prev,
              files: prev.files.map((f) => (f.path === filePath ? { ...f, content } : f)),
            }))
          }
          onCreateFile={(filePath) =>
            updateActiveProject((prev) => ({
              ...prev,
              files: [
                ...prev.files,
                {
                  id: createSafeId('file'),
                  path: filePath,
                  language: inferLanguageFromPath(filePath),
                  content: `import React from 'react';\n\nexport default function Component() {\n  return <div>New component</div>;\n}\n`,
                },
              ],
            }))
          }
          onDeleteFile={(filePath) =>
            updateActiveProject((prev) => ({
              ...prev,
              files: prev.files.filter((f) => f.path !== filePath),
            }))
          }
          onCommitVisualPatch={(patch) =>
            updateActiveProject((prev) => ({
              ...prev,
              files: applyVisualPatchToFiles(prev.files, patch),
            }))
          }
          onRefineWithAi={handleRefineWithAi}
          onOpenVoiceChat={() => setVoiceChatOpen(true)}
          onRebundle={() => void runBundle(activeProject)}
          onDuplicateProject={() => handleDuplicateProject(activeProject)}
          onExportZip={() => void handleExportZip()}
          onOpenDeploy={() => {
            setDeployError(null);
            setPublishedUrl(
              activeProject.isPublished && activeProject.publishedSlug
                ? `/p/${activeProject.publishedSlug}`
                : null,
            );
            setDeployOpen(true);
          }}
          onOpenProviders={() => setProvidersOpen(true)}
          onOpenSettings={() => setActivePage('settings')}
          onOpenAccount={() => {
            setAuthPromptReason(null);
            setAccountOpen(true);
          }}
        />
      ) : (
        <HomeView
          user={user}
          projects={projects}
          deployments={deployments}
          providerConfig={providerConfig}
          modelIncident={modelIncident}
          isGenerating={isGenerating}
          streamProgress={aiStreamProgress}
          generationError={generationError}
          darkMode={darkMode}
          enableAppAi={studioSettings.enableAppAi}
          onToggleDarkMode={() =>
            handleUpdateSettings({ theme: darkMode ? 'light' : 'dark' })
          }
          onSaveProvider={handleSaveProvider}
          onGenerate={handleGenerateWebsite}
          onOpenVoiceChat={() => setVoiceChatOpen(true)}
          onOpenProject={(project) => setActiveProjectId(project.id)}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onOpenProviders={() => setProvidersOpen(true)}
          onOpenSettings={() => setActivePage('settings')}
          onOpenDeployments={() => {
            void refreshDeployments();
            setDeploymentsListOpen(true);
          }}
          onOpenAccount={() => {
            setAuthPromptReason(null);
            setAccountOpen(true);
          }}
        />
      )}

      <ProvidersModal
        isOpen={providersOpen}
        config={providerConfig}
        modelIncident={modelIncident}
        onClose={() => setProvidersOpen(false)}
        onSave={handleSaveProvider}
        onIncident={setModelIncident}
      />

      <DeployModal
        isOpen={deployOpen}
        project={activeProject}
        isDeploying={isDeploying}
        deployError={deployError}
        publishedUrl={publishedUrl}
        onClose={() => setDeployOpen(false)}
        onDeploy={(slug) => void handleDeployProject(slug)}
      />

      <DeploymentsModal
        isOpen={deploymentsListOpen}
        deployments={deployments}
        onClose={() => setDeploymentsListOpen(false)}
        onDeleteDeployment={(slug) => void handleDeleteDeployment(slug)}
      />

      <AccountModal
        isOpen={accountOpen}
        user={user}
        authError={authError}
        promptReason={authPromptReason}
        onClose={() => {
          setAccountOpen(false);
          setAuthPromptReason(null);
        }}
        onSignIn={() => void handleGoogleSignIn()}
        onSignOut={() => void handleSignOut()}
      />

      <VoiceChatModal
        isOpen={voiceChatOpen}
        mode={activeProject ? 'refine' : 'create'}
        projectName={activeProject?.name}
        providerConfig={providerConfig}
        onClose={() => setVoiceChatOpen(false)}
        onOpenProviders={() => setProvidersOpen(true)}
        onIncident={(incident) => setModelIncident(incident)}
        onApplyPrompt={(synthesized) => {
          if (activeProject) {
            void handleRefineWithAi(synthesized);
          } else {
            handleGenerateWebsite(synthesized);
          }
        }}
      />
    </>
  );
}
