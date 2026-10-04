/**
 * The offline LAN pairing overlay (HTML on top of the game): shows connection tickets as QR codes
 * and reads the other player's code with the webcam (BarcodeDetector where the browser has it,
 * otherwise jsQR on video frames), with copy/paste as a fallback. See net/pairing.ts.
 */
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import type { PairingHost, Invite, PairingGuestTransport } from '../net/pairing';

const STYLE = `
.bc-pair { position: fixed; inset: 0; z-index: 50; display: flex; overflow: auto; padding: 16px; box-sizing: border-box;
  background: rgba(0,0,0,0.72); font: 15px monospace; color: #fff; }
.bc-pair .box { margin: auto; width: min(560px, 100%); background: #1d1712; border: 2px solid #000; box-shadow: inset 0 0 0 2px #5a5a5a;
  padding: 18px 20px; display: grid; gap: 12px; }
.bc-pair h2 { margin: 0; font-size: 20px; text-align: center; text-shadow: 2px 2px #3f3f3f; }
.bc-pair p { margin: 0; line-height: 1.45; color: #ddd; }
.bc-pair .step { color: #ffff55; }
.bc-pair .err { color: #ff6b6b; }
.bc-pair .ok { color: #7cfc7c; }
.bc-pair .qr { position: static; inset: auto; width: auto; justify-self: center; background: #fff; padding: 10px; image-rendering: pixelated; max-width: 100%; max-height: 52vh; height: auto; }
.bc-pair video { justify-self: center; width: min(360px, 100%); background: #000; border: 2px solid #555; }
.bc-pair textarea { width: 100%; box-sizing: border-box; min-height: 64px; background: #000; color: #fff; border: 2px solid #a0a0a0;
  font: 12px monospace; padding: 6px; word-break: break-all; }
.bc-pair .row { display: flex; gap: 8px; flex-wrap: wrap; }
.bc-pair .row > button { flex: 1 1 140px; }
.bc-pair button { padding: 8px; font: 15px monospace; color: #fff; cursor: pointer; background: linear-gradient(#8a8a8a, #6f6f6f);
  border: 2px solid #000; box-shadow: inset 2px 2px #aaa, inset -2px -2px #555; text-shadow: 2px 2px #3f3f3f; }
.bc-pair button:hover, .bc-pair button:focus-visible { background: linear-gradient(#8c9bd6, #6f7fc0); outline: none; }
.bc-pair button[disabled] { opacity: 0.5; cursor: default; }
`;

/** An overlay root that keeps keys and clicks away from the game underneath. */
function overlay(): { root: HTMLDivElement; box: HTMLDivElement; close: () => void } {
  if (!document.getElementById('bc-pair-style')) {
    const st = document.createElement('style');
    st.id = 'bc-pair-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  if (document.pointerLockElement) document.exitPointerLock();
  const root = document.createElement('div');
  root.className = 'bc-pair';
  const box = document.createElement('div');
  box.className = 'box';
  root.appendChild(box);
  for (const ev of ['keydown', 'keyup', 'mousedown', 'mouseup', 'wheel', 'mousemove']) root.addEventListener(ev, (e) => e.stopPropagation());
  document.body.appendChild(root);
  return { root, box, close: () => root.remove() };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, cls = ''): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  if (cls) e.className = cls;
  return e;
}

/** A ticket as a crisp QR code canvas (byte mode, low error correction: the codes are long). */
export function qrCanvas(text: string, maxPx = 320): HTMLCanvasElement {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.max(2, Math.floor(maxPx / n));
  const c = el('canvas', { width: n * cell, height: n * cell }, 'qr');
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(col * cell, r * cell, cell, cell);
  return c;
}

