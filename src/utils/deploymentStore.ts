import { SecurityValidationError } from './serverSecurity';
import { FirestoreAdminStore, type AdminDatabaseOperations } from '../server/firestoreAdmin';
import {
  CloudflareR2ArtifactStore,
  InMemoryR2ArtifactStore,
  type R2StorageOperations,
} from './r2ArtifactStore';

export interface StoredDeployment {
  slug: string;
  ownerUid: string;
  projectId: string;
  title: string;
  htmlBundle: string;
  createdAt?: string;
  updatedAt: string;
  r2Bucket?: string;
  artifactPath?: string;
}

export interface DeploymentSummary {
  slug: string;
  projectId: string;
  title: string;
  url: string;
  updatedAt: string;
}

export function formatDeploymentUrl(slug: string, publicBaseUrl?: string): string {
  const cleanSlug = slug.replace(/^\/+/, '');
  const cleanBase = (publicBaseUrl || '').trim().replace(/\/+$/, '');
  return cleanBase ? `${cleanBase}/${cleanSlug}` : `/${cleanSlug}`;
}

export interface DeploymentStore {
  listByOwner(ownerUid: string, idToken?: string): Promise<DeploymentSummary[]>;
  getPublic(slug: string): Promise<StoredDeployment | null>;
  upsertOwned(
    input: {
      slug: string;
      ownerUid: string;
      projectId: string;
      title: string;
      htmlBundle: string;
    },
    idToken?: string,
  ): Promise<StoredDeployment>;
  deleteOwned(slug: string, ownerUid: string, idToken?: string): Promise<boolean>;
}

export const MAX_DEPLOYMENT_BUNDLE_BYTES = 900_000;

export function createFirestoreDeploymentStore(options?: {
  adminStore?: AdminDatabaseOperations;
  r2Store?: R2StorageOperations;
}): DeploymentStore {
  let adminDb = options?.adminStore;
  let r2 = options?.r2Store;

  function getStores() {
    if (!adminDb) {
      try {
        adminDb = new FirestoreAdminStore();
      } catch {
        // Fall back to memory if credentials missing
      }
    }
    if (!r2) {
      try {
        r2 = new CloudflareR2ArtifactStore();
      } catch {
        r2 = new InMemoryR2ArtifactStore();
      }
    }
    return { adminDb, r2 };
  }

  return {
    async getPublic(slug: string): Promise<StoredDeployment | null> {
      const { adminDb, r2 } = getStores();
      if (adminDb) {
        const metadata = await adminDb.getDeployment(slug);
        if (metadata) {
          if (r2 && !metadata.htmlBundle) {
            const html = await r2.getPublishedHtml(slug);
            if (html) metadata.htmlBundle = html;
          }
          return metadata;
        }
      }
      return null;
    },

    async listByOwner(ownerUid: string): Promise<DeploymentSummary[]> {
      const { adminDb } = getStores();
      if (!adminDb) return [];
      const list = await adminDb.listDeployments(ownerUid);
      return list.map((item) => ({
        ...item,
        url: formatDeploymentUrl(item.slug, process.env.PUBLIC_APP_URL),
      }));
    },

    async upsertOwned(input): Promise<StoredDeployment> {
      const { adminDb, r2 } = getStores();
      const slug = input.slug;

      let artifactInfo: { key: string } | undefined;
      if (r2) {
        artifactInfo = await r2.uploadPublishedSite(slug, input.htmlBundle);
        const exists = await r2.artifactExists(slug);
        if (!exists) {
          throw new SecurityValidationError(500, 'Artifact upload verification failed.');
        }
      }

      if (adminDb) {
        await adminDb.saveDeployment(input.ownerUid, {
          slug,
          projectId: input.projectId,
          title: input.title,
          r2Bucket: process.env.R2_BUCKET_NAME || 'mist-published-sites',
          artifactPath: artifactInfo?.key || `sites/${slug}/index.html`,
          htmlBundle: input.htmlBundle,
        });
      }

      const now = new Date().toISOString();
      return {
        slug: input.slug,
        ownerUid: input.ownerUid,
        projectId: input.projectId,
        title: input.title,
        htmlBundle: input.htmlBundle,
        createdAt: now,
        updatedAt: now,
        artifactPath: artifactInfo?.key,
      };
    },

    async deleteOwned(slug: string, ownerUid: string): Promise<boolean> {
      const { adminDb, r2 } = getStores();
      if (r2) {
        await r2.deletePublishedSite(slug).catch(() => {});
      }
      if (adminDb) {
        return adminDb.deleteDeployment(ownerUid, slug);
      }
      return true;
    },
  };
}

/**
 * In-memory DeploymentStore implementation matching the exact authorization semantics
 * for unit tests (without hitting live Firestore/R2).
 */
export function createMemoryDeploymentStore(): DeploymentStore {
  const map = new Map<string, StoredDeployment>();
  return {
    async getPublic(slug: string) {
      return map.get(slug) || null;
    },
    async listByOwner(ownerUid: string) {
      const list: DeploymentSummary[] = [];
      for (const dep of map.values()) {
        if (dep.ownerUid === ownerUid) {
          list.push({
            slug: dep.slug,
            projectId: dep.projectId,
            title: dep.title,
            url: formatDeploymentUrl(dep.slug, process.env.PUBLIC_APP_URL),
            updatedAt: dep.updatedAt,
          });
        }
      }
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async upsertOwned(input) {
      const existing = map.get(input.slug);
      if (existing && existing.ownerUid !== input.ownerUid) {
        throw new SecurityValidationError(403, 'This deployment URL is owned by another user.');
      }
      const now = new Date().toISOString();
      const saved: StoredDeployment = {
        slug: input.slug,
        ownerUid: input.ownerUid,
        projectId: input.projectId,
        title: input.title,
        htmlBundle: input.htmlBundle,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      map.set(input.slug, saved);
      return saved;
    },
    async deleteOwned(slug, ownerUid) {
      const existing = map.get(slug);
      if (!existing) return false;
      if (existing.ownerUid !== ownerUid) {
        throw new SecurityValidationError(403, 'Only the deployment owner can unpublish this site.');
      }
      map.delete(slug);
      return true;
    },
  };
}
