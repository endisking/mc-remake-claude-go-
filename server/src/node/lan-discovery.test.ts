import { describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import { encodeAnnouncement, parseAnnouncement, LanWorldList, EXPIRE_MS } from './lan-discovery';

describe('LAN discovery', () => {
  it('round-trips an announcement in the vanilla text format', () => {
    const text = encodeAnnouncement({ motd: 'Steve - New World', port: 47615, room: 'ABCDE' });
    expect(text).toBe('[MOTD]Steve - New World[/MOTD][AD]47615[/AD][ROOM]ABCDE[/ROOM]');
    expect(parseAnnouncement(text)).toEqual({ motd: 'Steve - New World', port: 47615, room: 'ABCDE' });
  });

  it('rejects malformed or foreign packets', () => {
    // a real Minecraft LAN ping has no room code
    expect(parseAnnouncement('[MOTD]A world[/MOTD][AD]25565[/AD]')).toBeNull();
    expect(parseAnnouncement('[MOTD]x[/MOTD][AD]0[/AD][ROOM]AB[/ROOM]')).toBeNull();
    expect(parseAnnouncement('[MOTD]x[/MOTD][AD]70000[/AD][ROOM]AB[/ROOM]')).toBeNull();
    expect(parseAnnouncement('[MOTD]x[/MOTD][AD]1[/AD][ROOM]a b[/ROOM]')).toBeNull();
    expect(parseAnnouncement('garbage')).toBeNull();
  });

  it('keeps tags out of the MOTD so it cannot spoof fields', () => {
    const text = encodeAnnouncement({ motd: 'x[/MOTD][AD]1[/AD]', port: 47615, room: 'ROOM1' });
    expect(parseAnnouncement(text)).toEqual({ motd: 'x1', port: 47615, room: 'ROOM1' });
  });

  it('lists worlds by address and room and expires silent ones', () => {
    const list = new LanWorldList();
    list.heard({ motd: 'B', port: 47615, room: 'R1' }, '192.168.1.5', 0);
    list.heard({ motd: 'A', port: 47615, room: 'R2' }, '192.168.1.6', 1000);
    list.heard({ motd: 'B', port: 47615, room: 'R1' }, '192.168.1.5', 1500);
    expect(list.list(2000).map((w) => w.motd)).toEqual(['A', 'B']);
    expect(list.list(1000 + EXPIRE_MS + 1).map((w) => w.room)).toEqual(['R1']);
    expect(list.list(1500 + EXPIRE_MS + 1)).toEqual([]);
  });

  it('a datagram on the wire parses back (loopback)', async () => {
    const rx = createSocket('udp4');
    await new Promise<void>((r) => rx.bind(0, '127.0.0.1', r));
    const got = new Promise<string>((r) => rx.once('message', (m) => r(m.toString())));
    const tx = createSocket('udp4');
    tx.send(encodeAnnouncement({ motd: 'Alex - Island', port: 47615, room: 'XY7Z' }), rx.address().port, '127.0.0.1');
    expect(parseAnnouncement(await got)?.room).toBe('XY7Z');
    tx.close();
    rx.close();
  });
});
