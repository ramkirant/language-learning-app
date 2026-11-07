# Lingo - language practice app

A free, mobile-friendly flashcard app (installable web app / PWA) that runs in Android and iPhone browsers.
It works fully offline, stores everything on the device, and can sync to a free Firebase (Spark plan) database so
your progress is never lost. Starts with French; add any other language from the Admin screen.

- **Practice**: question tile on top, your typed answer below, "I do not know" button, pronunciation (💡) and read-aloud (🔉).
- **Adaptive difficulty (1-10)**: every item starts at 5. Each answer is scored 1 (exact) to 10 (no match / "I do not know")
  and the item's difficulty is recomputed (`0.4 x old + 0.6 x new score`). Harder items appear more often.
- **Proficiency**: overall and per category, with levels from Beginner to Advanced.
- **Admin** (admins only): add / edit / delete items, rename categories, quick-add, CSV import / export, languages, users.
- **Sync**: local-first. Works with no account; sign in to back everything up and share across devices.

## Run it on your computer

Requires Node 20+ (no `npm install` needed - there are no dependencies).

```
npm start        # http://localhost:8080 (also prints a Wi-Fi address for your phone)
npm test         # unit tests
```

Test the phone layout with Chrome / Edge DevTools device mode (Ctrl+Shift+M), and offline mode with DevTools -> Network -> Offline.
`localhost` is treated as secure, so the offline cache and install prompt work there. Opening the Wi-Fi address from a phone
works too, but install / offline caching need HTTPS (use the GitHub Pages URL below).

## CSV format

Separator is `~|~`. Columns: `category ~|~ target language ~|~ native language ~|~ pronunciation` (4th column optional,
header row optional). Example:

```
General Salutations~|~Bonjour~|~Hello / Good morning~|~bon-ZHOOR
```

You never have to write this by hand: use the Admin -> Deck screen. CSV is just for bulk import / export.
In an answer's expected text, `/` or `;` separate accepted alternatives.

## Scoring

Exact match (ignoring case, punctuation, spacing) = 1. Same letters but different accents = 2. Otherwise 3-10 by how similar
the text is (Levenshtein similarity); no overlap = 10. "I do not know" = 10. Tune the constants at the top of `js/difficulty.js`.

## Turn on cloud sync (free Firebase Spark plan, one-time, ~10 minutes)

1. Go to https://console.firebase.google.com -> **Add project** (no billing needed; stay on the free Spark plan).
2. **Build -> Authentication -> Get started -> Sign-in method -> Email/Password -> Enable.**
3. **Build -> Firestore Database -> Create database** (production mode, any region near you).
4. **Firestore -> Rules**: paste the contents of `firestore.rules` and **Publish**.
5. **Project settings (gear) -> Your apps -> Web (`</>`)**: register an app, copy the `firebaseConfig` object into
   `js/firebase-config.js` (replace `null`). This config is public by design; the rules protect your data.
6. **Create the first admin** (the only manual step):
   - Authentication -> Users -> **Add user**: email `yourname@lla.app`, any password (min 6 chars).
     The user id you type in the app is the part before `@lla.app` (lowercase).
   - Copy that user's **User UID**. Firestore -> **Start collection** `users` -> Document ID = that UID, fields:
     `username` (string) = `yourname`, `role` (string) = `admin`, `active` (boolean) = `true`.
7. Open the app -> **Profile** -> sign in with `yourname` and your password. Now add other users from **Admin -> Users**.

Notes: passwords cannot be reset from the app (free plan has no server code). If someone forgets theirs, reset it in the
Firebase console (Authentication) or deactivate them and create a new user id. Everyone can change their own password in Profile.
Free-tier limits (1 GiB storage, 50K reads / 20K writes per day) are far above what one or two learners use.

## Put it on the internet for free (GitHub Pages)

1. Create a GitHub repository and push this folder to the `main` branch.
2. Repo **Settings -> Pages -> Source: GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) runs the
   tests and publishes the site; the URL is `https://<you>.github.io/<repo>/`.
3. Open that URL on your phones. **iPhone**: Safari -> Share -> **Add to Home Screen**. **Android**: Chrome menu -> **Install app**.

Installing matters on iPhone: Safari can clear site data of ordinary tabs after about 7 days of non-use, but not for apps
added to the Home Screen.

## How your data is kept safe

- Every answer is written to the device immediately (autosave) and queued for upload.
- Signed in: it syncs on app open, after answers, when the connection returns, and with **Sync now** (Profile). Records carry an
  `updatedAt` time and the newer one wins, so answering offline on two devices merges cleanly.
- Not signed in: data stays on this device; use **Profile -> Export backup** regularly. Progress made before signing in is merged
  into your account when you do sign in.
- The shared deck (items and languages) can only be changed by admins. Each user's progress is private to them.

## Project layout

```
index.html, manifest.webmanifest, sw.js   app shell, install info, offline cache
css/styles.css                            styling
js/app.js                                 router, header, navigation
js/storage.js                             local data store (languages, items, progress, dirty queue, backup)
js/sync.js, js/users.js                   Firebase auth, two-way sync, user management
js/csv.js, similarity.js, difficulty.js   CSV parsing, answer scoring, difficulty / picker / proficiency
js/views/*.js                             Practice, Progress, Admin (Deck, Languages, Users), Profile
firestore.rules                           database security rules
tests/                                    unit tests (npm test)
```

After changing files under `js/`, `css/` or `icons/`, add any new files to the `ASSETS` list in `sw.js`
(a test checks that every module is listed) and bump `VERSION` there if you want devices to drop old caches.
