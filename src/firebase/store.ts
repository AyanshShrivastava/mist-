import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  ensureFirestoreOnline,
  getDocServerOrCache,
  handleFirestoreError,
  isOfflineFirestoreError,
  OperationType,
} from './client';
import type {
  ChatMessage,
  MistProject,
  ProjectFile,
  ProjectSyncRecord,
  WebSearchOutcome,
  WebSearchSource,
} from '../types/mist';
import { createSafeId } from '../utils/projectOps';

import { chunkOperations, FIRESTORE_SAFE_BATCH_LIMIT } from './batchOps';

export { chunkOperations, FIRESTORE_SAFE_BATCH_LIMIT };

type BatchWriteOp =
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'delete'; ref: DocumentReference };

async function commitChunkedBatchOps(ops: BatchWriteOp[]): Promise<void> {
  const chunks = chunkOperations(ops, FIRESTORE_SAFE_BATCH_LIMIT);
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.set(op.ref, op.data);
      }
    }
    await batch.commit();
  }
}

const knownCloudProjects = new Set<string>();
const syncRecords = new Map<string, ProjectSyncRecord>();
const syncListeners = new Set<() => void>();

function notifySyncListeners() {
  for (const listener of syncListeners) {
    listener();
  }
}

export function subscribeToSyncStatus(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => {
    syncListeners.delete(listener);
  };
}

export function getSyncRecordsSnapshot(): Record<string, ProjectSyncRecord> {
  const out: Record<string, ProjectSyncRecord> = {};
  for (const [id, rec] of syncRecords.entries()) {
    out[id] = rec;
  }
  return out;
}

function setProjectSyncRecord(record: ProjectSyncRecord) {
  syncRecords.set(record.projectId, record);
  notifySyncListeners();
}

export function clearKnownCloudProjects(): void {
  knownCloudProjects.clear();
  syncRecords.clear();
  notifySyncListeners();
}

export function isProjectSyncedToCloud(projectId: string): boolean {
  return knownCloudProjects.has(projectId);
}

function toIsoString(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function sanitizeMessageDocId(rawId: unknown, fallbackIdx: number): string {
  const cleaned = typeof rawId === 'string' ? rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) : '';
  return cleaned || createSafeId(`msg_${fallbackIdx}`);
}

function sanitizeSearchOutcomeForFirestore(
  outcome?: WebSearchOutcome,
): Record<string, unknown> | undefined {
  if (!outcome || typeof outcome !== 'object') return undefined;
  const cleanSources: WebSearchSource[] = Array.isArray(outcome.sources)
    ? outcome.sources.slice(0, 12).map((s, idx) => {
        const cleanSource: WebSearchSource = {
          id: String(s.id || `S${idx + 1}`).slice(0, 16),
          title: String(s.title || 'Source').slice(0, 240),
          url: String(s.url || '').slice(0, 1024),
          snippet: String(s.snippet || '').slice(0, 1200),
        };
        if (typeof s.publishedDate === 'string' && s.publishedDate) {
          cleanSource.publishedDate = s.publishedDate.slice(0, 64);
        }
        if (typeof s.hostname === 'string' && s.hostname) {
          cleanSource.hostname = s.hostname.slice(0, 128);
        }
        return cleanSource;
      })
    : [];

  const result: Record<string, unknown> = {
    status: outcome.status || 'skipped',
    queries: Array.isArray(outcome.queries)
      ? outcome.queries.slice(0, 6).map((q) => String(q).slice(0, 240))
      : [],
    sources: cleanSources,
  };
  if (Array.isArray(outcome.citedIds)) {
    result.citedIds = outcome.citedIds.slice(0, 16).map((id) => String(id).slice(0, 16));
  }
  if (typeof outcome.warning === 'string' && outcome.warning) {
    result.warning = outcome.warning.slice(0, 500);
  }
  if (typeof outcome.error === 'string' && outcome.error) {
    result.error = outcome.error.slice(0, 500);
  }
  if (typeof outcome.searchedAt === 'string' && outcome.searchedAt) {
    result.searchedAt = outcome.searchedAt.slice(0, 64);
  }
  if (typeof outcome.providerName === 'string' && outcome.providerName) {
    result.providerName = outcome.providerName.slice(0, 120);
  }
  return result;
}