/** Live webcam QR scanning into `video`; resolves with the first code read. stop() releases the camera. */
function scanQr(video: HTMLVideoElement): { result: Promise<string>; stop: () => void } {
  let stopped = false;
  let stream: MediaStream | null = null;
  const stop = () => {
    stopped = true;
    for (const t of stream?.getTracks() ?? []) t.stop();
    video.srcObject = null;
  };
  const result = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This page has no camera access here (it needs https:// or the installed app). Paste the code instead.');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch {
      throw new Error('The camera is blocked or missing. Allow camera access, or paste the code instead.');
    }
    if (stopped) {
      stop();
      throw new Error('cancelled');
    }
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
    const canvas = el('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 120));
      if (stopped || video.readyState < 2) continue;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) return codes[0].rawValue;
          continue;
        }
      } catch {
        // fall through to jsQR
      }
      // jsQR on a frame scaled to at most 800 px wide (fast enough on a Chromebook)
      const s = Math.min(1, 800 / (video.videoWidth || 800));
      canvas.width = Math.round(video.videoWidth * s);
      canvas.height = Math.round(video.videoHeight * s);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) return code.data;
    }
    throw new Error('cancelled');
  })();
  result.finally(stop).catch(() => {});
  return { result, stop };
}

/**
 * "Read the other player's code": camera scanning plus a paste box. Resolves with the text.
 * The returned stop() releases the camera when the step is abandoned.
 */
