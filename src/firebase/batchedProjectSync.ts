/**
 * Local-First Batched Sync Manager for Mist Projects.
 *
 * All modifications are saved instantly to the browser's local cache.
 * There is NO periodic 10-second sync timer: network/cloud sync happens
 * strictly when the user closes the app, reloads, or navigates away.
 * On exit, pending files and projects are read and dumped to Firebase
 * for that user's account (associated with their email ID).
 */

import type { User } from 'firebase/auth';
import type { MistProject } from '../types/mist';
import { auth } from './client';
import { saveProjectToFirestore } from './store';

const STORAGE_DIRTY_PROJECTS_KEY = 'mist_dirty_projects_v1';

// In-memory queue of modified projects awaiting cloud dump
const pendingDirtyProjects = new Map<string, MistProject>();
let isFlushing = false;

// Load any pending unsynced projects from local cache on startup
export function initLocalCacheQueue(): void {
  try {
    const raw = localStorage.getItem(STORAGE_DIRTY_PROJECTS_KEY);
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

// Persist the dirty queue to localStorage
function persistDirtyQueueToLocalCache(): void {
  try {
    const array = Array.from(pendingDirtyProjects.values());
    if (array.length === 0) {
      localStorage.removeItem(STORAGE_DIRTY_PROJECTS_KEY);
    } else {
      localStorage.setItem(STORAGE_DIRTY_PROJECTS_KEY, JSON.stringify(array));
    }
  } catch {
    // Ignore quota errors
  }
}

/**
 * Queue a project modification in local cache.
 * Changes remain local until the user closes or leaves the app.
 */
export function queueProjectForBatchedSync(project: MistProject): void {
  pendingDirtyProjects.set(project.id, project);
  persistDirtyQueueToLocalCache();
}

/**
 * Remove a project from the dirty queue (e.g. if deleted locally).
 */
export function dequeueProjectFromBatchedSync(projectId: string): void {
  pendingDirtyProjects.delete(projectId);
  persistDirtyQueueToLocalCache();
}

/**
 * Flush all dirty projects at once to Firestore directly from client.
 */
export async function flushBatchedSyncNow(): Promise<{ synced: number; remaining: number }> {
  if (isFlushing || pendingDirtyProjects.size === 0) {
    return { synced: 0, remaining: pendingDirtyProjects.size };
  }

  const user = auth.currentUser;
  if (!user) {
    // Keep in local cache until user signs in
    return { synced: 0, remaining: pendingDirtyProjects.size };
  }

  isFlushing = true;
  // Snapshot current dirty projects to sync
  const snapshot = Array.from(pendingDirtyProjects.entries());
  let synced = 0;

  try {
    // Save all pending projects in parallel
    await Promise.all(
      snapshot.map(async ([id, project]) => {
        try {
          await saveProjectToFirestore(project);
          pendingDirtyProjects.delete(id);
          synced++;
        } catch (err) {
          console.warn(`[BatchedSync] Deferred sync for project ${id} due to network:`, err);
        }
      }),
    );
  } finally {
    persistDirtyQueueToLocalCache();
    isFlushing = false;
  }

  return { synced, remaining: pendingDirtyProjects.size };
}

/**
 * Flush pending dirty projects when the user closes the app, reloads, or hides tab.
 * Reads all dirty project files and dumps them to the backend /api/projects/sync-dump
 * with keepalive: true (which the browser network stack completes even if the tab closes),
 * while also running client-side Firestore flush in parallel.
 */
export async function flushBatchedSyncOnAppExit(user?: User | null): Promise<void> {
  const activeUser = user || auth.currentUser;
  if (!activeUser) return;

  initLocalCacheQueue();
  if (pendingDirtyProjects.size === 0) return;

  const dirtyList = Array.from(pendingDirtyProjects.values());

  try {
    const idToken = await activeUser.getIdToken();
    if (idToken) {
      void fetch('/api/projects/sync-dump', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        keepalive: true,
        body: JSON.stringify({ projects: dirtyList }),
      }).catch((err) => {
        console.warn('[BatchedSync] Exit sync dump beacon error:', err);
      });
    }
  } catch (tokenErr) {
    console.warn('[BatchedSync] Could not obtain idToken on app close:', tokenErr);
  }

  void flushBatchedSyncNow().catch(() => {});
}

export function getPendingDirtyCount(): number {
  return pendingDirtyProjects.size;
}
