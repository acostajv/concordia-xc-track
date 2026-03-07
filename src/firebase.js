import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

// ╔══════════════════════════════════════════════════════════╗
// ║  PASTE YOUR FIREBASE CONFIG FROM THE FIREBASE CONSOLE   ║
// ║  (Project Settings → Your apps → Web app config)        ║
// ╚══════════════════════════════════════════════════════════╝
const firebaseConfig = {
  apiKey: "AIzaSyCf35hn2_sdafpeA7Q6OXoODX8Fo2bS3g8",
  authDomain: "concordia-xc-track.firebaseapp.com",
  projectId: "concordia-xc-track",
  storageBucket: "concordia-xc-track.firebasestorage.app",
  messagingSenderId: "320762362045",
  appId: "1:320762362045:web:d25d9a482a14470a179fd4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Coach token from Netlify environment variable
// Only exists on the coach build — athlete build gets null
const COACH_TOKEN = import.meta.env.VITE_COACH_TOKEN || null;

export async function loadData(key) {
  try {
    const snap = await getDoc(doc(db, 'appData', key));
    return snap.exists() ? snap.data().value : null;
  } catch (e) {
    console.error('Firebase load error:', e);
    return null;
  }
}

export async function saveData(key, value) {
  if (!COACH_TOKEN) {
    console.warn('No coach token — write blocked (athlete build)');
    return false;
  }
  try {
    await setDoc(doc(db, 'appData', key), { value, coachToken: COACH_TOKEN });
    return true;
  } catch (e) {
    console.error('Firebase save error:', e);
    return false;
  }
}

export const IS_COACH_BUILD = !!COACH_TOKEN;
