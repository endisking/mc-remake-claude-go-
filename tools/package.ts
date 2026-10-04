/**
 * Release builds: the web app (static files, zipped) and the Windows desktop app (Electron,
 * zipped folder with Blockcraft.exe). Output in build/release/.
 * Usage: pnpm package [--platform win32|linux|darwin] (default win32)
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';

const root = new URL('../', import.meta.url).pathname;
const platform = (process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : 'win32') as 'win32' | 'linux' | 'darwin';
const version = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).version as string;
const out = join(root, 'build/release');
const stage = join(root, 'build/desktop-app');

console.log('building web app…');
execSync('npx vite build', { cwd: join(root, 'client'), stdio: 'inherit' });
const dist = join(root, 'client/dist');
mkdirSync(out, { recursive: true });

// web: the static build without source maps
const webZip = join(out, `Blockcraft-${version}-web.zip`);
if (existsSync(webZip)) rmSync(webZip);
execSync(`zip -qr ${webZip} . -x "*.map"`, { cwd: dist });
console.log(`web → ${webZip}`);

// desktop: stage main.cjs + package.json + web/, then package Electron
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'desktop/main.cjs'), join(stage, 'main.cjs'));
cpSync(join(root, 'desktop/package.json'), join(stage, 'package.json'));
// the LAN signaling relay (SignalingHub + ws) as one self-contained CommonJS file; esbuild ships
// with vite, so it is resolved from there
const esbuild = createRequire(realpathSync(join(root, 'node_modules/vite/package.json')))('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };
await esbuild.build({
  entryPoints: [join(root, 'server/src/node/desktop-signal.ts')], outfile: join(stage, 'signaling.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning',
});
cpSync(dist, join(stage, 'web'), { recursive: true, filter: (src) => !src.endsWith('.map') });
const [appDir] = await packager({
  dir: stage, out: join(root, 'build/desktop'), name: 'Blockcraft', executableName: 'Blockcraft', platform, arch: 'x64',
  electronVersion: '33.4.11', overwrite: true, asar: true, appVersion: version, appCopyright: 'Blockcraft contributors',
  win32metadata: { CompanyName: 'Blockcraft', ProductName: 'Blockcraft', FileDescription: 'Blockcraft' },
});
const desktopZip = join(out, `Blockcraft-${version}-${platform}-x64.zip`);
if (existsSync(desktopZip)) rmSync(desktopZip);
execSync(`zip -qry ${desktopZip} ${appDir!.split('/').pop()}`, { cwd: join(root, 'build/desktop') });
console.log(`desktop → ${desktopZip}`);
