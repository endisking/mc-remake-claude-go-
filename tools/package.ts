/**
 * Release builds: the web app (static files, zipped), the dedicated server (one bundled server.mjs
 * + the web app + start scripts; needs Node.js) and the desktop app (Electron) for each target —
 * Windows (folder with Blockcraft.exe), macOS (Blockcraft.app; Apple Silicon and Intel) or Linux.
 * Output in build/release/.
 * Usage: pnpm package [--targets win32-x64,darwin-arm64,darwin-x64,linux-x64] [--no-web]
 *   (--no-web skips the web and server zips)
 *   (default win32-x64; the old --platform <p> still works and means <p>-x64)
 * On macOS the .app is ad-hoc signed (Apple Silicon refuses unsigned code) and zipped with ditto
 * so the framework symlinks and signature survive.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';

const root = new URL('../', import.meta.url).pathname;
type Platform = 'win32' | 'linux' | 'darwin';
type Arch = 'x64' | 'arm64';
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const targets: [Platform, Arch][] = (arg('--targets') ?? `${arg('--platform') ?? 'win32'}-x64`).split(',').map((t) => {
  const [p, a = 'x64'] = t.trim().split('-') as [Platform, Arch];
  if (!['win32', 'linux', 'darwin'].includes(p) || !['x64', 'arm64'].includes(a)) throw new Error(`unknown target ${t}`);
  return [p, a];
});
const buildWeb = !process.argv.includes('--no-web');
const version = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).version as string;
const out = join(root, 'build/release');
const stage = join(root, 'build/desktop-app');

console.log('building web app…');
execSync('npx vite build', { cwd: join(root, 'client'), stdio: 'inherit' });
const dist = join(root, 'client/dist');
mkdirSync(out, { recursive: true });

// web: the static build without source maps
if (buildWeb) {
  const webZip = join(out, `Blockcraft-${version}-web.zip`);
  if (existsSync(webZip)) rmSync(webZip);
  execSync(`zip -qr ${webZip} . -x "*.map"`, { cwd: dist });
  console.log(`web → ${webZip}`);
}

// esbuild ships with vite, so it is resolved from there
const esbuild = createRequire(realpathSync(join(root, 'node_modules/vite/package.json')))('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };

// dedicated server: server.mjs (game server + ws, bundled) next to web/, start scripts, README
if (buildWeb) {
  const srvStage = join(root, 'build/server/blockcraft-server');
  rmSync(join(root, 'build/server'), { recursive: true, force: true });
  mkdirSync(srvStage, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, 'server/src/node/main.ts')], outfile: join(srvStage, 'server.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning',
    // bundled CommonJS dependencies (ws) call require() for Node built-ins
    banner: { js: "import { createRequire as __bcRequire } from 'node:module'; const require = __bcRequire(import.meta.url);" },
  });
  for (const f of ['start.bat', 'start.sh', 'README.txt']) cpSync(join(root, 'server/dist-files', f), join(srvStage, f));
  cpSync(dist, join(srvStage, 'web'), { recursive: true, filter: (src) => !src.endsWith('.map') });
  const srvZip = join(out, `Blockcraft-${version}-server.zip`);
  if (existsSync(srvZip)) rmSync(srvZip);
  execSync(`zip -qr ${srvZip} blockcraft-server`, { cwd: join(root, 'build/server') });
  console.log(`server → ${srvZip}`);
}

// desktop: stage main.cjs + package.json + web/, then package Electron
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'desktop/main.cjs'), join(stage, 'main.cjs'));
cpSync(join(root, 'desktop/package.json'), join(stage, 'package.json'));
// the LAN signaling relay (SignalingHub + ws) as one self-contained CommonJS file
await esbuild.build({
  entryPoints: [join(root, 'server/src/node/desktop-signal.ts')], outfile: join(stage, 'signaling.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning',
});
cpSync(dist, join(stage, 'web'), { recursive: true, filter: (src) => !src.endsWith('.map') });
for (const [platform, arch] of targets) {
  const [appDir] = await packager({
    dir: stage, out: join(root, 'build/desktop'), name: 'Blockcraft', executableName: 'Blockcraft', platform, arch,
    electronVersion: '33.4.11', overwrite: true, asar: true, appVersion: version, appCopyright: 'Blockcraft contributors',
    win32metadata: { CompanyName: 'Blockcraft', ProductName: 'Blockcraft', FileDescription: 'Blockcraft' },
    appBundleId: 'io.github.endisking.blockcraft', appCategoryType: 'public.app-category.games', darwinDarkModeSupport: true,
  });
  const folder = appDir!.split('/').pop()!;
  const zipName = join(out, `Blockcraft-${version}-${platform === 'darwin' ? 'macos' : platform}-${arch}.zip`);
  if (existsSync(zipName)) rmSync(zipName);
  if (platform === 'darwin' && process.platform === 'darwin') {
    // ad-hoc signature (no Apple developer ID): required for Apple Silicon to run the app at all
    const app = join(appDir!, 'Blockcraft.app');
    execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
    execSync(`ditto -c -k --sequesterRsrc --keepParent "${app}" "${zipName}"`);
  } else {
    // -y keeps symlinks (the macOS frameworks are full of them)
    execSync(`zip -qry ${zipName} ${folder}`, { cwd: join(root, 'build/desktop') });
  }
  console.log(`desktop (${platform}-${arch}) → ${zipName}`);
}
