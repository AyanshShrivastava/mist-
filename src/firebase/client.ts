import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  enableNetwork,
  getDoc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AiProviderId,
  AppAiMode,
  ViewportSize,
  WebSearchMode,
  WorkspaceViewMode,
} from '../types/mist';

export interface UserProfilePreferences {
  preferredProvider?: AiProviderId;
  preferredModel?: string;
  theme?: 'dark' | 'light';
  defaultViewMode?: WorkspaceViewMode;
  defaultViewport?: ViewportSize;
  enableAppAi?: boolean;
  appAiMode?: AppAiMode;
  webSearchMode?: WebSearchMode;
}

const app = initializeApp(firebaseConfig);
try {
  initializeFirestore(
    app,
    { experimentalAutoDetectLongPolling: true },
    firebaseConfig.firestoreDatabaseId,
  );
} catch {
  // Already initialized in this runtime (e.g. HMR)
}
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isOfflineFirestoreError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  const message =
    error instanceof Error
      ? error.message
      : 'message' in error
        ? String((error as { message: unknown }).message)
        : '';
  const lower = message.toLowerCase();
  return (
    code === 'unavailable' ||
    lower.includes('the client is offline') ||
    lower.includes('network error') ||
    lower.includes('could not reach cloud firestore backend')
  );
}

export async function ensureFirestoreOnline(): Promise<void> {
  try {
    await enableNetwork(db);
  } catch {
    // Ignore network toggle errors
  }
}

export async function getDocServerOrCache(
  ref: DocumentReference,
): Promise<DocumentSnapshot | null> {
  try {
    return await getDocFromServer(ref);
  } catch (err) {
    if (!isOfflineFirestoreError(err)) {
      throw err;
    }
    await ensureFirestoreOnline();
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      return await getDocFromServer(ref);
    } catch (retryErr) {
      if (!isOfflineFirestoreError(retryErr)) {
        throw retryErr;
      }
      try {
        return await getDoc(ref);
      } catch (cacheErr) {
        if (isOfflineFirestoreError(cacheErr)) {
          return null;
        }
        throw cacheErr;
      }
    }
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export async function checkFirestoreServerConnection(): Promise<'online' | 'offline'> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'online';
  } catch (error) {
    if (isOfflineFirestoreError(error)) {
      console.error('Please check your Firebase configuration.');
      return 'offline';
    }
    // Non-offline response (such as permission-denied on test/connection) means server is reachable
    return 'online';
  }
}

void checkFirestoreServerConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  // onAuthStateChanged triggers syncUserProfile once; no duplicate write race.
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

const syncInFlight = new Map<string, Promise<void>>();

export async function fetchUserProfilePreferences(
  user: User,
): Promise<UserProfilePreferences | null> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    await user.getIdToken();
    const snap = await getDocServerOrCache(ref);
    if (!snap || !snap.exists()) return null;
    const data = snap.data();
    return {
      preferredProvider: data.preferredProvider as AiProviderId | undefined,
      preferredModel:
        typeof data.preferredModel === 'string' ? data.preferredModel : undefined,
      theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : undefined,
      defaultViewMode: data.defaultViewMode as WorkspaceViewMode | undefined,
      defaultViewport: data.defaultViewport as ViewportSize | undefined,
      enableAppAi: typeof data.enableAppAi === 'boolean' ? data.enableAppAi : undefined,
      appAiMode:
        data.appAiMode === 'on_request' || data.appAiMode === 'always' || data.appAiMode === 'off'
          ? (data.appAiMode as AppAiMode)
          : undefined,
      webSearchMode:
        data.webSearchMode === 'auto' || data.webSearchMode === 'on' || data.webSearchMode === 'off'
          ? (data.webSearchMode as WebSearchMode)
          : undefined,
    };
  } catch (error) {
    if (isOfflineFirestoreError(error)) return null;
    handleFirestoreError(error, OperationType.GET, userPath);
  }
}

export async function syncUserProfile(
  user: User,
  prefs?: UserProfilePreferences,
): Promise<void> {
  const prev = syncInFlight.get(user.uid) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const userPath = `users/${user.uid}`;
      const ref = doc(db, 'users', user.uid);
      const displayName = (
        user.displayName ||
        user.email?.split('@')[0] ||
        'Mist Builder'
      ).slice(0, 120);
      const email = (user.email || '').slice(0, 254);

      if (!email) return;

      const prefFields: Record<string, unknown> = {};
      if (prefs?.preferredProvider) prefFields.preferredProvider = prefs.preferredProvider;
      if (prefs?.preferredModel) prefFields.preferredModel = prefs.preferredModel.slice(0, 120);
      if (prefs?.theme) prefFields.theme = prefs.theme;
      if (prefs?.defaultViewMode) prefFields.defaultViewMode = prefs.defaultViewMode;
      if (prefs?.defaultViewport) prefFields.defaultViewport = prefs.defaultViewport;
      if (typeof prefs?.enableAppAi === 'boolean') prefFields.enableAppAi = prefs.enableAppAi;
      if (prefs?.appAiMode) prefFields.appAiMode = prefs.appAiMode;
      if (prefs?.webSearchMode) prefFields.webSearchMode = prefs.webSearchMode;

      try {
        await user.getIdToken();
        const existingSnap = await getDocServerOrCache(ref);
        if (!existingSnap) {
          // Client temporarily offline; skip blocking write until next online sync
          return;
        }

        const safePhotoUrl =
          user.photoURL &&
          user.photoURL.startsWith('https://') &&
          user.photoURL.length <= 512
            ? user.photoURL
            : null;

        if (!existingSnap.exists()) {
          const payload: Record<string, unknown> = {
            uid: user.uid,
            email,
            displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...prefFields,
          };
          if (safePhotoUrl) {
            payload.photoURL = safePhotoUrl;
          }
          await setDoc(ref, payload);
        } else {
          const updatePayload: Record<string, unknown> = {
            email,
            displayName,
            updatedAt: serverTimestamp(),
            ...prefFields,
          };
          if (safePhotoUrl) {
            updatePayload.photoURL = safePhotoUrl;
          }
          await updateDoc(ref, updatePayload);
        }
      } catch (error) {
        if (isOfflineFirestoreError(error)) {
          return;
        }
        handleFirestoreError(error, OperationType.WRITE, userPath);
      }
    });

  syncInFlight.set(user.uid, next);
  try {
    await next;
  } finally {
    if (syncInFlight.get(user.uid) === next) {
      syncInFlight.delete(user.uid);
    }
  }
}
