import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf, getProp } from '@shared/world/blockstate';
import { ITEMS_BY_NAME } from '@shared/data';
import { StringReader } from './reader';
import { parseSelector, readRange } from './selector';
import { blockPos, vec3, blockStateArg } from './arguments';
import { CommandSource, plainText, type CommandOutput, type TextComponent } from './source';
import { DEFAULT_ALL_GAME_RULES, GAME_RULE_NAMES } from './gamerules';
import { MemoryAccessStore } from './access';
import { commandHooks } from './hooks';

function client(server: GameServer, name: string, address = '10.0.0.1') {
  const received: S2C[] = [];
  let closed: string | null = null;
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: (r) => (closed = r), address };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  const chat = () => received.filter((p): p is Extract<S2C, { t: 'chat' }> => p.t === 'chat').map((p) => plainText(JSON.parse(p.json) as TextComponent));
  return {
    received, conn, chat,
    get closed() { return closed; },
    send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)),
    run: (cmd: string) => {
      const before = chat().length;
      recv(encodeC2S({ t: 'chat', message: cmd }));
      return chat().slice(before);
    },
  };
}

function newServer(opts: Partial<ConstructorParameters<typeof GameServer>[0]> = {}): GameServer {
  return new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, randomSeed: 1n, ...opts });
}

/** A console-like source at a position with a given permission level. */
function source(server: GameServer, level = 4, pos: [number, number, number] = [0, 64, 0], rot: [number, number] = [0, 0]) {
  const lines: string[] = [];
  const out: CommandOutput = { sendMessage: (m) => lines.push(plainText(m)), acceptsSuccess: () => true, acceptsFailure: () => true, shouldInformAdmins: () => false };
  const src = new CommandSource(server, out, pos[0], pos[1], pos[2], rot[0], rot[1], level, 'Tester', null);
  return { src, lines, run: (cmd: string) => server.commands.perform(src, cmd) };
}

