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
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { AiProviderId } from '../types/mist';

const app = initializeApp(firebaseConfig);
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

async function validateFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void validateFirestoreConnection();

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

export async function syncUserProfile(
  user: User,
  preferredProvider?: AiProviderId,
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

      try {
        // Ensure auth token claims are fresh and check server state to avoid cache race
        await user.getIdToken();
        let existingSnap;
        try {
          existingSnap = await getDocFromServer(ref);
        } catch {
          existingSnap = await getDoc(ref);
        }

        if (!existingSnap.exists()) {
          const payload: Record<string, unknown> = {
            uid: user.uid,
            email,
            displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (user.photoURL && user.photoURL.length <= 512) {
            payload.photoURL = user.photoURL;
          }
          if (preferredProvider) {
            payload.preferredProvider = preferredProvider;
          }
          await setDoc(ref, payload);
        } else {
          const updatePayload: Record<string, unknown> = {
            email,
            displayName,
            updatedAt: serverTimestamp(),
          };
          if (user.photoURL && user.photoURL.length <= 512) {
            updatePayload.photoURL = user.photoURL;
          }
          if (preferredProvider) {
            updatePayload.preferredProvider = preferredProvider;
          }
          await updateDoc(ref, updatePayload);
        }
      } catch (error) {
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