function readCode(box: HTMLElement, label: string): { result: Promise<string>; stop: () => void } {
  const wrap = el('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '8px';
  const video = el('video');
  const status = el('p', { textContent: 'Starting the camera…' });
  const paste = el('textarea', { placeholder: `…or paste the ${label} here`, id: 'bc-pair-paste' });
  const use = el('button', { textContent: 'Use pasted code' });
  wrap.append(video, status, paste, use);
  box.appendChild(wrap);
  const scan = scanQr(video);
  const result = new Promise<string>((resolve) => {
    use.onclick = () => {
      const t = paste.value.trim();
      if (t) resolve(t);
    };
    scan.result.then(resolve, (e: Error) => {
      if (e.message === 'cancelled') return;
      video.remove();
      status.className = 'err';
      status.textContent = e.message;
    });
    void scan.result.catch(() => {});
    setTimeout(() => {
      if (status.textContent === 'Starting the camera…') status.textContent = `Hold the ${label} up to your camera.`;
    }, 1500);
  });
  return {
    result: result.finally(() => {
      scan.stop();
      wrap.remove();
    }),
    stop: () => {
      scan.stop();
      wrap.remove();
    },
  };
}

function ticketBlock(box: HTMLElement, ticket: string): HTMLElement {
  const wrap = el('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '8px';
  wrap.dataset.ticket = ticket;
  const copy = el('button', { textContent: 'Copy code as text' });
  copy.onclick = () => {
    navigator.clipboard?.writeText(ticket).then(
      () => (copy.textContent = 'Copied'),
      () => {
        const ta = el('textarea', { value: ticket, readOnly: true });
        wrap.appendChild(ta);
        ta.select();
      },
    );
  };
  wrap.append(qrCanvas(ticket), copy);
  box.appendChild(wrap);
  return wrap;
}

/** Host: invite friends one at a time. Opened from the Open to LAN screen. */
export function showHostPairing(host: PairingHost, onClose: () => void): void {
  const { box, close } = overlay();
  let invite: Invite | null = null;
  let reading: { result: Promise<string>; stop: () => void } | null = null;
  const finish = () => {
    reading?.stop();
    invite?.cancel();
    close();
    onClose();
  };
  const header = () => {
    box.replaceChildren(el('h2', { textContent: 'Play offline over Wi-Fi' }));
    box.appendChild(el('p', { textContent: host.guests ? `${host.guests} player${host.guests === 1 ? '' : 's'} connected.` : 'No internet needed: friends on the same Wi-Fi join by scanning codes.' }, host.guests ? 'ok' : ''));
  };
  const start = async () => {
    header();
    const wait = el('p', { textContent: 'Making an invite code…' });
    box.appendChild(wait);
    invite = await host.invite();
    wait.remove();
    box.appendChild(el('p', { textContent: '1. Your friend opens Blockcraft and chooses "Join offline (scan code)", then scans this code:' }, 'step'));
    const qr = ticketBlock(box, invite.ticket);
    const next = el('button', { textContent: 'Next: scan their reply code' });
    const done = el('button', { textContent: 'Done' });
    const row = el('div', {}, 'row');
    row.append(next, done);
    box.appendChild(row);
    done.onclick = finish;
    next.onclick = async () => {
      qr.remove();
      row.remove();
      box.appendChild(el('p', { textContent: '2. Scan the reply code on your friend\'s screen:' }, 'step'));
      const status = el('p');
      const cancel = el('button', { textContent: 'Cancel' });
      cancel.onclick = finish;
      reading = readCode(box, 'reply code');
      box.append(status, cancel);
      for (;;) {
        let reply: string;
        try {
          reply = await reading!.result;
        } catch {
          return;
        }
        status.className = '';
        status.textContent = 'Connecting…';
        try {
          await invite!.accept(reply);
          invite = null;
          reading = null;
          void start();
          return;
        } catch (e) {
          status.className = 'err';
          status.textContent = (e as Error).message;
          if (/reply code|invite code|damaged|isn't a Blockcraft/.test((e as Error).message)) {
            // a wrong or blurry code: scan again (scanner first, then the message and Cancel)
            reading = readCode(box, 'reply code');
            box.append(status, cancel);
            continue;
          }
          return;
        }
      }
    };
  };
  void start().catch((e) => {
    header();
    box.appendChild(el('p', { textContent: `Couldn't start: ${(e as Error).message}` }, 'err'));
    const done = el('button', { textContent: 'Close' });
    done.onclick = finish;
    box.appendChild(done);
  });
}

/**
 * Guest: scan the host's invite, show the reply, wait for the connection. Resolves with the open
 * transport; rejects if the player cancels.
 */
export function pairAsGuest(): Promise<PairingGuestTransport> {
  const { box, close } = overlay();
  return new Promise((resolve, reject) => {
    let reading: { stop: () => void } | null = null;
    let transport: PairingGuestTransport | null = null;
    const cancel = () => {
      reading?.stop();
      transport?.close();
      close();
      reject(new Error('cancelled'));
    };
    const step1 = () => {
      box.replaceChildren(el('h2', { textContent: 'Join offline over Wi-Fi' }));
      box.appendChild(el('p', { textContent: 'Be on the same Wi-Fi as the host. On their screen: Esc → Open to LAN → Play offline.' }));
      box.appendChild(el('p', { textContent: "1. Scan the host's invite code:" }, 'step'));
      const status = el('p');
      const back = el('button', { textContent: 'Cancel' });
      back.onclick = cancel;
      const r = readCode(box, 'invite code');
      reading = r;
      box.append(status, back);
      r.result.then(async (invite) => {
        status.className = '';
        status.textContent = 'Reading the invite…';
        try {
          const { transport: t, reply } = await (await import('../net/pairing')).PairingGuestTransport.fromInvite(invite);
          transport = t;
          step2(reply);
        } catch (e) {
          status.className = 'err';
          status.textContent = (e as Error).message;
          setTimeout(step1, 2500);
        }
      }, () => {});
    };
    const step2 = (reply: string) => {
      box.replaceChildren(el('h2', { textContent: 'Join offline over Wi-Fi' }));
      box.appendChild(el('p', { textContent: '2. Show this reply code to the host so they can scan it:' }, 'step'));
      ticketBlock(box, reply);
      const status = el('p', { textContent: 'Waiting for the host…' });
      const back = el('button', { textContent: 'Cancel' });
      back.onclick = cancel;
      box.append(status, back);
      transport!.ready.then(
        () => {
          close();
          resolve(transport!);
        },
        (e: Error) => {
          status.className = 'err';
          status.textContent = e.message;
        },
      );
    };
    step1();
  });
}
