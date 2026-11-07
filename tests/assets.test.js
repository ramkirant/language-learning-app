import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listed = [...sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name).split(path.sep).join('/')]));

test('every file the service worker precaches exists', () => {
  for (const f of listed) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
  }
});

test('every app module is precached so the app works offline', () => {
  for (const f of walk('js')) assert.ok(listed.includes(f), `${f} is not in sw.js ASSETS`);
});

test('manifest icons exist', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)));
});
