import { describe, expect, it } from 'vitest';
import { signalingUrl } from './lan';

describe('signalingUrl', () => {
  it('defaults to the page origin', () => {
    expect(signalingUrl(null, 'http:', '127.0.0.1:47615')).toBe('ws://127.0.0.1:47615/signal');
    expect(signalingUrl('', 'https:', 'play.example.com')).toBe('wss://play.example.com/signal');
  });
  it('keeps full ws(s) URLs', () => {
    expect(signalingUrl('wss://relay.example.com/custom', 'https:', 'x')).toBe('wss://relay.example.com/custom');
  });
  it('turns a bare LAN IP into the desktop app relay', () => {
    expect(signalingUrl('192.168.1.20', 'http:', 'x')).toBe('ws://192.168.1.20:47615/signal');
    expect(signalingUrl('192.168.1.20', 'https:', 'x')).toBe('ws://192.168.1.20:47615/signal');
    expect(signalingUrl('192.168.1.20:8080', 'http:', 'x')).toBe('ws://192.168.1.20:8080/signal');
  });
  it('handles http(s) origins and host names', () => {
    expect(signalingUrl('https://relay.example.com/', 'http:', 'x')).toBe('wss://relay.example.com/signal');
    expect(signalingUrl('http://10.0.0.5:47615', 'https:', 'x')).toBe('ws://10.0.0.5:47615/signal');
    expect(signalingUrl('relay.example.com', 'https:', 'x')).toBe('wss://relay.example.com/signal');
  });
});
