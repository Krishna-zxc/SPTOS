/**
 * Firebase app initialisation.
 *
 * A single Firebase app instance is shared across the whole client.
 * Firestore and Auth are exported so any module can import them directly
 * without re-initialising the SDK.
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  getFirestore,
  enableIndexedDbPersistence,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCEgLIDiI3sRkRT-8ukCUFhD2A4v880NwI',
  authDomain: 'sptos-86064.firebaseapp.com',
  projectId: 'sptos-86064',
  storageBucket: 'sptos-86064.firebasestorage.app',
  messagingSenderId: '181123552187',
  appId: '1:181123552187:web:96e474c6a29931e3f26a9e',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence so the app works without a connection too.
enableIndexedDbPersistence(db).catch(() => {
  // Multi-tab or SSR environments silently skip persistence.
});

export { createUserWithEmailAndPassword, signInWithEmailAndPassword, firebaseSignOut };
export default app;
