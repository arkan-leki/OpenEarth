/**
 * Copies CesiumJS's static runtime (Workers, Assets, Widgets, ThirdParty) into public/cesium
 * so it is served in dev AND shipped in the build, without committing ~7.6 MB of files.
 *
 * Cesium finds these through window.CESIUM_BASE_URL, set in index.html.
 * Run automatically by the predev / prebuild npm hooks.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dest = path.join(root, 'public', 'cesium');
const stamp = path.join(dest, '.cesium-version');

if (!existsSync(src)) {
  console.error('[cesium] node_modules/cesium/Build/Cesium not found — run `npm install` first.');
  process.exit(1);
}

const version = JSON.parse(
  await readFile(path.join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')
).version;

/**
 * Skip when the copy already matches the installed Cesium version.
 *
 * This is not just a speed optimisation. `rm -rf` + re-copy DELETES and RECREATES files that
 * a running Vite dev server has already indexed from publicDir. Its file index then goes
 * stale, every /cesium/... path falls through to the SPA fallback, and Cesium receives
 * index.html where it expected JSON — which silently breaks terrain tile subdivision. So a
 * `npm run build` in one terminal must not pull the rug from under `npm run dev` in another.
 */
if (existsSync(stamp)) {
  const current = (await readFile(stamp, 'utf8')).trim();
  if (current === version) {
    console.log(`[cesium] already populated for ${version} — skipping copy`);
    process.exit(0);
  }
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

for (const dir of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
  await cp(path.join(src, dir), path.join(dest, dir), { recursive: true });
}

// Written last: a stamp only exists once the copy above actually completed.
await writeFile(stamp, version, 'utf8');

console.log(`[cesium] static runtime copied to public/cesium (${version})`);
