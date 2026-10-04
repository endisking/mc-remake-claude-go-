import { describe, it, expect } from 'vitest';
import { CombatTracker, fallLocation, translateDeath, DEATH_MESSAGES } from './combattracker';

const alex = { name: 'Alex', player: true };
const blake = { name: 'Blake', player: true };

describe('death messages (CombatTracker)', () => {
  it('no recorded damage: "died"', () => {
    expect(new CombatTracker().getDeathMessage('Steve')).toBe('Steve died');
  });

  it('falls: under 5 blocks "hit the ground too hard", farther by where the fall started', () => {
    const t = new CombatTracker();
    t.recordDamage({ id: 'fall' }, 2, 2, 10, null, 5, true);
    expect(t.getDeathMessage('Steve')).toBe('Steve hit the ground too hard');
    const u = new CombatTracker();
    u.recordDamage({ id: 'fall' }, 20, 20, 10, fallLocation('ladder', false), 23, true);
    expect(u.getDeathMessage('Steve')).toBe('Steve fell off a ladder');
    const v = new CombatTracker();
    v.recordDamage({ id: 'fall' }, 20, 20, 10, null, 23, true);
    expect(v.getDeathMessage('Steve')).toBe('Steve fell from a high place');
    for (const [block, msg] of [
      ['vine', 'fell off some vines'], ['weeping_vines_plant', 'fell off some weeping vines'], ['twisting_vines', 'fell off some twisting vines'],
      ['scaffolding', 'fell off scaffolding'], ['cave_vines', 'fell while climbing'], ['oak_trapdoor', 'fell off a ladder'],
    ] as const) {
      const w = new CombatTracker();
      w.recordDamage({ id: 'fall' }, 20, 20, 10, fallLocation(block, false), 9, true);
      expect(w.getDeathMessage('Steve')).toBe(`Steve ${msg}`);
    }
  });

  it('a hit before a deadly fall: doomed to fall by the attacker / finished by the last attacker', () => {
    const t = new CombatTracker();
    t.recordDamage({ id: 'player', entity: alex }, 20, 3, 10, null, 0, true);
    t.recordDamage({ id: 'fall' }, 17, 17, 40, null, 20, true);
    expect(t.getDeathMessage('Steve')).toBe('Steve was doomed to fall by Alex');
    // a cactus prick before the fall (no attacker): "was doomed to fall"
    const u = new CombatTracker();
    u.recordDamage({ id: 'cactus' }, 20, 1, 10, null, 0, true);
    u.recordDamage({ id: 'fall' }, 19, 19, 40, null, 20, true);
    expect(u.getDeathMessage('Steve')).toBe('Steve was doomed to fall');
  });

  it('environmental deaths credit the player who hurt the victim ("whilst trying to escape")', () => {
    const t = new CombatTracker();
    t.recordDamage({ id: 'player', entity: blake }, 20, 4, 10, null, 0, true);
    t.recordDamage({ id: 'lava' }, 16, 16, 20, null, 0, true);
    expect(t.getDeathMessage('Steve')).toBe('Steve tried to swim in lava to escape Blake');
    // the kill credit fallback (lastHurtByPlayer) when the tracker has no killer
    const u = new CombatTracker();
    u.recordDamage({ id: 'drown' }, 2, 2, 20, 'water', 0, true);
    expect(u.getDeathMessage('Steve', alex)).toBe('Steve drowned whilst trying to escape Alex');
    expect(u.getDeathMessage('Steve')).toBe('Steve drowned');
  });

  it('player kills, named items, thorns and the bed explosion', () => {
    const t = new CombatTracker();
    t.recordDamage({ id: 'player', entity: alex }, 3, 3, 10, null, 0, true);
    expect(t.getDeathMessage('Steve')).toBe('Steve was slain by Alex');
    const u = new CombatTracker();
    u.recordDamage({ id: 'player', entity: { ...alex, namedItem: '[Excalibur]' } }, 3, 3, 10, null, 0, true);
    expect(u.getDeathMessage('Steve')).toBe('Steve was slain by Alex using [Excalibur]');
    const v = new CombatTracker();
    v.recordDamage({ id: 'thorns', entity: blake, thorns: true }, 1, 1, 10, null, 0, true);
    expect(v.getDeathMessage('Steve')).toBe('Steve was killed trying to hurt Blake');
    const w = new CombatTracker();
    w.recordDamage({ id: 'badRespawnPoint' }, 20, 20, 10, null, 0, true);
    expect(w.getDeathMessage('Steve')).toBe('Steve was killed by [Intentional Game Design]');
  });

  it('forgets hits 5 s after the last one (15 s once in combat)', () => {
    const t = new CombatTracker();
    t.recordDamage({ id: 'cactus' }, 20, 1, 0, null, 0, true);
    t.recordDamage({ id: 'fall' }, 19, 19, 150, null, 20, true);
    // the prick was forgotten: an accident, not "doomed to fall"
    expect(t.getDeathMessage('Steve')).toBe('Steve fell from a high place');
    const u = new CombatTracker();
    u.recordDamage({ id: 'player', entity: alex }, 20, 1, 0, null, 0, true);
    u.recordDamage({ id: 'fall' }, 19, 19, 250, null, 20, true);
    expect(u.getDeathMessage('Steve')).toBe('Steve was doomed to fall by Alex');
  });

  it('has every 1.17.1 death message', () => {
    for (const k of ['anvil', 'arrow', 'cactus', 'cramming', 'dragonBreath', 'drown', 'dryout', 'explosion', 'fall', 'fallingBlock', 'fallingStalactite', 'fireball',
      'fireworks', 'flyIntoWall', 'freeze', 'generic', 'hotFloor', 'inFire', 'inWall', 'indirectMagic', 'lava', 'lightningBolt', 'magic', 'mob', 'onFire', 'outOfWorld',
      'player', 'stalagmite', 'starve', 'sting', 'sweetBerryBush', 'thorns', 'thrown', 'trident', 'wither', 'witherSkull']) {
      expect(DEATH_MESSAGES[`death.attack.${k}`], k).toBeTruthy();
    }
    expect(translateDeath('death.attack.outOfWorld.player', 'Steve', 'Alex')).toBe("Steve didn't want to live in the same world as Alex");
  });
});
