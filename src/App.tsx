import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
  ProjectFile,
  SelectedVisualElement,
  VisualElementPatch,
} from './types/mist';
import type { ModelHealthIncident } from './utils/aiErrors';
import {
  applyVisualPatchToFiles,
  buildExportManifest,
  createSafeId,
  duplicateProjectData,
  inferLanguageFromPath,
  mergeProjectFiles,
  sanitizeSlug,
} from './utils/projectOps';
import {
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  syncUserProfile,
} from './firebase/client';
import {
  deleteProjectFromFirestore,
  listUserProjectsFromFirestore,
  saveDeploymentToFirestore,
  saveProjectToFirestore,
} from './firebase/store';
import HomeView from './components/HomeView';
import WorkspaceView from './components/WorkspaceView';
import VoiceChatModal from './components/VoiceChatModal';
import {
  AccountModal,
  DeploymentsModal,
  DeployModal,
  ProvidersModal,
} from './components/Modals';

const STORAGE_PROJECTS_KEY = 'mist_projects_v1';
const STORAGE_PROVIDER_KEY = 'mist_provider_v1';
const STORAGE_THEME_KEY = 'mist_theme_v1';

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
    if (raw) return JSON.parse(raw) as AiProviderConfig;
  } catch {
    // ignore
  }
  return { provider: 'gemini', model: 'gemini-4-hydrogen' };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const pendingGeneratePromptRef = useRef<string | null>(null);

  const [projects, setProjects] = useState<MistProject[]>(() => loadLocalProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig>(() => loadProviderConfig());
  const providerConfigRef = useRef(providerConfig);
  providerConfigRef.current = providerConfig;

  const [modelIncident, setModelIncident] = useState<ModelHealthIncident | null>(null);

  // Default to Dark Studio unless user explicitly saved 'light'
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_THEME_KEY) !== 'light';
    } catch {
      return true;
    }
  });

  // Live preview bundling state
  const [bundledHtml, setBundledHtml] = useState<string>('');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [isBundling, setIsBundling] = useState(false);

  // AI generation & refinement state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Deploy & Modals state
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const [providersOpen, setProvidersOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploymentsListOpen, setDeploymentsListOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const bundleTimerRef = useRef<number | null>(null);
  const cloudSaveTimerRef = useRef<number | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  // Persist local projects
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
    if (!activeProject) return;
    if (bundleTimerRef.current) window.clearTimeout(bundleTimerRef.current);
    bundleTimerRef.current = window.setTimeout(() => {
      void runBundle(activeProject);
    }, 180);
    return () => {
      if (bundleTimerRef.current) window.clearTimeout(bundleTimerRef.current);
    };
  }, [activeProject, runBundle]);

  // Persist project updates to state + debounced cloud sync
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
          setIsSavingCloud(true);
          try {
            await saveProjectToFirestore(snapshot);
          } catch {
            // Logged in firebase/client.ts
          } finally {
            setIsSavingCloud(false);
          }
        }, 700);
      }
    },
    [activeProjectId, user],
  );

  // Core generation executor
  const executeGenerateWebsite = useCallback(
    async (prompt: string, currentUser: User) => {
      setIsGenerating(true);
      setGenerationError(null);
      try {
        const resp = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, providerConfig: providerConfigRef.current }),
        });
        const data = (await resp.json()) as {
          projectName?: string;
          description?: string;
          summary?: string;
          files?: Array<{ path: string; language?: ProjectFile['language']; content: string }>;
          error?: string;
          incident?: ModelHealthIncident;
        };
        if (!resp.ok || !Array.isArray(data.files) || data.files.length === 0) {
          if (data.incident) setModelIncident(data.incident);
          throw new Error(data.incident?.message || data.error || 'AI did not return project files.');
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
          files: data.files.map((f) => ({
            id: createSafeId('file'),
            path: f.path.replace(/^\/+/, ''),
            language: f.language || inferLanguageFromPath(f.path),
            content: f.content,
          })),
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
        setActiveProjectId(newProject.id);
        if (currentUser) {
          void saveProjectToFirestore(newProject).catch(() => {});
        }
      } catch (err) {
        setGenerationError(err instanceof Error ? err.message : 'Failed to generate website.');
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  // Subscribe once to Auth state changes (never re-subscribe on provider changes)
  useEffect(() => {
    const unsub = subscribeToAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setAuthPromptReason(null);
        try {
          await syncUserProfile(firebaseUser, providerConfigRef.current.provider);
          const cloudProjects = await listUserProjectsFromFirestore(firebaseUser.uid);
          if (cloudProjects.length > 0) {
            setProjects((local) => {
              const merged = new Map<string, MistProject>();
              for (const p of local) merged.set(p.id, p);
              for (const cp of cloudProjects) merged.set(cp.id, cp);
              return Array.from(merged.values()).sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
              );
            });
          }
        } catch {
          // Errors logged in firebase/client.ts
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
      void saveProjectToFirestore(copy).catch(() => {});
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
    setIsRefining(true);
    setRefineError(null);
    try {
      const resp = await fetch('/api/ai/refine', {
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
      const data = (await resp.json()) as {
        summary?: string;
        files?: Array<{ path: string; language?: ProjectFile['language']; content: string }>;
        error?: string;
        incident?: ModelHealthIncident;
      };
      if (!resp.ok || !Array.isArray(data.files)) {
        if (data.incident) setModelIncident(data.incident);
        throw new Error(data.incident?.message || data.error || 'Refinement failed.');
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
      setRefineError(err instanceof Error ? err.message : 'Failed to apply refinement.');
    } finally {
      setIsRefining(false);
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

  const handleSaveProvider = (next: AiProviderConfig) => {
    setProviderConfig(next);
    setModelIncident((prev) =>
      prev && (prev.provider !== next.provider || prev.model !== next.model) ? null : prev,
    );
    try {
      localStorage.setItem(STORAGE_PROVIDER_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (user) {
      void syncUserProfile(user, next.provider).catch(() => {});
    }
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
      setAccountOpen(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  return (
    <>
      {activeProject ? (
        <WorkspaceView
          project={activeProject}
          user={user}
          providerConfig={providerConfig}
          modelIncident={modelIncident}
          bundledHtml={bundledHtml}
          bundleError={bundleError}
          isBundling={isBundling}
          isRefining={isRefining}
          refineError={refineError}
          isSavingCloud={isSavingCloud}
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
          generationError={generationError}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onGenerate={handleGenerateWebsite}
          onOpenVoiceChat={() => setVoiceChatOpen(true)}
          onOpenProject={(project) => setActiveProjectId(project.id)}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onOpenProviders={() => setProvidersOpen(true)}
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
        onClose={() => setVoiceChatOpen(false)}
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