function sanitizeMessageForFirestore(
  msg: ChatMessage,
  seq: number,
  projectId: string,
  ownerId: string,
): { id: string; data: Record<string, unknown> } {
  const safeId = sanitizeMessageDocId(msg.id, seq);
  const safeSeq = Math.max(0, Math.min(100000, Math.floor(seq)));
  const data: Record<string, unknown> = {
    id: safeId,
    projectId,
    ownerId,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: String(msg.content || '').slice(0, 24000),
    seq: safeSeq,
    timestamp: String(msg.timestamp || new Date().toISOString()).slice(0, 64) || new Date().toISOString(),
    updatedAt: serverTimestamp(),
  };
  if (Array.isArray(msg.changedFiles)) {
    data.changedFiles = msg.changedFiles
      .map((p) => String(p).slice(0, 256))
      .filter(Boolean)
      .slice(0, 120);
  }
  const cleanOutcome = sanitizeSearchOutcomeForFirestore(msg.searchOutcome);
  if (cleanOutcome) {
    data.searchOutcome = cleanOutcome;
  }
  return { id: safeId, data };
}

export async function listUserProjectsFromFirestore(uid: string): Promise<MistProject[]> {
  const projectsPath = 'projects';
  try {
    const q = query(collection(db, projectsPath), where('ownerId', '==', uid));
    let snap;
    try {
      snap = await getDocsFromServer(q);
    } catch (err) {
      if (!isOfflineFirestoreError(err)) throw err;
      await ensureFirestoreOnline();
      snap = await getDocs(q);
    }

    const now = new Date().toISOString();
    const results: MistProject[] = [];
    for (const projectDoc of snap.docs) {
      const data = projectDoc.data();
      const projectId = String(data.id || projectDoc.id);
      knownCloudProjects.add(projectId);

      const filesPath = `projects/${projectDoc.id}/files`;
      let files: ProjectFile[] = [];
      try {
        const filesQuery = query(collection(db, 'projects', projectDoc.id, 'files'), where('ownerId', '==', uid));
        const filesSnap = await getDocs(filesQuery);
        files = filesSnap.docs.map((f) => {
          const fd = f.data();
          return {
            id: String(fd.id || f.id),
            path: String(fd.path || 'src/App.tsx'),
            language: (fd.language || 'tsx') as ProjectFile['language'],
            content: String(fd.content || ''),
          };
        });
      } catch (fileErr) {
        if (!isOfflineFirestoreError(fileErr)) {
          handleFirestoreError(fileErr, OperationType.LIST, filesPath);
        }
      }

      const messagesPath = `projects/${projectDoc.id}/messages`;
      let chatHistory: ChatMessage[] = [];
      try {
        const msgsQuery = query(collection(db, 'projects', projectDoc.id, 'messages'), where('ownerId', '==', uid));
        const msgsSnap = await getDocs(msgsQuery);
        chatHistory = msgsSnap.docs
          .map((m) => {
            const md = m.data();
            return {
              seq: typeof md.seq === 'number' ? md.seq : 0,
              message: {
                id: String(md.id || m.id),
                role: (md.role === 'assistant' ? 'assistant' : 'user') as ChatMessage['role'],
                content: String(md.content || ''),
                timestamp: String(md.timestamp || toIsoString(data.createdAt)),
                changedFiles: Array.isArray(md.changedFiles)
                  ? md.changedFiles.map((f) => String(f))
                  : undefined,
                searchOutcome:
                  md.searchOutcome && typeof md.searchOutcome === 'object'
                    ? (md.searchOutcome as WebSearchOutcome)
                    : undefined,
              },
            };
          })
          .sort((a, b) => a.seq - b.seq)
          .map((entry) => entry.message);
      } catch (msgErr) {
        if (!isOfflineFirestoreError(msgErr)) {
          handleFirestoreError(msgErr, OperationType.LIST, messagesPath);
        }
      }

      if (chatHistory.length === 0) {
        chatHistory = [
          {
            id: createSafeId('msg'),
            role: 'user',
            content: String(data.prompt || ''),
            timestamp: toIsoString(data.createdAt),
          },
        ];
      }

      setProjectSyncRecord({
        projectId,
        state: 'synced',
        cloudFileCount: files.length,
        lastSyncedAt: now,
      });

      results.push({
        id: projectId,
        name: String(data.name || 'Untitled Website'),
        description: String(data.description || ''),
        prompt: String(data.prompt || ''),
        templateId: data.templateId ? String(data.templateId) : undefined,
        appAiEnabled: typeof data.appAiEnabled === 'boolean' ? data.appAiEnabled : undefined,
        publishedSlug: data.publishedSlug ? String(data.publishedSlug) : undefined,
        isPublished: Boolean(data.isPublished),
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt),
        files,
        chatHistory,
      });
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if (isOfflineFirestoreError(error)) {
      return [];
    }
    handleFirestoreError(error, OperationType.LIST, projectsPath);
  }
}

