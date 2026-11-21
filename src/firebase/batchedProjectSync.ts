/**
 * Local-First Batched Sync Manager for Mist Projects.
 *
 * All modifications are saved instantly to the browser's local cache.
 * There is NO periodic 10-second sync timer: network/cloud sync happens
 * strictly when the user closes the app, reloads, or navigates away.
 * On exit, pending files and projects are read and dumped to backend /api/projects/sync-dump
 * with keepalive: true, scoped to the verified Clerk account.
 */

import type { MistProject, MistUser } from '../types/mist';
import { mistApi } from '../utils/apiClient';

export function getDirtyProjectsStorageKey(userId?: string | null): string {
  return userId ? `mist_dirty_projects_${userId}` : 'mist_dirty_projects_anonymous';
}

const pendingDirtyProjects = new Map<string, MistProject>();
let isFlushing = false;

let currentUserProvider: () => MistUser | null = () => null;

export function setBatchedSyncUserProvider(provider: () => MistUser | null): void {
  currentUserProvider = provider;
}

export function clearPendingDirtyQueue(): void {
  pendingDirtyProjects.clear();
}

export function initLocalCacheQueue(userId?: string | null): void {
  try {
    pendingDirtyProjects.clear();
    const effectiveUid = userId || currentUserProvider()?.uid;
    const storageKey = getDirtyProjectsStorageKey(effectiveUid);
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (p && p.id) {
            pendingDirtyProjects.set(p.id, p);
          }
        }
      }
    }
  } catch {
    // Ignore local storage errors
  }
}

function persistDirtyQueueToLocalCache(userId?: string | null): void {
  try {
    const effectiveUid = userId || currentUserProvider()?.uid;
    const storageKey = getDirtyProjectsStorageKey(effectiveUid);
    const array = Array.from(pendingDirtyProjects.values());
    if (array.length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(array));
    }
  } catch {
    // Ignore quota errors
  }
}

export function queueProjectForBatchedSync(project: MistProject, userId?: string | null): void {
  pendingDirtyProjects.set(project.id, project);
  persistDirtyQueueToLocalCache(userId);
}

export function dequeueProjectFromBatchedSync(projectId: string, userId?: string | null): void {
  pendingDirtyProjects.delete(projectId);
  persistDirtyQueueToLocalCache(userId);
}

export async function flushBatchedSyncNow(user?: MistUser | null): Promise<{ synced: number; remaining: number }> {
  if (isFlushing || pendingDirtyProjects.size === 0) {
    return { synced: 0, remaining: pendingDirtyProjects.size };
  }

  const activeUser = user || currentUserProvider();
  if (!activeUser) {
    return { synced: 0, remaining: pendingDirtyProjects.size };
  }

  isFlushing = true;
  const snapshot = Array.from(pendingDirtyProjects.values());

  try {
    const token = await activeUser.getIdToken();
    const res = await mistApi.syncProjects(snapshot, token);
    for (const p of snapshot) {
      pendingDirtyProjects.delete(p.id);
    }
    return { synced: res.synced, remaining: pendingDirtyProjects.size };
  } catch (err) {
    console.warn('[BatchedSync] Flush failure:', err);
    return { synced: 0, remaining: pendingDirtyProjects.size };
  } finally {
    persistDirtyQueueToLocalCache();
    isFlushing = false;
  }
}

export async function flushBatchedSyncOnAppExit(user?: MistUser | null): Promise<void> {
  const activeUser = user || currentUserProvider();
  if (!activeUser) return;

  initLocalCacheQueue();
  if (pendingDirtyProjects.size === 0) return;

  const dirtyList = Array.from(pendingDirtyProjects.values());

  try {
    const token = await activeUser.getIdToken();
    if (token) {
      void fetch('/api/projects/sync-dump', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        keepalive: true,
        body: JSON.stringify({ projects: dirtyList }),
      }).catch((err) => {
        console.warn('[BatchedSync] Exit sync dump beacon error:', err);
      });
    }
  } catch (tokenErr) {
    console.warn('[BatchedSync] Could not obtain token on app close:', tokenErr);
  }

  void flushBatchedSyncNow(activeUser).catch(() => {});
}

export function getPendingDirtyCount(): number {
  return pendingDirtyProjects.size;
}