describe('command parser', () => {
  it('parses world, relative and local coordinates', () => {
    const server = newServer();
    const { src } = source(server, 4, [10.7, 64, -3.2], [0, 0]);
    expect(blockPos().parse(new StringReader('1 2 3')).position(src)).toEqual([1, 2, 3]);
    expect(blockPos().parse(new StringReader('~ ~1 ~-2')).position(src).map(Math.floor)).toEqual([10, 65, -6]);
    // vec3 centres integer x/z
    expect(vec3().parse(new StringReader('1 2 3')).position(src)).toEqual([1.5, 2, 3.5]);
    expect(vec3().parse(new StringReader('1.0 2 3.25')).position(src)).toEqual([1, 2, 3.25]);
    // local: yaw 0 faces +z, so ^ ^ ^5 is 5 blocks south
    const p = vec3().parse(new StringReader('^ ^ ^5')).position(src);
    expect(p[0]).toBeCloseTo(10.7);
    expect(p[2]).toBeCloseTo(1.8);
    // ^1 is to the left: facing +z, left is +x
    expect(vec3().parse(new StringReader('^1 ^ ^')).position(src)[0]).toBeCloseTo(11.7);
    expect(() => vec3().parse(new StringReader('^ ~ ^'))).toThrow('Cannot mix world & local coordinates');
    expect(() => vec3().parse(new StringReader('1 2'))).toThrow('Incomplete (expected 3 coordinates)');
    expect(() => blockPos().parse(new StringReader('1.5 2 3'))).toThrow("Invalid integer '1.5'");
  });

  it('parses selectors with options and rejects bad ones with vanilla messages', () => {
    const s = parseSelector(new StringReader('@e[type=minecraft:item,distance=..5,limit=2,sort=nearest]'));
    expect(s.type).toBe('item');
    expect(s.distance).toEqual({ min: null, max: 5 });
    expect(s.maxResults).toBe(2);
    expect(s.sort).toBe('nearest');
    expect(parseSelector(new StringReader('@p')).maxResults).toBe(1);
    expect(parseSelector(new StringReader('Steve')).playerName).toBe('Steve');
    expect(() => parseSelector(new StringReader('@x'))).toThrow("Unknown selector type '@x'");
    expect(() => parseSelector(new StringReader('@'))).toThrow('Missing selector type');
    expect(() => parseSelector(new StringReader('@e[foo=1]'))).toThrow("Unknown option 'foo'");
    expect(() => parseSelector(new StringReader('@e[limit=0]'))).toThrow('Limit must be at least 1');
    expect(() => parseSelector(new StringReader('@e[distance=-1]'))).toThrow('Distance cannot be negative');
    expect(() => parseSelector(new StringReader('@a[type=cow]'))).toThrow("Option 'type' isn't applicable here");
    expect(() => parseSelector(new StringReader('@e[type=unicorn]'))).toThrow("Invalid or unknown entity type 'minecraft:unicorn'");
    expect(() => parseSelector(new StringReader('@e[gamemode=hardcore]'))).toThrow("Invalid or unknown game mode 'hardcore'");
    expect(() => parseSelector(new StringReader('@e[limit=1'))).toThrow('Expected end of options');
    expect(readRange(new StringReader('1..5'), true)).toEqual({ min: 1, max: 5 });
    expect(() => readRange(new StringReader('5..1'), true)).toThrow('Min cannot be bigger than max');
  });

  it('resolves selectors against players and entities', () => {
    const server = newServer();
    const a = client(server, 'Alice');
    const b = client(server, 'Bob');
    server.tick();
    const pa = server.players[0]!, pb = server.players[1]!;
    pa.x = 0; pa.y = 100; pa.z = 0;
    pb.x = 20; pb.y = 100; pb.z = 0;
    server.setGameMode(pb, 1);
    server.popResource(2, 100, 0, { id: ITEMS_BY_NAME.get('stone')!.id, count: 1, damage: 0 });
    const { src } = source(server, 4, [0, 100, 0]);
    const names = (sel: string) => parseSelector(new StringReader(sel)).find(src).map((t) => ('name' in t ? t.name : t.type));
    expect(names('@p')).toEqual(['Alice']);
    expect(names('@a[sort=furthest]')).toEqual(['Bob', 'Alice']);
    expect(names('@a[gamemode=creative]')).toEqual(['Bob']);
    expect(names('@a[gamemode=!creative]')).toEqual(['Alice']);
    expect(names('@e[type=item]')).toEqual(['item']);
    expect(names('@e[distance=..5]').sort()).toEqual(['Alice', 'item']);
    expect(names('@e[x=19,y=99,z=-1,dx=2,dy=2,dz=2]')).toEqual(['Bob']);
    expect(names('@a[name=Bob]')).toEqual(['Bob']);
    expect(names('@e[type=!player]')).toEqual(['item']);
    expect(names('bob')).toEqual(['Bob']);
    void a; void b;
  });

  it('parses block states with properties', () => {
    const b = blockStateArg().parse(new StringReader('minecraft:oak_stairs[facing=east,half=top]'));
    expect(blockNameOf(b.state)).toBe('oak_stairs');
    expect(getProp(b.state, 'facing')).toBe('east');
    expect(getProp(b.state, 'half')).toBe('top');
    expect(() => blockStateArg().parse(new StringReader('oak_stairs[color=red]'))).toThrow("Block minecraft:oak_stairs does not have property 'color'");
    expect(() => blockStateArg().parse(new StringReader('oak_stairs[facing=up]'))).toThrow("Block minecraft:oak_stairs does not accept 'up' for facing property");
    expect(() => blockStateArg().parse(new StringReader('nope'))).toThrow("Unknown block type 'minecraft:nope'");
    expect(() => blockStateArg().parse(new StringReader('#logs'))).toThrow("Tags aren't allowed here, only actual blocks");
  });

  it('reports unknown commands and bad arguments with the <--[HERE] marker', () => {
    const server = newServer();
    const a = client(server, 'A');
    expect(a.run('/foo')).toEqual(['Unknown or incomplete command, see below for error', 'foo<--[HERE]']);
    expect(a.run('/gamemode')).toEqual(['Unknown or incomplete command, see below for error', 'gamemode<--[HERE]']);
    expect(a.run('/gamemode banana')).toEqual(['Incorrect argument for command', 'gamemode banana<--[HERE]']);
    expect(a.run('/time set -5')).toEqual(['Tick count must be non-negative']);
    expect(a.run('/give @s stone 0')).toEqual(['Integer must not be less than 1, found 0', '... @s stone 0<--[HERE]']);
    expect(a.run('/give @s unobtainium')).toEqual(["Unknown item 'minecraft:unobtainium'", 'give @s unobtainium<--[HERE]']);
  });
});

