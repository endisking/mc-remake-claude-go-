// Blockcraft desktop app: serves the bundled web build from a local HTTP server (fetch and
// workers need http, not file://) and opens it in a window. The same server relays WebRTC
// signaling at /signal (signaling.cjs, bundled by tools/package.ts) so "Open to LAN" works:
// friends on the same network join through http://<host LAN IP>:<port>/ or by entering the
// host's IP as the signaling server in their launcher. /lan-info tells the page the LAN address;
// /lan-servers lists the worlds other machines announce on the network (LAN discovery).
const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// LAN play needs real local addresses in WebRTC offers: Chromium otherwise hides them behind mDNS
// .local names, which many school and home networks can't resolve
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const WEB = path.join(__dirname, 'web');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.map': 'application/json', '.svg': 'image/svg+xml',
};

/** Non-internal IPv4 addresses of this machine (what friends on the LAN connect to). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }
  return out;
}

let signaling = false;
let lan = null;
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url;
      try {
        url = decodeURIComponent((req.url || '/').split('?')[0]);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      if (url === '/lan-info') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ addresses: lanAddresses(), port: server.address().port, signaling }));
      }
      if (url === '/lan-servers') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(lan ? lan.lanWorlds() : []));
      }
      let file = path.normalize(path.join(WEB, url === '/' ? 'index.html' : url));
      if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    const ready = (port) => {
      try {
        lan = require('./signaling.cjs').attachSignaling(server, port);
        signaling = true;
      } catch (e) {
        console.warn('LAN signaling unavailable:', e && e.message);
      }
      resolve(port);
    };
    // a fixed port keeps localStorage (settings, launcher choices) between runs; listening on all
    // interfaces lets friends on the LAN reach the relay and the game (the window uses 127.0.0.1)
    server.once('error', () => server.listen(0, '0.0.0.0', () => ready(server.address().port)));
    server.listen(47615, '0.0.0.0', () => ready(47615));
  });
}

app.whenReady().then(async () => {
  const port = await serve();
  const win = new BrowserWindow({
    width: 1280, height: 720, title: 'Blockcraft', autoHideMenuBar: true, backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${port}/`);
  // closing the window saves the open single-player world first (the renderer would otherwise be
  // killed mid-save and lose everything since the last autosave)
  let saved = false;
  win.on('close', (e) => {
    if (saved) return;
    e.preventDefault();
    const done = () => {
      if (saved) return;
      saved = true;
      if (!win.isDestroyed()) win.close();
    };
    const timer = setTimeout(done, 15000);
    win.webContents
      .executeJavaScript('window.game && window.game.saveForExit ? window.game.saveForExit() : null', true)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        done();
      });
  });
});
app.on('window-all-closed', () => app.quit());
