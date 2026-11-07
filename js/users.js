// Admin-side user management. Logins are Firebase password accounts (user id -> hidden email);
// the role / active flag live in Firestore at users/{uid} and are enforced by firestore.rules.
import { firebaseConfig } from './firebase-config.js';
import { getFirebase } from './sync.js';
import * as store from './storage.js';
import { usernameToEmail, normalizeUsername, USERNAME_RE } from './util.js';

let secondaryAuth = null;

export async function listUsers() {
  const { fsM, db } = await getFirebase();
  const snap = await fsM.getDocs(fsM.collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

// Creates the login with a second, temporary Firebase connection so the admin stays signed in
// (the free plan has no server-side Admin SDK / Cloud Functions).
export async function createUser({ username, password, role }) {
  const name = normalizeUsername(username);
  if (!USERNAME_RE.test(name)) throw new Error('User ID: 2-30 characters, lowercase letters, numbers, . _ -');
  if (String(password).length < 6) throw new Error('Password must be at least 6 characters.');
  const { appM, authM, fsM, db } = await getFirebase();
  const app2 = appM.getApps().find((a) => a.name === 'secondary') ?? appM.initializeApp(firebaseConfig, 'secondary');
  secondaryAuth ??= authM.getAuth(app2);
  const cred = await authM.createUserWithEmailAndPassword(secondaryAuth, usernameToEmail(name), password);
  const uid = cred.user.uid;
  await authM.signOut(secondaryAuth);
  await fsM.setDoc(fsM.doc(db, 'users', uid), {
    username: name, role: role === 'admin' ? 'admin' : 'learner', active: true, createdAt: Date.now(),
  });
  return uid;
}

export async function updateUser(uid, patch) {
  const { fsM, db } = await getFirebase();
  await fsM.updateDoc(fsM.doc(db, 'users', uid), patch);
}

export async function changeOwnPassword(current, next) {
  if (String(next).length < 6) throw new Error('Password must be at least 6 characters.');
  const { authM, auth } = await getFirebase();
  const user = auth.currentUser;
  if (!user || !store.getSession()) throw new Error('You are not signed in.');
  const cred = authM.EmailAuthProvider.credential(user.email, current);
  await authM.reauthenticateWithCredential(user, cred);
  await authM.updatePassword(user, next);
}