describe('permissions', () => {
  it('integrated server: cheats on gives everyone level 4; cheats off allows no cheat commands', () => {
    const on = newServer();
    const a = client(on, 'A');
    expect(a.run('/time set day')).toEqual(['Set the time to 1000']);
    const off = newServer({ cheats: false });
    const b = client(off, 'B');
    expect(b.run('/time set day')[0]).toBe('Unknown or incomplete command, see below for error');
    // level-0 commands still work
    expect(b.run('/list')).toEqual(['There are 1 of a max of 8 players online: B']);
    expect(b.run('/seed')).toEqual(['Seed: [7]']);
  });

  it('dedicated server: only ops (with their level) may cheat, kick, ban or stop', () => {
    const store = new MemoryAccessStore();
    store.save('ops', [{ name: 'Mod', level: 3, bypassesPlayerLimit: false }]);
    const server = newServer({ dedicated: true, access: store });
    const guest = client(server, 'Guest');
    const mod = client(server, 'Mod');
    expect(guest.run('/time set day')[0]).toBe('Unknown or incomplete command, see below for error');
    expect(guest.run('/seed')[0]).toBe('Unknown or incomplete command, see below for error');
    expect(mod.run('/time set day')).toEqual(['Set the time to 1000']);
    expect(mod.run('/stop')[0]).toBe('Unknown or incomplete command, see below for error');
    expect(mod.run('/op Guest')).toEqual(['Made Guest a server operator']);
    expect(store.load('ops')).toEqual([{ name: 'Mod', level: 3, bypassesPlayerLimit: false }, { name: 'Guest', level: 4, bypassesPlayerLimit: false }]);
    expect(mod.run('/op Guest')).toEqual(['Nothing changed. The player already is an operator']);
    // ops see other ops' commands as "[Name: message]"
    expect(guest.chat().at(-1)).toBe('[Mod: Made Guest a server operator]');
    let stopped = false;
    server.commands.onStop = () => (stopped = true);
    expect(guest.run('/stop')).toContain('Stopping the server');
    expect(stopped).toBe(true);
  });

  it('bans, IP bans and the whitelist are enforced at login and persisted', () => {
    const store = new MemoryAccessStore();
    store.save('ops', [{ name: 'Admin', level: 4, bypassesPlayerLimit: false }]);
    const server = newServer({ dedicated: true, access: store });
    const admin = client(server, 'Admin');
    const griefer = client(server, 'Griefer', '10.0.0.66');
    expect(admin.run('/ban Griefer being rude')).toEqual(['Banned Griefer: being rude', 'Griefer left the game']);
    expect(griefer.closed).toBe('You are banned from this server.');
    expect(server.players.map((p) => p.name)).toEqual(['Admin']);
    expect((store.load('banned-players') as { name: string; reason: string }[])[0]).toMatchObject({ name: 'Griefer', reason: 'being rude', source: 'Admin', expires: 'forever' });
    const again = client(server, 'Griefer');
    expect(again.closed).toBe('You are banned from this server.\nReason: being rude');
    expect(admin.run('/pardon Griefer')).toEqual(['Unbanned Griefer']);
    expect(admin.run('/ban-ip 10.0.0.66')).toEqual(['Banned IP 10.0.0.66: Banned by an operator.']);
    expect(client(server, 'Alt', '10.0.0.66').closed).toBe('Your IP address is banned from this server.\nReason: Banned by an operator.');
    expect(admin.run('/banlist ips')).toEqual(['There are 1 ban(s):', '10.0.0.66 was banned by Admin: Banned by an operator.']);
    expect(admin.run('/pardon-ip 10.0.0.66')).toEqual(['Unbanned IP 10.0.0.66']);
    // whitelist
    expect(admin.run('/whitelist on')).toEqual(['Whitelist is now turned on']);
    expect(admin.run('/whitelist add Friend')).toEqual(['Added Friend to the whitelist']);
    expect(admin.run('/whitelist list')).toEqual(['There are 1 whitelisted players: Friend']);
    expect(client(server, 'Stranger').closed).toBe('You are not white-listed on this server!');
    expect(client(server, 'Friend').closed).toBeNull();
    expect(store.load('whitelist')).toEqual([{ name: 'Friend' }]);
    expect(store.load('server-settings')).toMatchObject({ whitelist: true });
    // a fresh server with the same store keeps everything
    const restarted = newServer({ dedicated: true, access: store });
    expect(client(restarted, 'Stranger').closed).toBe('You are not white-listed on this server!');
  });
});