export async function verifyUserProjectsInFirestore(
  uid: string,
  localProjects: MistProject[],
): Promise<{
  verifiedAt: string;
  cloudProjectCount: number;
  allSynced: boolean;
}> {
  const verifiedAt = new Date().toISOString();
  const q = query(collection(db, 'projects'), where('ownerId', '==', uid));
  let snap;
  try {
    snap = await getDocsFromServer(q);
  } catch (err) {
    if (isOfflineFirestoreError(err)) {
      await ensureFirestoreOnline();
      snap = await getDocsFromServer(q);
    } else {
      handleFirestoreError(err, OperationType.LIST, 'projects');
    }
  }

  const cloudCounts = new Map<string, number>();
  for (const projectDoc of snap.docs) {
    const pid = String(projectDoc.data().id || projectDoc.id);
    knownCloudProjects.add(pid);
    const filesSnap = await getDocsFromServer(
      query(collection(db, 'projects', pid, 'files'), where('ownerId', '==', uid)),
    );
    cloudCounts.set(pid, filesSnap.size);
  }

  let allSynced = true;
  for (const p of localProjects) {
    const cloudCount = cloudCounts.get(p.id);
    if (cloudCount === undefined) {
      allSynced = false;
      knownCloudProjects.delete(p.id);
      setProjectSyncRecord({
        projectId: p.id,
        state: 'local',
        cloudFileCount: 0,
      });
    } else {
      const filesMatch = cloudCount === p.files.length;
      if (!filesMatch) allSynced = false;
      setProjectSyncRecord({
        projectId: p.id,
        state: filesMatch ? 'synced' : 'local',
        cloudFileCount: cloudCount,
        lastSyncedAt: verifiedAt,
      });
    }
  }

  return {
    verifiedAt,
    cloudProjectCount: cloudCounts.size,
    allSynced,
  };
}

const projectSaveQueue = new Map<string, Promise<void>>();

