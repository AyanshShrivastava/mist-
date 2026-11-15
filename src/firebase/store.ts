import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
import type { MistProject, ProjectFile } from '../types/mist';
import { createSafeId } from '../utils/projectOps';

const knownCloudProjects = new Set<string>();

export function clearKnownCloudProjects(): void {
  knownCloudProjects.clear();
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

export async function listUserProjectsFromFirestore(uid: string): Promise<MistProject[]> {
  const projectsPath = 'projects';
  try {
    const q = query(collection(db, projectsPath), where('ownerId', '==', uid));
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      if (!isOfflineFirestoreError(err)) throw err;
      await ensureFirestoreOnline();
      snap = await getDocs(q);
    }

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

      results.push({
        id: projectId,
        name: String(data.name || 'Untitled Website'),
        description: String(data.description || ''),
        prompt: String(data.prompt || ''),
        templateId: data.templateId ? String(data.templateId) : undefined,
        publishedSlug: data.publishedSlug ? String(data.publishedSlug) : undefined,
        isPublished: Boolean(data.isPublished),
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt),
        files,
        chatHistory: [
          {
            id: createSafeId('msg'),
            role: 'user',
            content: String(data.prompt || ''),
            timestamp: toIsoString(data.createdAt),
          },
        ],
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
            // Client temporarily offline; skip uncached getDoc failure and keep localStorage copy
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

          const batch = writeBatch(db);
          for (const file of project.files) {
            const fileRef = doc(db, 'projects', project.id, 'files', file.id);
            batch.set(fileRef, {
              id: file.id,
              projectId: project.id,
              ownerId: user.uid,
              path: file.path.slice(0, 256),
              language: file.language,
              content: file.content.slice(0, 200000),
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
          return;
        }

        const updatePayload: Record<string, unknown> = {
          name: safeName,
          description: safeDescription,
          prompt: safePrompt,
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

        const batch = writeBatch(db);
        for (const oldId of existingFileIds) {
          if (!currentFileIds.has(oldId)) {
            batch.delete(doc(db, 'projects', project.id, 'files', oldId));
          }
        }
        for (const file of project.files) {
          const fileRef = doc(db, 'projects', project.id, 'files', file.id);
          batch.set(fileRef, {
            id: file.id,
            projectId: project.id,
            ownerId: user.uid,
            path: file.path.slice(0, 256),
            language: file.language,
            content: file.content.slice(0, 200000),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (error) {
        if (isOfflineFirestoreError(error)) {
          return;
        }
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
  const projectPath = `projects/${projectId}`;
  try {
    const filesSnap = await getDocs(
      query(collection(db, 'projects', projectId, 'files'), where('ownerId', '==', user.uid)),
    );
    const batch = writeBatch(db);
    for (const fileDoc of filesSnap.docs) {
      batch.delete(fileDoc.ref);
    }
    batch.delete(doc(db, 'projects', projectId));
    await batch.commit();
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
        htmlBundle: params.htmlBundle.slice(0, 500000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: params.title.slice(0, 120),
        htmlBundle: params.htmlBundle.slice(0, 500000),
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

/**
 * Ensures every project belonging to the currently signed-in user is saved in Firestore.
 * Skips any project already verified in cloud unless forceAll is passed.
 */
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