describe('world commands', () => {
  function withChunks() {
    const server = newServer();
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    return { server, a, p };
  }

  it('/fill: volumes, modes, filter and the 32768 limit', () => {
    const { server, a } = withChunks();
    const stone = stateOf('stone'), glass = stateOf('glass');
    expect(a.run('/fill 0 150 0 2 152 2 stone')).toEqual(['Successfully filled 27 blocks']);
    expect(a.run('/fill 0 150 0 2 152 2 stone')).toEqual(['No blocks were filled']);
    expect(a.run('/fill 0 150 0 2 152 2 glass hollow')).toEqual(['Successfully filled 27 blocks']);
    expect(server.world.getState(1, 151, 1)).toBe(0);
    expect(server.world.getState(0, 150, 0)).toBe(glass);
    expect(a.run('/fill 0 150 0 2 152 2 stone outline')).toEqual(['Successfully filled 26 blocks']);
    expect(server.world.getState(1, 151, 1)).toBe(0);
    expect(a.run('/fill 0 150 0 2 152 2 glass keep')).toEqual(['Successfully filled 1 blocks']);
    expect(server.world.getState(1, 151, 1)).toBe(glass);
    expect(a.run('/fill 0 150 0 2 152 2 dirt replace glass')).toEqual(['Successfully filled 1 blocks']);
    expect(blockNameOf(server.world.getState(1, 151, 1))).toBe('dirt');
    expect(server.world.getState(0, 150, 0)).toBe(stone);
    expect(a.run('/fill 0 0 0 31 31 32 stone')).toEqual(['Too many blocks in the specified area (maximum 32768, specified 33792)']);
    expect(a.run('/fill 0 150 0 2 152 2 glass destroy')).toEqual(['Successfully filled 27 blocks']);
    expect([...server.entities.values()].some((e) => e.type === 'item')).toBe(true);
    expect(a.run('/fill 5000 150 5000 5001 150 5001 stone')).toEqual(['That position is not loaded']);
  });

  it('/clone: replace, masked, filtered, move, overlap and force', () => {
    const { server, a } = withChunks();
    const stone = stateOf('stone');
    a.run('/fill 0 100 0 1 101 1 stone');
    server.setBlock(0, 101, 0, 0);
    expect(a.run('/clone 0 100 0 1 101 1 4 100 0')).toEqual(['Successfully cloned 8 blocks']);
    expect(server.world.getState(4, 100, 0)).toBe(stone);
    expect(server.world.getState(4, 101, 0)).toBe(0);
    server.setBlock(8, 101, 0, stateOf('glass'));
    expect(a.run('/clone 0 100 0 1 101 1 8 100 0 masked')).toEqual(['Successfully cloned 7 blocks']);
    expect(blockNameOf(server.world.getState(8, 101, 0))).toBe('glass');
    expect(a.run('/clone 0 100 0 1 101 1 12 100 0 filtered stone')).toEqual(['Successfully cloned 7 blocks']);
    expect(a.run('/clone 0 100 0 1 101 1 1 100 0')).toEqual(['The source and destination areas cannot overlap']);
    expect(a.run('/clone 0 100 0 1 101 1 1 100 0 replace force')).toEqual(['Successfully cloned 8 blocks']);
    expect(a.run('/clone 4 100 0 5 101 1 4 110 0 replace move')).toEqual(['Successfully cloned 8 blocks']);
    expect(server.world.getState(4, 100, 0)).toBe(0);
    expect(server.world.getState(4, 110, 0)).toBe(stone);
    expect(a.run('/clone 0 0 0 31 31 32 0 100 0')).toEqual(['Too many blocks in the specified area (maximum 32768, specified 33792)']);
  });

  it('/setblock modes', () => {
    const { server, a } = withChunks();
    expect(a.run('/setblock 3 100 3 stone')).toEqual(['Changed the block at 3, 100, 3']);
    expect(a.run('/setblock 3 100 3 stone')).toEqual(['Could not set the block']);
    expect(a.run('/setblock 3 100 3 glass keep')).toEqual(['Could not set the block']);
    expect(a.run('/setblock 3 100 3 oak_stairs[facing=west] destroy')).toEqual(['Changed the block at 3, 100, 3']);
    expect(getProp(server.world.getState(3, 100, 3), 'facing')).toBe('west');
  });

  it('/tp forms, /give, /clear, /kill, /xp, /time, /weather, /difficulty', () => {
    const { server, a, p } = withChunks();
    const b = client(server, 'B');
    server.tick();
    expect(a.run('/tp 10 100 10')).toEqual(['Teleported A to 10.5, 100.0, 10.5']);
    expect([p.x, p.y, p.z]).toEqual([10.5, 100, 10.5]);
    expect(a.run('/tp ~1 ~ ~-0.5')).toEqual(['Teleported A to 11.5, 100.0, 10.0']);
    expect(a.run('/teleport B A')).toEqual(['Teleported B to A']);
    expect(server.players[1]!.x).toBe(11.5);
    expect(a.run('/tp @a 0 120 0 90 45')).toEqual(['Teleported 2 entities to 0.5, 120.0, 0.5']);
    expect(p.yaw).toBe(90);
    expect(p.pitch).toBe(45);
    a.run('/tp @s 0 120 0 facing 0 120 10');
    expect(p.yaw).toBeCloseTo(0);
    expect(a.run('/tp @s 0 30000001 0')).toEqual(['Invalid position for teleport']);
    expect(a.run('/give @s minecraft:diamond 70')).toEqual(['Gave 70 [Diamond] to A']);
    expect(p.inventory.get(0)).toMatchObject({ count: 64 });
    expect(a.run('/give @a stone 6401')).toEqual(["Can't give more than 6400 of [Stone]"]);
    expect(a.run('/clear @s diamond 0')).toEqual(['Found 70 matching items on player A']);
    expect(a.run('/clear @s diamond 5')).toEqual(['Removed 5 items from player A']);
    expect(a.run('/clear')).toEqual(['Removed 65 items from player A']);
    expect(a.run('/clear')).toEqual(['No items were found on player A']);
    expect(a.run('/xp add @s 5 levels')).toEqual(['Gave 5 experience levels to A']);
    expect(a.run('/xp query @s levels')).toEqual(['A has 5 experience levels']);
    expect(a.run('/experience set @s 3 points')).toEqual(['Set 3 experience points on A']);
    expect(a.run('/xp query @s points')).toEqual(['A has 3 experience points']);
    expect(a.run('/xp set @s 100 points')).toEqual(["Cannot set experience points above the maximum points for the player's current level"]);
    expect(a.run('/time set noon')).toEqual(['Set the time to 6000']);
    expect(a.run('/time add 1d')).toEqual(['Set the time to 6000']);
    expect(a.run('/time query day')).toEqual(['The time is 1']);
    expect(a.run('/time query daytime')).toEqual(['The time is 6000']);
    expect(a.run('/weather thunder 10')).toEqual(['Set the weather to rain & thunder']);
    expect(server.thundering).toBe(true);
    expect(server.rainTime).toBe(200);
    expect(a.run('/difficulty hard')).toEqual(['The difficulty has been set to Hard']);
    expect(a.run('/difficulty hard')).toEqual(['The difficulty did not change; it is already set to Hard']);
    expect(a.run('/difficulty')).toEqual(['The difficulty is Hard']);
    expect(a.run('/gamemode creative B')).toEqual(["Set B's game mode to Creative Mode"]);
    expect(b.chat()).toContain('Your game mode has been updated to Creative Mode');
    expect(a.run('/gamemode spectator')).toEqual(['Set own game mode to Spectator Mode']);
    expect(a.run('/kill B')).toEqual(['B fell out of the world', 'Killed B']);
    server.popResource(0, 120, 0, { id: ITEMS_BY_NAME.get('stone')!.id, count: 1, damage: 0 });
    expect(a.run('/kill @e[type=item]')).toEqual(['Killed Stone']);
    expect(a.run('/kill @e[type=item]')).toEqual(['No entity was found']);
  });

  it('/spawnpoint, /setworldspawn, /summon, /locate and hooks', () => {
    const { server, a, p } = withChunks();
    expect(a.run('/spawnpoint @s 1 100 2')).toEqual(['Set spawn point to 1, 100, 2 [0.0] in minecraft:overworld for A']);
    expect(p.respawn).toMatchObject({ x: 1, y: 100, z: 2 });
    expect(a.run('/setworldspawn 5 90 5 45')).toEqual(['Set the world spawn point to 5, 90, 5 [45.0]']);
    expect(server.worldSpawn).toEqual([5, 90, 5]);
    expect(a.run('/summon minecraft:item ~ ~ ~ {Item:{id:"minecraft:apple",Count:3b}}')).toEqual(['Summoned new Apple']);
    expect(a.run('/summon zombie')).toEqual(['Unable to summon entity']);
    expect(a.run('/summon unicorn')).toEqual(['Unknown entity: minecraft:unicorn']);
    expect(a.run('/locate village')).toEqual(['Could not find that structure nearby']);
    commandHooks.locate.set('village', () => [100, -200]);
    try {
      p.x = 0; p.z = 0;
      expect(a.run('/locate village')).toEqual(['The nearest village is at [100, ~, -200] (223 blocks away)']);
    } finally {
      commandHooks.locate.delete('village');
    }
    expect(a.run('/effect give @s speed')).toEqual(['Applied effect Speed to A']);
    expect(a.run('/effect give @s speed 10 0')).toEqual(['Unable to apply this effect (target is either immune to effects, or has something stronger)']);
    expect(a.run('/effect give @s nope')).toEqual(['Unknown effect: minecraft:nope']);
    expect(a.run('/enchant @s sharpness 6')).toEqual(['6 is higher than the maximum level of 5 supported by that enchantment']);
  });
});

