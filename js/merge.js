// Last-write-wins merge helpers used when syncing local records with Firestore.
// Every record carries a numeric `updatedAt`; the newer one wins.

export const isNewer = (a, b) => (a?.updatedAt ?? 0) > (b?.updatedAt ?? 0);

// local, remote: { key: record }
// full: true when `remote` is the complete remote collection (so local-only keys must be uploaded).
export function mergeMaps(local, remote, { full = false } = {}) {
  const merged = { ...local };
  const pulled = [];
  const toPush = [];
  for (const [key, r] of Object.entries(remote)) {
    const l = local[key];
    if (!l || isNewer(r, l)) {
      merged[key] = r;
      pulled.push(key);
    } else if (isNewer(l, r)) {
      toPush.push(key);
    }
  }
  if (full) {
    for (const key of Object.keys(local)) if (!(key in remote)) toPush.push(key);
  }
  return { merged, pulled, toPush };
}
