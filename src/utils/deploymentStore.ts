import { getFirebaseAppletConfig, SecurityValidationError } from './serverSecurity';

export interface StoredDeployment {
  slug: string;
  ownerUid: string;
  projectId: string;
  title: string;
  htmlBundle: string;
  createdAt?: string;
  updatedAt: string;
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
  listByOwner(ownerUid: string, idToken: string): Promise<DeploymentSummary[]>;
  getPublic(slug: string): Promise<StoredDeployment | null>;
  upsertOwned(
    input: {
      slug: string;
      ownerUid: string;
      projectId: string;
      title: string;
      htmlBundle: string;
    },
    idToken: string,
  ): Promise<StoredDeployment>;
  deleteOwned(slug: string, ownerUid: string, idToken: string): Promise<boolean>;
}

interface FirestoreFieldValue {
  stringValue?: string;
  timestampValue?: string;
  booleanValue?: boolean;
}

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreFieldValue>;
  updateTime?: string;
  createTime?: string;
}

function decodeFirestoreDeployment(doc: FirestoreDocument): StoredDeployment | null {
  const f = doc.fields;
  if (!f) return null;
  const slug = f.slug?.stringValue;
  const ownerUid = f.ownerId?.stringValue;
  const projectId = f.projectId?.stringValue;
  const title = f.title?.stringValue;
  const htmlBundle = f.htmlBundle?.stringValue;
  if (!slug || !ownerUid || !title || htmlBundle === undefined) return null;
  return {
    slug,
    ownerUid,
    projectId: projectId || slug,
    title,
    htmlBundle,
    createdAt: f.createdAt?.timestampValue || doc.createTime,
    updatedAt: f.updatedAt?.timestampValue || doc.updateTime || new Date().toISOString(),
  };
}

export const MAX_DEPLOYMENT_BUNDLE_BYTES = 900_000;

export function createFirestoreDeploymentStore(options?: {
  projectId?: string;
  databaseId?: string;
  fetchImpl?: typeof fetch;
}): DeploymentStore {
  const fetchFn = options?.fetchImpl || globalThis.fetch;

  const getDbRoot = () => {
    const cfg = options?.projectId
      ? { projectId: options.projectId, firestoreDatabaseId: options.databaseId || '(default)' }
      : getFirebaseAppletConfig();
    const dbBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.firestoreDatabaseId)}`;
    return {
      projectId: cfg.projectId,
      databaseId: cfg.firestoreDatabaseId,
      documentsBase: `${dbBase}/documents`,
      docResourcePath: (slug: string) =>
        `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/deployments/${slug}`,
    };
  };

  const fetchDoc = async (slug: string, idToken?: string): Promise<StoredDeployment | null> => {
    const { documentsBase } = getDbRoot();
    const url = `${documentsBase}/deployments/${encodeURIComponent(slug)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const resp = await fetchFn(url, { headers, redirect: 'error' });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new SecurityValidationError(
        resp.status === 403 ? 403 : 502,
        `Firestore deployment lookup failed (${resp.status}): ${errBody.slice(0, 200)}`,
      );
    }
    const doc = (await resp.json()) as FirestoreDocument;
    return decodeFirestoreDeployment(doc);
  };

  return {
    async getPublic(slug: string): Promise<StoredDeployment | null> {
      return fetchDoc(slug);
    },

    async listByOwner(ownerUid: string, idToken: string): Promise<DeploymentSummary[]> {
      const { documentsBase } = getDbRoot();
      const resp = await fetchFn(`${documentsBase}:runQuery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        redirect: 'error',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'deployments' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'ownerId' },
                op: 'EQUAL',
                value: { stringValue: ownerUid },
              },
            },
          },
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new SecurityValidationError(
          resp.status === 401 || resp.status === 403 ? resp.status : 502,
          `Failed to list user deployments (${resp.status}): ${errBody.slice(0, 200)}`,
        );
      }
      const rows = (await resp.json()) as Array<{ document?: FirestoreDocument }>;
      const list: DeploymentSummary[] = [];
      for (const row of rows) {
        if (!row.document) continue;
        const decoded = decodeFirestoreDeployment(row.document);
        if (!decoded || decoded.ownerUid !== ownerUid) continue;
        list.push({
          slug: decoded.slug,
          projectId: decoded.projectId,
          title: decoded.title,
          url: formatDeploymentUrl(decoded.slug, process.env.PUBLIC_APP_URL),
          updatedAt: decoded.updatedAt,
        });
      }
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async upsertOwned(input, idToken: string): Promise<StoredDeployment> {
      const bundleBytes = Buffer.byteLength(input.htmlBundle, 'utf8');
      if (bundleBytes > MAX_DEPLOYMENT_BUNDLE_BYTES) {
        throw new SecurityValidationError(
          413,
          `Published bundle (${Math.round(bundleBytes / 1000)}KB) exceeds maximum 900KB limit.`,
        );
      }

      const existing = await fetchDoc(input.slug, idToken);
      if (existing && existing.ownerUid !== input.ownerUid) {
        throw new SecurityValidationError(403, 'This deployment URL is owned by another user.');
      }

      const { documentsBase, docResourcePath } = getDbRoot();
      const docName = docResourcePath(input.slug);
      const safeTitle = (input.title || input.slug).slice(0, 120);
      const safeProjectId = (input.projectId || input.slug).slice(0, 128);

      const writePayload = existing
        ? {
            update: {
              name: docName,
              fields: {
                title: { stringValue: safeTitle },
                htmlBundle: { stringValue: input.htmlBundle },
              },
            },
            updateMask: { fieldPaths: ['title', 'htmlBundle'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { exists: true },
          }
        : {
            update: {
              name: docName,
              fields: {
                slug: { stringValue: input.slug },
                ownerId: { stringValue: input.ownerUid },
                projectId: { stringValue: safeProjectId },
                title: { stringValue: safeTitle },
                htmlBundle: { stringValue: input.htmlBundle },
              },
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            currentDocument: { exists: false },
          };

      const resp = await fetchFn(`${documentsBase}:commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        redirect: 'error',
        body: JSON.stringify({ writes: [writePayload] }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        if (resp.status === 403) {
          throw new SecurityValidationError(
            403,
            'Deployment write denied by Firestore security rules. Ensure your project is synced first and owned by your account.',
          );
        }
        throw new SecurityValidationError(
          resp.status >= 400 && resp.status < 500 ? resp.status : 502,
          `Failed to save deployment (${resp.status}): ${errBody.slice(0, 200)}`,
        );
      }

      return {
        slug: input.slug,
        ownerUid: input.ownerUid,
        projectId: safeProjectId,
        title: safeTitle,
        htmlBundle: input.htmlBundle,
        updatedAt: new Date().toISOString(),
      };
    },

    async deleteOwned(slug: string, ownerUid: string, idToken: string): Promise<boolean> {
      const existing = await fetchDoc(slug, idToken);
      if (!existing) return false;
      if (existing.ownerUid !== ownerUid) {
        throw new SecurityValidationError(403, 'Only the deployment owner can unpublish this site.');
      }

      const { documentsBase } = getDbRoot();
      const resp = await fetchFn(`${documentsBase}/deployments/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        redirect: 'error',
      });
      if (resp.status === 404) return false;
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new SecurityValidationError(
          resp.status === 403 ? 403 : 502,
          `Failed to delete deployment (${resp.status}): ${errBody.slice(0, 200)}`,
        );
      }
      return true;
    },
  };
}

/**
 * In-memory DeploymentStore implementation matching the exact authorization semantics
 * for unit tests (without hitting live Firestore).
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