describe('gamerules', () => {
  it('every 1.17.1 rule with its default; set and query; legacy fields follow', () => {
    expect(GAME_RULE_NAMES.length).toBe(35);
    expect(DEFAULT_ALL_GAME_RULES.randomTickSpeed).toBe(3);
    expect(DEFAULT_ALL_GAME_RULES.maxEntityCramming).toBe(24);
    expect(DEFAULT_ALL_GAME_RULES.playersSleepingPercentage).toBe(100);
    expect(DEFAULT_ALL_GAME_RULES.spawnRadius).toBe(10);
    expect(DEFAULT_ALL_GAME_RULES.maxCommandChainLength).toBe(65536);
    expect(DEFAULT_ALL_GAME_RULES.keepInventory).toBe(false);
    expect(DEFAULT_ALL_GAME_RULES.doInsomnia).toBe(true);
    const server = newServer();
    const a = client(server, 'A');
    expect(a.run('/gamerule keepInventory')).toEqual(['Gamerule keepInventory is currently set to: false']);
    expect(a.run('/gamerule keepInventory true')).toEqual(['Gamerule keepInventory is now set to: true']);
    expect(server.gameRules.keepInventory).toBe(true);
    a.run('/gamerule doTileDrops false');
    server.popResource(0, 100, 0, { id: ITEMS_BY_NAME.get('stone')!.id, count: 1, damage: 0 });
    expect(server.entities.size).toBe(0);
    a.run('/gamerule doTileDrops true');
    expect(a.run('/gamerule randomTickSpeed 10')).toEqual(['Gamerule randomTickSpeed is now set to: 10']);
    expect(server.gameRules.randomTickSpeed).toBe(10);
    expect(a.run('/gamerule doDaylightCycle false')).toEqual(['Gamerule doDaylightCycle is now set to: false']);
    expect(server.doDaylightCycle).toBe(false);
    a.run('/gamerule playersSleepingPercentage 50');
    expect(server.playersSleepingPercentage).toBe(50);
    expect(a.run('/gamerule randomTickSpeed fast')[0]).toBe('Expected integer');
    // sendCommandFeedback false silences success messages
    a.run('/gamerule sendCommandFeedback false');
    expect(a.run('/time set day')).toEqual([]);
  });
});

