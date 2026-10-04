import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf, blockNameOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { Difficulty } from '@shared/game/food';
import { itemName, stack } from '@shared/item/stack';
import { Villager, WanderingTrader, scheduleActivity } from './villager';
import { offersForLevel } from '@shared/game/trades';
import { JavaRandom } from '@shared/util/random';
import { IronGolem, SnowGolem } from './golems';
import { Zombie, ZombieVillager } from './monsters';

const GRASS = stateOf('grass_block', { snowy: false });
const STONE = stateOf('stone');

class FlatGen {
  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    c.biomes.fill(BIOMES_BY_NAME.get('plains')!.id);
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        c.setState(x, 0, z, stateOf('bedrock'));
        for (let y = 1; y < 63; y++) c.setState(x, y, z, STONE);
        c.setState(x, 63, z, GRASS);
      }
    c.computeHeightmaps();
    return c;
  }
}

function setup(dayTime = 6000) {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: 0, devTerrain: true, randomSeed: 42n, spawnMobs: false });
  (server as unknown as { level: { generator: FlatGen } }).level.generator = new FlatGen();
  server.doDaylightCycle = false;
  server.dayTime = dayTime;
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  const send = (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p));
  send({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' });
  const p = server.players[0]!;
  send({ t: 'chat', message: '/tp 0.5 64 0.5' });
  send({ t: 'move', x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 0, onGround: true });
  for (let i = 0; i < 61; i++) server.tick();
  return { server, p, send, received };
}
const ticks = (s: GameServer, n: number) => {
  for (let i = 0; i < n; i++) s.tick();
};

describe('villagers', () => {
  it('schedule: work 2000–9000, meet 9000–11000, rest at night; babies play', () => {
    expect(scheduleActivity(1000, false)).toBe('idle');
    expect(scheduleActivity(5000, false)).toBe('work');
    expect(scheduleActivity(10000, false)).toBe('meet');
    expect(scheduleActivity(13000, false)).toBe('rest');
    expect(scheduleActivity(4000, true)).toBe('play');
  });

  it('an unemployed villager claims a nearby lectern and becomes a librarian with 2 novice offers', () => {
    const { server } = setup();
    const v = server.mobs.spawn('villager', 4.5, 64, 4.5, 'command') as Villager;
    server.setBlock(7, 64, 4, stateOf('lectern'));
    ticks(server, 600);
    expect(v.jobSite).toEqual([7, 64, 4]);
    expect(v.profession).toBe('librarian');
    expect(v.offers.length).toBe(2);
    // a second villager can't claim the same job site
    const v2 = server.mobs.spawn('villager', 3.5, 64, 3.5, 'command') as Villager;
    ticks(server, 300);
    expect(v2.profession).toBe('none');
    // a novice that never traded loses its profession with the job site
    server.setBlock(7, 64, 4, 0);
    ticks(server, 300);
    expect(v.profession).toBe('none');
    expect(v.offers.length).toBe(0);
  });

  it('trading uses the offer, gives villager xp and levels up to apprentice after 40 ticks', () => {
    const { server } = setup();
    const v = server.mobs.spawn('villager', 4.5, 64, 4.5, 'command') as Villager;
    v.setProfession('farmer');
    v.offers = [];
    v.offers = offersForLevel('farmer', 1, new JavaRandom(3n));
    expect(v.level).toBe(1);
    expect(v.offers.length).toBe(2);
    const o = v.offers[0]!;
    const pay = { ...o.costA, count: 64 };
    const pay2 = o.costB ? { ...o.costB, count: 64 } : null;
    let traded = 0;
    while (v.xp < 10 && v.trade(0, pay, pay2, null)) traded++;
    expect(traded).toBeGreaterThan(0);
    expect(o.uses).toBe(traded);
    expect(v.xp).toBeGreaterThanOrEqual(10);
    ticks(server, 41);
    expect(v.level).toBe(2);
    expect(v.offers.length).toBe(4);
    // restock resets uses (twice a day max)
    v.restock();
    expect(v.offers.every((x) => x.uses === 0)).toBe(true);
    v.restock();
    expect(v.allowedToRestock()).toBe(false);
  });

  it('right-clicking a baby or a jobless villager shakes the head; an employed one opens trading', () => {
    const { server, send } = setup();
    let opened: Villager | null = null;
    server.mobs.openMerchant = (_p, v) => (opened = v as Villager);
    const v = server.mobs.spawn('villager', 2.5, 64, 0.5, 'command') as Villager;
    ticks(server, 2);
    send({ t: 'interactEntity', id: v.id, hand: 0 });
    expect(v.unhappyCounter).toBeGreaterThan(0);
    v.setProfession('mason');
    v.offers = [{ costA: stack('clay_ball', 10), costB: null, result: stack('emerald'), uses: 0, maxUses: 16, xp: 2, priceMultiplier: 0.05, demand: 0, specialPriceDiff: 0, rewardExp: true }];
    send({ t: 'interactEntity', id: v.id, hand: 0 });
    expect(opened).toBe(v);
    expect(v.tradingPlayer).toBe(server.players[0]);
  });

  it('zombies convert killed villagers on hard; golden apple + weakness cures them with their trades', () => {
    const { server, send, p } = setup();
    server.difficulty = Difficulty.Hard;
    const v = server.mobs.spawn('villager', 6.5, 64, 6.5, 'command') as Villager;
    v.setProfession('cleric');
    v.level = 3;
    v.offers = [{ costA: stack('rotten_flesh', 32), costB: null, result: stack('emerald'), uses: 0, maxUses: 16, xp: 2, priceMultiplier: 0.05, demand: 0, specialPriceDiff: 0, rewardExp: true }];
    const z = server.mobs.spawn('zombie', 7.5, 64, 6.5, 'command') as Zombie;
    v.health = 1;
    server.mobs.doHurtTarget(z, v);
    ticks(server, 1);
    expect(v.removed).toBe(true);
    const zv = server.mobs.mobs().find((m) => m instanceof ZombieVillager) as ZombieVillager;
    expect(zv).toBeTruthy();
    expect(zv.villagerData?.profession).toBe('cleric');
    expect(zv.villagerData?.level).toBe(3);
    // curing: golden apple without weakness does nothing
    send({ t: 'chat', message: '/give @s golden_apple 2' });
    zv.x = p.x + 1.5;
    zv.z = p.z;
    zv.y = 64;
    send({ t: 'interactEntity', id: zv.id, hand: 0 });
    expect(zv.isConverting()).toBe(false);
    zv.addMobEffect('weakness', 1200, 0);
    send({ t: 'interactEntity', id: zv.id, hand: 0 });
    expect(zv.isConverting()).toBe(true);
    expect(zv.villagerConversionTime).toBeGreaterThanOrEqual(3600 - 1);
    expect(zv.villagerConversionTime).toBeLessThanOrEqual(6000);
    zv.villagerConversionTime = 2;
    zv.mainHand = null;
    ticks(server, 3);
    const cured = server.mobs.mobs().find((m) => m instanceof Villager) as Villager;
    expect(cured).toBeTruthy();
    expect(cured.profession).toBe('cleric');
    expect(cured.level).toBe(3);
    expect(cured.offers.length).toBe(1);
  });

  it('on normal difficulty about half of the villagers killed by zombies convert; on easy none', () => {
    const { server } = setup();
    let converted = 0;
    for (const [d, n] of [[Difficulty.Easy, 20], [Difficulty.Normal, 40]] as const) {
      server.difficulty = d;
      for (let i = 0; i < n; i++) {
        const v = server.mobs.spawn('villager', 6.5, 64, 6.5, 'command') as Villager;
        const z = server.mobs.spawn('zombie', 7.5, 64, 6.5, 'command') as Zombie;
        const before = server.mobs.mobs().filter((m) => m instanceof ZombieVillager).length;
        v.health = 0.5;
        v.invulnerableTime = 0;
        server.mobs.doHurtTarget(z, v);
        const after = server.mobs.mobs().filter((m) => m instanceof ZombieVillager).length;
        if (d === Difficulty.Easy) expect(after).toBe(before);
        else converted += after - before;
        z.removed = true;
        for (const m of server.mobs.mobs()) if (m instanceof ZombieVillager) m.removed = true;
        ticks(server, 1);
      }
    }
    expect(converted).toBeGreaterThan(8);
    expect(converted).toBeLessThan(32);
  });

  it('the wandering trader has 6 offers and despawns after 48000 ticks', () => {
    const { server } = setup();
    const t = server.mobs.spawn('wandering_trader', 3.5, 64, 3.5, 'command') as WanderingTrader;
    expect(t.offers.length).toBe(6);
    t.despawnDelay = 3;
    ticks(server, 4);
    expect(t.removed).toBe(true);
  });

  it('villagers pick up bread and become willing to breed with 12 food points', () => {
    const { server } = setup();
    const v = server.mobs.spawn('villager', 3.5, 64, 3.5, 'command') as Villager;
    expect(v.canBreed()).toBe(false);
    v.addToInventory(stack('bread', 3));
    expect(v.countFood()).toBe(12);
    expect(v.canBreed()).toBe(true);
  });
});

describe('golems', () => {
  it('a T of iron blocks topped with a carved pumpkin builds a player-created iron golem', () => {
    const { server } = setup();
    const iron = stateOf('iron_block');
    server.setBlock(5, 64, 5, iron);
    server.setBlock(5, 65, 5, iron);
    server.setBlock(4, 65, 5, iron);
    server.setBlock(6, 65, 5, iron);
    server.setBlock(5, 66, 5, stateOf('carved_pumpkin', { facing: 'south' }));
    const g = server.mobs.mobs().find((m) => m instanceof IronGolem) as IronGolem;
    expect(g).toBeTruthy();
    expect(g.playerCreated).toBe(true);
    expect(g.maxHealth).toBe(100);
    expect(blockNameOf(server.world.getState(5, 65, 5))).toBe('air');
    expect(blockNameOf(server.world.getState(4, 65, 5))).toBe('air');
  });

  it('two snow blocks and a pumpkin build a snow golem; it leaves snow in cold biomes only', () => {
    const { server } = setup();
    server.setBlock(8, 64, 8, stateOf('snow_block'));
    server.setBlock(8, 65, 8, stateOf('snow_block'));
    server.setBlock(8, 66, 8, stateOf('jack_o_lantern', { facing: 'south' }));
    const g = server.mobs.mobs().find((m) => m instanceof SnowGolem) as SnowGolem;
    expect(g).toBeTruthy();
    expect(g.maxHealth).toBe(4);
    ticks(server, 20);
    // plains (0.8) is too warm for snow trails
    expect(blockNameOf(server.world.getState(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z)))).not.toBe('snow');
  });

  it('iron golem hits for 7.5–21.5 and tosses the target upward; attacks monsters but not creepers', () => {
    const { server } = setup();
    const g = server.mobs.spawn('iron_golem', 4.5, 64, 4.5, 'command') as IronGolem;
    const dmg = new Set<number>();
    for (let i = 0; i < 300; i++) dmg.add(g.meleeDamage());
    expect(Math.min(...dmg)).toBe(7.5);
    expect(Math.max(...dmg)).toBe(21.5);
    const z = server.mobs.spawn('zombie', 6.5, 64, 4.5, 'command') as Zombie;
    z.health = 1000;
    (z as unknown as { maxHealth: number }).maxHealth;
    const vy0 = z.vy;
    server.mobs.doHurtTarget(g, z);
    expect(z.vy).toBeGreaterThan(vy0 + 0.39);
    z.removed = true;
    ticks(server, 1);
    // targeting
    const c = server.mobs.spawn('creeper', 7.5, 64, 4.5, 'command')!;
    const sk = server.mobs.spawn('skeleton', 9.5, 64, 4.5, 'command')!;
    g.target = null;
    for (let i = 0; i < 100 && !g.target; i++) server.tick();
    expect(g.target).toBe(sk);
    expect(g.target).not.toBe(c);
  });

  it('iron golems drop 3–5 iron ingots and 0–2 poppies', async () => {
    const { mobLoot } = await import('@shared/game/mobloot');
    let r = 0.5;
    const loot = mobLoot('iron_golem', { random: () => (r = (r * 9301 + 49297) % 233280 / 233280), killedByPlayer: true, looting: 0, onFire: false });
    const iron = loot.find((s) => itemName(s.id) === 'iron_ingot')!;
    expect(iron.count).toBeGreaterThanOrEqual(3);
    expect(iron.count).toBeLessThanOrEqual(5);
  });

  it('panicking villagers that slept recently summon an iron golem when 3 of them want one', () => {
    const { server } = setup();
    const vs = [0, 1, 2].map((i) => server.mobs.spawn('villager', 2.5 + i, 64, 6.5, 'command') as Villager);
    for (const v of vs) v.lastSlept = server.gameTime;
    vs[0]!.spawnGolemIfNeeded(3);
    expect(server.mobs.mobs().some((m) => m instanceof IronGolem)).toBe(true);
    expect(vs.every((v) => !v.wantsToSpawnGolem())).toBe(true);
  });
});
