import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
  ProjectFile,
  ProjectSyncRecord,
  SelectedVisualElement,
  StudioSettings,
} from './types/mist';
import type { ModelHealthIncident } from './utils/aiErrors';
import { normalizeProviderConfigToStudio } from './data/models';
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
  checkFirestoreServerConnection,
  fetchUserProfilePreferences,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  syncUserProfile,
} from './firebase/client';
import {
  clearKnownCloudProjects,
  deleteProjectFromFirestore,
  getSyncRecordsSnapshot,
  listUserProjectsFromFirestore,
  saveDeploymentToFirestore,
  saveProjectToFirestore,
  subscribeToSyncStatus,
  syncLocalProjectsToFirestore,
  verifyUserProjectsInFirestore,
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
  return { provider: 'gemini', model: 'gemini-4-hydrogen' };
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

  // AI generation & refinement state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Deploy, Cloud Sync & Modals state
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isVerifyingCloud, setIsVerifyingCloud] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [syncRecords, setSyncRecords] = useState<Record<string, ProjectSyncRecord>>(() =>
    getSyncRecordsSnapshot(),
  );
  const [firestoreConnection, setFirestoreConnection] = useState<'checking' | 'online' | 'offline'>(
    'checking',
  );
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

  // Subscribe to per-project Firestore sync records & check Firestore connection
  useEffect(() => {
    const unsubSync = subscribeToSyncStatus(() => {
      setSyncRecords(getSyncRecordsSnapshot());
    });
    void checkFirestoreServerConnection().then((status) => {
      setFirestoreConnection(status);
    });
    return unsubSync;
  }, []);

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
            setFirestoreConnection('online');
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
          body: JSON.stringify({
            prompt,
            providerConfig: providerConfigRef.current,
            enableAppAi: studioSettingsRef.current.enableAppAi,
          }),
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
        setGenerationError(err instanceof Error ? err.message : 'Failed to generate website.');
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  // Subscribe once to Auth state changes; hydrate settings & sync ALL user projects in Firestore
  useEffect(() => {
    const unsub = subscribeToAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setAuthPromptReason(null);
        try {
          const cloudPrefs = await fetchUserProfilePreferences(firebaseUser);
          setFirestoreConnection('online');
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

          // Merge cloud + local projects and upload any unsynced projects to this user's Firestore account
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
          setLastVerifiedAt(new Date().toISOString());
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

  const handleSaveProvider = (rawNext: AiProviderConfig) => {
    const next = normalizeProviderConfigToStudio(rawNext);
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

  const handleSyncAllToCloud = async () => {
    if (!user) return;
    setIsSyncingAll(true);
    setLastSyncSummary(null);
    try {
      for (const project of projects) {
        await saveProjectToFirestore(project);
      }
      const verified = await verifyUserProjectsInFirestore(user.uid, projects);
      setFirestoreConnection('online');
      setLastVerifiedAt(verified.verifiedAt);
      setLastSyncSummary(
        `Synced & verified all ${projects.length} project${projects.length === 1 ? '' : 's'} in Firestore.`,
      );
    } catch (err) {
      setLastSyncSummary(
        err instanceof Error ? err.message : 'Failed to sync one or more projects.',
      );
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleVerifyFirestoreSync = async () => {
    if (!user) {
      const status = await checkFirestoreServerConnection();
      setFirestoreConnection(status);
      setLastVerifiedAt(new Date().toISOString());
      return;
    }
    setIsVerifyingCloud(true);
    setLastSyncSummary(null);
    try {
      const status = await checkFirestoreServerConnection();
      setFirestoreConnection(status);
      const res = await verifyUserProjectsInFirestore(user.uid, projectsRef.current);
      setLastVerifiedAt(res.verifiedAt);
      setLastSyncSummary(
        res.allSynced
          ? `Verified directly from Firestore server: ${projectsRef.current.length} of ${projectsRef.current.length} projects & file trees match.`
          : `Verified against Firestore server: found ${res.cloudProjectCount} cloud projects; some local edits are pending sync.`,
      );
    } catch (err) {
      setLastSyncSummary(
        err instanceof Error ? err.message : 'Unable to verify Firestore server state.',
      );
    } finally {
      setIsVerifyingCloud(false);
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
      clearKnownCloudProjects();
      setProjects([]);
      setActiveProjectId(null);
      setLastVerifiedAt(null);
      setLastSyncSummary(null);
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
          syncRecords={syncRecords}
          firestoreConnection={firestoreConnection}
          isSyncingAll={isSyncingAll}
          isVerifyingCloud={isVerifyingCloud}
          lastVerifiedAt={lastVerifiedAt}
          lastSyncSummary={lastSyncSummary}
          onBack={() => setActivePage('home')}
          onSaveProvider={handleSaveProvider}
          onUpdateSettings={handleUpdateSettings}
          onIncident={setModelIncident}
          onSyncAllToCloud={handleSyncAllToCloud}
          onVerifyCloudSync={handleVerifyFirestoreSync}
          onSignIn={() => void handleGoogleSignIn()}
          onSignOut={() => void handleSignOut()}
        />
      ) : activeProject ? (
        <WorkspaceView
          key={activeProject.id}
          project={activeProject}
          user={user}
          providerConfig={providerConfig}
          syncRecord={syncRecords[activeProject.id]}
          defaultViewMode={studioSettings.defaultViewMode}
          defaultViewport={studioSettings.defaultViewport}
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
          syncRecords={syncRecords}
          firestoreConnection={firestoreConnection}
          isSyncingAll={isSyncingAll}
          isGenerating={isGenerating}
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
          onSyncAllToCloud={() => void handleSyncAllToCloud()}
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
