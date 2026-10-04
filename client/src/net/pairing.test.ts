import { describe, it, expect } from 'vitest';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { encodeTicket, decodeTicket, minifySdp } from './pairing';

// a realistic data-channel offer (Chrome, mDNS host candidates, no STUN)
const OFFER = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:3907316424 1 udp 2113937151 6b0f4a3c-9a1e-4c8e-8f0e-7f1c2d3e4f5a.local 51634 typ host generation 0 network-cost 999',
  'a=candidate:1234567890 1 udp 2113939711 2c7d3e1a-1111-4c8e-8f0e-7f1c2d3e4f5b.local 51635 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 tcp 1518280447 6b0f4a3c-9a1e-4c8e-8f0e-7f1c2d3e4f5a.local 9 typ host tcptype active generation 0 network-cost 999',
  'a=ice-ufrag:Hq3L', 'a=ice-pwd:3vJ6x0Q0K9mVZb1nq3cFXyAb', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 4A:F2:19:6C:0B:7E:91:D3:5A:22:8C:1F:E0:47:B3:66:9D:10:2E:7F:C4:58:A1:0B:93:E6:3D:71:5C:28:F0:BE',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

describe('offline LAN tickets', () => {
  it('round-trip the SDP minus the lines a data channel does not need', async () => {
    const t = await encodeTicket('invite', OFFER);
    expect(t.startsWith('BCI1.')).toBe(true);
    const back = await decodeTicket('invite', t);
    expect(back).toBe(minifySdp(OFFER));
    expect(back).toContain('a=fingerprint:sha-256 4A:F2');
    expect(back).toContain('typ host generation 0');
    expect(back).not.toContain('tcptype');
    expect(back).not.toContain('extmap-allow-mixed');
  });

  it('explain wrong or broken codes', async () => {
    const invite = await encodeTicket('invite', OFFER);
    const reply = await encodeTicket('reply', OFFER);
    await expect(decodeTicket('reply', invite)).rejects.toThrow(/own invite code/);
    await expect(decodeTicket('invite', reply)).rejects.toThrow(/reply code/);
    await expect(decodeTicket('invite', 'hello')).rejects.toThrow(/isn't a Blockcraft/);
    await expect(decodeTicket('invite', invite.slice(0, 40))).rejects.toThrow(/damaged/);
    // whitespace from copy/paste is ignored
    expect(await decodeTicket('invite', ` ${invite.slice(0, 30)}\n${invite.slice(30)} `)).toBe(minifySdp(OFFER));
  });

  it('fit in a QR code a laptop webcam can read, and decode back from the image', async () => {
    const t = await encodeTicket('invite', OFFER);
    expect(t.length).toBeLessThan(600);
    const qr = qrcode(0, 'L');
    qr.addData(t, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    expect(n).toBeLessThanOrEqual(81); // version ≤ 16
    // render at 4 px per module with a quiet zone and read it back
    const cell = 4, margin = 4 * cell, size = n * cell + 2 * margin;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        for (let y = 0; y < cell; y++)
          for (let x = 0; x < cell; x++) {
            const i = ((margin + r * cell + y) * size + margin + c * cell + x) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
      }
    expect(jsQR(px, size, size)?.data).toBe(t);
  });
});
