import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';

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

// Enable offline persistence — writes queue locally and sync when back online
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
});

const COACH_TOKEN = import.meta.env.VITE_COACH_TOKEN || null;

// Coach data (schedule, roster, meets, etc.) — requires token
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

// Athlete data (workout logs, check-ins) — anyone can read and write
export async function loadAthleteData(key) {
  try {
    const snap = await getDoc(doc(db, 'athleteData', key));
    return snap.exists() ? snap.data().value : null;
  } catch (e) {
    console.error('Firebase athlete load error:', e);
    return null;
  }
}

export async function saveAthleteData(key, value) {
  try {
    await setDoc(doc(db, 'athleteData', key), { value });
    return true;
  } catch (e) {
    console.error('Firebase athlete save error:', e);
    return false;
  }
}

// Atomic read-modify-write for athlete data (prevents race conditions)
export async function atomicUpdateAthleteData(key, updateFn, maxRetries = 3) {
  const docRef = doc(db, 'athleteData', key);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        const current = snap.exists() ? snap.data().value : null;
        let parsed = null;
        try { parsed = current ? JSON.parse(current) : null; } catch { parsed = null; }
        const updated = updateFn(parsed);
        transaction.set(docRef, { value: JSON.stringify(updated) });
      });
      return true;
    } catch (e) {
      console.warn(`Transaction attempt ${attempt + 1} failed for ${key}:`, e.message);
      if (attempt === maxRetries - 1) {
        console.error('All transaction retries failed for', key, e);
        return false;
      }
      await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  return false;
}

export const IS_COACH_BUILD = !!COACH_TOKEN;

// Timer sessions — in-progress race timing data, keyed per coach/role/date.
// Allows resuming on another device if the current one dies mid-meet.
export async function saveTimerSession(key, value) {
  if (!COACH_TOKEN) return false;
  try {
    await setDoc(doc(db, 'timerSessions', key), {
      value,
      coachToken: COACH_TOKEN,
      updatedAt: Date.now(),
    });
    return true;
  } catch (e) {
    console.error('Timer session save error:', e);
    return false;
  }
}

export async function loadTimerSession(key) {
  try {
    const snap = await getDoc(doc(db, 'timerSessions', key));
    if (!snap.exists()) return null;
    const data = snap.data();
    return { value: data.value, updatedAt: data.updatedAt || 0 };
  } catch (e) {
    console.error('Timer session load error:', e);
    return null;
  }
}