describe('chat and suggestions', () => {
  it('broadcasts chat, /say, /me, /msg and join/leave messages', () => {
    const server = newServer();
    const a = client(server, 'A');
    const b = client(server, 'B');
    expect(a.chat()).toContain('B joined the game');
    a.run('hello   world ');
    expect(b.chat().at(-1)).toBe('<A> hello world');
    a.run('/say hi all');
    expect(b.chat().at(-1)).toBe('[A] hi all');
    a.run('/me waves');
    expect(b.chat().at(-1)).toBe('* A waves');
    expect(a.run('/msg B psst')).toEqual(['You whisper to B: psst']);
    expect(b.chat().at(-1)).toBe('A whispers to you: psst');
    a.run('/tell B again');
    expect(b.chat().at(-1)).toBe('A whispers to you: again');
    a.run('/tellraw @a {"text":"Hi ","color":"gold","extra":[{"text":"there"}]}');
    expect(b.chat().at(-1)).toBe('Hi there');
    expect(a.run('/tellraw @a {oops')[0]).toBe('Invalid chat component: Not a JSON value');
    expect(a.run('/spectate B')).toEqual(['A is not in spectator mode']);
    a.run('/gamemode spectator');
    expect(a.run('/spectate B')).toEqual(['Now spectating B']);
    expect(server.players[0]!.camera).toBe(server.players[1]);
    expect(a.run('/spectate')).toEqual(['No longer spectating an entity']);
    server.disconnect(b.conn);
    expect(a.chat().at(-1)).toBe('B left the game');
  });

  it('answers suggestion requests with literals, players, ids and usage', () => {
    const server = newServer();
    const a = client(server, 'Alice');
    client(server, 'Bob');
    const ask = (text: string) => {
      a.send({ t: 'commandSuggest', id: 1, text });
      const p = a.received.filter((x): x is Extract<S2C, { t: 'commandSuggestions' }> => x.t === 'commandSuggestions').at(-1)!;
      return JSON.parse(p.json) as { start: number; list: { text: string }[]; usage: string[] };
    };
    let r = ask('/gam');
    expect(r.start).toBe(1);
    expect(r.list.map((s) => s.text)).toEqual(['gamemode', 'gamerule']);
    r = ask('/gamemode cr');
    expect(r.start).toBe(10);
    expect(r.list.map((s) => s.text)).toEqual(['creative']);
    r = ask('/gamemode creative ');
    expect(r.list.map((s) => s.text)).toEqual(expect.arrayContaining(['@a', '@p', 'Alice', 'Bob']));
    r = ask('/give @s minecraft:diamond_s');
    expect(r.list.map((s) => s.text)).toEqual(['minecraft:diamond_shovel', 'minecraft:diamond_sword']);
    r = ask('/tp @e[ty');
    expect(r.list.map((s) => s.text)).toEqual(['@e[type=']);
    r = ask('/give @s stone ');
    expect(r.list).toEqual([]);
    expect(r.usage).toEqual(['[<count>]']);
    // a fully typed literal is not suggested again (SuggestionsBuilder.suggest)
    r = ask('/help');
    expect(r.list).toEqual([]);
  });

  it('/help lists usage', () => {
    const server = newServer();
    const { lines, run } = source(server);
    run('help gamemode');
    expect(lines).toEqual(['/gamemode survival [<target>]', '/gamemode creative [<target>]', '/gamemode adventure [<target>]', '/gamemode spectator [<target>]']);
    lines.length = 0;
    run('help time');
    expect(lines).toEqual(['/time set (day|noon|night|midnight|<time>)', '/time add <time>', '/time query (daytime|gametime|day)']);
  });
});