export async function saveProjectToFirestore(
  project: MistProject,
  options?: { isNew?: boolean },
): Promise<void> {
  const prev = projectSaveQueue.get(project.id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const user = auth.currentUser;
      if (!user) return;

      setProjectSyncRecord({
        projectId: project.id,
        state: 'syncing',
        cloudFileCount: syncRecords.get(project.id)?.cloudFileCount,
        lastSyncedAt: syncRecords.get(project.id)?.lastSyncedAt,
      });

      const projectPath = `projects/${project.id}`;
      const projectRef = doc(db, 'projects', project.id);

      try {
        const safeName = (project.name || 'Untitled Website').slice(0, 120);
        const safeDescription = (project.description || '').slice(0, 500);
        const safePrompt = (project.prompt || '').slice(0, 4000);

        let shouldCreate = Boolean(options?.isNew && !knownCloudProjects.has(project.id));

        if (!shouldCreate && !knownCloudProjects.has(project.id)) {
          const existing = await getDocServerOrCache(projectRef);
          if (!existing) {
            setProjectSyncRecord({
              projectId: project.id,
              state: 'local',
              error: 'Firestore unreachable (offline)',
            });
            return;
          }
          shouldCreate = !existing.exists();
          if (existing.exists()) {
            knownCloudProjects.add(project.id);
          }
        }

        if (shouldCreate) {
          const payload: Record<string, unknown> = {
            id: project.id,
            ownerId: user.uid,
            name: safeName,
            description: safeDescription,
            prompt: safePrompt,
            appAiEnabled: Boolean(project.appAiEnabled),
            isPublished: Boolean(project.isPublished),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (project.templateId) {
            payload.templateId = project.templateId.slice(0, 64);
          }
          if (project.publishedSlug) {
            payload.publishedSlug = project.publishedSlug.slice(0, 80);
          }
          await setDoc(projectRef, payload);
          knownCloudProjects.add(project.id);

          const createOps: BatchWriteOp[] = project.files.map((file) => ({
            type: 'set',
            ref: doc(db, 'projects', project.id, 'files', file.id),
            data: {
              id: file.id,
              projectId: project.id,
              ownerId: user.uid,
              path: file.path.slice(0, 256),
              language: file.language,
              content: file.content.slice(0, 200000),
              updatedAt: serverTimestamp(),
            },
          }));
          (project.chatHistory || []).slice(-100).forEach((msg, idx) => {
            const sanitized = sanitizeMessageForFirestore(msg, idx, project.id, user.uid);
            createOps.push({
              type: 'set',
              ref: doc(db, 'projects', project.id, 'messages', sanitized.id),
              data: sanitized.data,
            });
          });
          await commitChunkedBatchOps(createOps);
          setProjectSyncRecord({
            projectId: project.id,
            state: 'synced',
            cloudFileCount: project.files.length,
            lastSyncedAt: new Date().toISOString(),
          });
          return;
        }

        const updatePayload: Record<string, unknown> = {
          name: safeName,
          description: safeDescription,
          prompt: safePrompt,
          appAiEnabled: Boolean(project.appAiEnabled),
          isPublished: Boolean(project.isPublished),
          updatedAt: serverTimestamp(),
        };
        if (project.publishedSlug !== undefined) {
          updatePayload.publishedSlug = project.publishedSlug.slice(0, 80);
        }
        await updateDoc(projectRef, updatePayload);

        let existingFileIds = new Set<string>();
        try {
          const existingFilesSnap = await getDocs(
            query(collection(db, 'projects', project.id, 'files'), where('ownerId', '==', user.uid)),
          );
          existingFileIds = new Set(existingFilesSnap.docs.map((d) => d.id));
        } catch (filesErr) {
          if (!isOfflineFirestoreError(filesErr)) {
            throw filesErr;
          }
        }
        const currentFileIds = new Set(project.files.map((f) => f.id));

        const ops: BatchWriteOp[] = [];
        for (const oldId of existingFileIds) {
          if (!currentFileIds.has(oldId)) {
            ops.push({
              type: 'delete',
              ref: doc(db, 'projects', project.id, 'files', oldId),
            });
          }
        }
        for (const file of project.files) {
          ops.push({
            type: 'set',
            ref: doc(db, 'projects', project.id, 'files', file.id),
            data: {
              id: file.id,
              projectId: project.id,
              ownerId: user.uid,
              path: file.path.slice(0, 256),
              language: file.language,
              content: file.content.slice(0, 200000),
              updatedAt: serverTimestamp(),
            },
          });
        }
        let existingMsgIds = new Set<string>();
        try {
          const existingMsgsSnap = await getDocs(
            query(collection(db, 'projects', project.id, 'messages'), where('ownerId', '==', user.uid)),
          );
          existingMsgIds = new Set(existingMsgsSnap.docs.map((d) => d.id));
        } catch (msgsErr) {
          if (!isOfflineFirestoreError(msgsErr)) {
            throw msgsErr;
          }
        }

        const sanitizedMsgs = (project.chatHistory || [])
          .slice(-100)
          .map((msg, idx) => sanitizeMessageForFirestore(msg, idx, project.id, user.uid));
        const currentMsgIds = new Set(sanitizedMsgs.map((m) => m.id));
        for (const oldMsgId of existingMsgIds) {
          if (!currentMsgIds.has(oldMsgId)) {
            ops.push({
              type: 'delete',
              ref: doc(db, 'projects', project.id, 'messages', oldMsgId),
            });
          }
        }
        for (const msgEntry of sanitizedMsgs) {
          ops.push({
            type: 'set',
            ref: doc(db, 'projects', project.id, 'messages', msgEntry.id),
            data: msgEntry.data,
          });
        }

        await commitChunkedBatchOps(ops);
        setProjectSyncRecord({
          projectId: project.id,
          state: 'synced',
          cloudFileCount: project.files.length,
          lastSyncedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (isOfflineFirestoreError(error)) {
          setProjectSyncRecord({
            projectId: project.id,
            state: 'local',
            error: 'Offline — queued locally',
          });
          return;
        }
        setProjectSyncRecord({
          projectId: project.id,
          state: 'error',
          error: error instanceof Error ? error.message : 'Sync failed',
        });
        handleFirestoreError(error, OperationType.WRITE, projectPath);
      }
    });

  projectSaveQueue.set(project.id, next);
  try {
    await next;
  } finally {
    if (projectSaveQueue.get(project.id) === next) {
      projectSaveQueue.delete(project.id);
    }
  }
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  knownCloudProjects.delete(projectId);
  syncRecords.delete(projectId);
  notifySyncListeners();

  const projectPath = `projects/${projectId}`;
  try {
    const [filesSnap, msgsSnap] = await Promise.all([
      getDocs(query(collection(db, 'projects', projectId, 'files'), where('ownerId', '==', user.uid))),
      getDocs(query(collection(db, 'projects', projectId, 'messages'), where('ownerId', '==', user.uid))),
    ]);
    // Delete all subcollection files and messages first, then delete the parent project document LAST
    // so Firestore Master Gate exists(/projects/{projectId}) remains valid across every batch chunk.
    const ops: BatchWriteOp[] = [
      ...filesSnap.docs.map((fileDoc) => ({ type: 'delete' as const, ref: fileDoc.ref })),
      ...msgsSnap.docs.map((msgDoc) => ({ type: 'delete' as const, ref: msgDoc.ref })),
      { type: 'delete' as const, ref: doc(db, 'projects', projectId) },
    ];
    await commitChunkedBatchOps(ops);
  } catch (error) {
    if (isOfflineFirestoreError(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, projectPath);
  }
}

export async function saveDeploymentToFirestore(params: {
  slug: string;
  projectId: string;
  title: string;
  htmlBundle: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const deployPath = `deployments/${params.slug}`;
  const ref = doc(db, 'deployments', params.slug);
  try {
    const existing = await getDocServerOrCache(ref);
    if (!existing) {
      return;
    }
    if (!existing.exists()) {
      await setDoc(ref, {
        slug: params.slug,
        ownerId: user.uid,
        projectId: params.projectId,
        title: params.title.slice(0, 120),
        htmlBundle: params.htmlBundle.slice(0, 900000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: params.title.slice(0, 120),
        htmlBundle: params.htmlBundle.slice(0, 900000),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    if (isOfflineFirestoreError(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, deployPath);
  }
}

export async function syncLocalProjectsToFirestore(
  projects: MistProject[],
  cloudIds?: Set<string>,
): Promise<number> {
  const user = auth.currentUser;
  if (!user || projects.length === 0) return 0;

  let syncedCount = 0;
  for (const project of projects) {
    const alreadyInCloud = cloudIds ? cloudIds.has(project.id) : knownCloudProjects.has(project.id);
    if (!alreadyInCloud) {
      await saveProjectToFirestore(project, { isNew: true });
      syncedCount++;
    }
  }
  return syncedCount;
}
