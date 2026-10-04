/**
 * Death messages (vanilla CombatTracker + DamageSource.getLocalizedDeathMessage, 1.17.1): every
 * hit is recorded with the victim's fall distance and where it was climbing; the death message
 * picks the most significant fall, the killer who did the most damage (players first) and the
 * damage type's wording. %1$s = victim, %2$s = killer/attacker, %3$s = the attacker's named item.
 */

export const DEATH_MESSAGES: Record<string, string> = {
  'death.attack.anvil': '%1$s was squashed by a falling anvil',
  'death.attack.anvil.player': '%1$s was squashed by a falling anvil whilst fighting %2$s',
  'death.attack.arrow': '%1$s was shot by %2$s',
  'death.attack.arrow.item': '%1$s was shot by %2$s using %3$s',
  'death.attack.badRespawnPoint.link': 'Intentional Game Design',
  'death.attack.badRespawnPoint.message': '%1$s was killed by %2$s',
  'death.attack.cactus': '%1$s was pricked to death',
  'death.attack.cactus.player': '%1$s walked into a cactus whilst trying to escape %2$s',
  'death.attack.cramming': '%1$s was squished too much',
  'death.attack.cramming.player': '%1$s was squashed by %2$s',
  'death.attack.dragonBreath': '%1$s was roasted in dragon breath',
  'death.attack.dragonBreath.player': '%1$s was roasted in dragon breath by %2$s',
  'death.attack.drown': '%1$s drowned',
  'death.attack.drown.player': '%1$s drowned whilst trying to escape %2$s',
  'death.attack.dryout': '%1$s died from dehydration',
  'death.attack.dryout.player': '%1$s died from dehydration whilst trying to escape %2$s',
  'death.attack.even_more_magic': '%1$s was killed by even more magic',
  'death.attack.explosion': '%1$s blew up',
  'death.attack.explosion.player': '%1$s was blown up by %2$s',
  'death.attack.explosion.player.item': '%1$s was blown up by %2$s using %3$s',
  'death.attack.fall': '%1$s hit the ground too hard',
  'death.attack.fall.player': '%1$s hit the ground too hard whilst trying to escape %2$s',
  'death.attack.fallingBlock': '%1$s was squashed by a falling block',
  'death.attack.fallingBlock.player': '%1$s was squashed by a falling block whilst fighting %2$s',
  'death.attack.fallingStalactite': '%1$s was skewered by a falling stalactite',
  'death.attack.fallingStalactite.player': '%1$s was skewered by a falling stalactite whilst fighting %2$s',
  'death.attack.fireball': '%1$s was fireballed by %2$s',
  'death.attack.fireball.item': '%1$s was fireballed by %2$s using %3$s',
  'death.attack.fireworks': '%1$s went off with a bang',
  'death.attack.fireworks.item': '%1$s went off with a bang due to a firework fired from %3$s by %2$s',
  'death.attack.fireworks.player': '%1$s went off with a bang whilst fighting %2$s',
  'death.attack.flyIntoWall': '%1$s experienced kinetic energy',
  'death.attack.flyIntoWall.player': '%1$s experienced kinetic energy whilst trying to escape %2$s',
  'death.attack.freeze': '%1$s froze to death',
  'death.attack.freeze.player': '%1$s was frozen to death by %2$s',
  'death.attack.generic': '%1$s died',
  'death.attack.generic.player': '%1$s died because of %2$s',
  'death.attack.hotFloor': '%1$s discovered the floor was lava',
  'death.attack.hotFloor.player': '%1$s walked into danger zone due to %2$s',
  'death.attack.inFire': '%1$s went up in flames',
  'death.attack.inFire.player': '%1$s walked into fire whilst fighting %2$s',
  'death.attack.inWall': '%1$s suffocated in a wall',
  'death.attack.inWall.player': '%1$s suffocated in a wall whilst fighting %2$s',
  'death.attack.indirectMagic': '%1$s was killed by %2$s using magic',
  'death.attack.indirectMagic.item': '%1$s was killed by %2$s using %3$s',
  'death.attack.lava': '%1$s tried to swim in lava',
  'death.attack.lava.player': '%1$s tried to swim in lava to escape %2$s',
  'death.attack.lightningBolt': '%1$s was struck by lightning',
  'death.attack.lightningBolt.player': '%1$s was struck by lightning whilst fighting %2$s',
  'death.attack.magic': '%1$s was killed by magic',
  'death.attack.magic.player': '%1$s was killed by magic whilst trying to escape %2$s',
  'death.attack.message_too_long': "Actually, message was too long to deliver fully. Sorry! Here's stripped version: %s",
  'death.attack.mob': '%1$s was slain by %2$s',
  'death.attack.mob.item': '%1$s was slain by %2$s using %3$s',
  'death.attack.onFire': '%1$s burned to death',
  'death.attack.onFire.player': '%1$s was burnt to a crisp whilst fighting %2$s',
  'death.attack.outOfWorld': '%1$s fell out of the world',
  'death.attack.outOfWorld.player': "%1$s didn't want to live in the same world as %2$s",
  'death.attack.player': '%1$s was slain by %2$s',
  'death.attack.player.item': '%1$s was slain by %2$s using %3$s',
  'death.attack.stalagmite': '%1$s was impaled on a stalagmite',
  'death.attack.stalagmite.player': '%1$s was impaled on a stalagmite whilst fighting %2$s',
  'death.attack.starve': '%1$s starved to death',
  'death.attack.starve.player': '%1$s starved to death whilst fighting %2$s',
  'death.attack.sting': '%1$s was stung to death',
  'death.attack.sting.player': '%1$s was stung to death by %2$s',
  'death.attack.sweetBerryBush': '%1$s was poked to death by a sweet berry bush',
  'death.attack.sweetBerryBush.player': '%1$s was poked to death by a sweet berry bush whilst trying to escape %2$s',
  'death.attack.thorns': '%1$s was killed trying to hurt %2$s',
  'death.attack.thorns.item': '%1$s was killed by %3$s trying to hurt %2$s',
  'death.attack.thrown': '%1$s was pummeled by %2$s',
  'death.attack.thrown.item': '%1$s was pummeled by %2$s using %3$s',
  'death.attack.trident': '%1$s was impaled by %2$s',
  'death.attack.trident.item': '%1$s was impaled by %2$s with %3$s',
  'death.attack.wither': '%1$s withered away',
  'death.attack.wither.player': '%1$s withered away whilst fighting %2$s',
  'death.attack.witherSkull': '%1$s was shot by a skull from %2$s',
  'death.fell.accident.generic': '%1$s fell from a high place',
  'death.fell.accident.ladder': '%1$s fell off a ladder',
  'death.fell.accident.other_climbable': '%1$s fell while climbing',
  'death.fell.accident.scaffolding': '%1$s fell off scaffolding',
  'death.fell.accident.twisting_vines': '%1$s fell off some twisting vines',
  'death.fell.accident.vines': '%1$s fell off some vines',
  'death.fell.accident.water': '%1$s fell out of the water',
  'death.fell.accident.weeping_vines': '%1$s fell off some weeping vines',
  'death.fell.assist': '%1$s was doomed to fall by %2$s',
  'death.fell.assist.item': '%1$s was doomed to fall by %2$s using %3$s',
  'death.fell.finish': '%1$s fell too far and was finished by %2$s',
  'death.fell.finish.item': '%1$s fell too far and was finished by %2$s using %3$s',
  'death.fell.killer': '%1$s was doomed to fall',
};

/** The bed/respawn-anchor explosion's clickable "killer" text. */
export const INTENTIONAL_GAME_DESIGN = `[${DEATH_MESSAGES['death.attack.badRespawnPoint.link']}]`;

/** Translate a death message key (a missing key shows the key itself, like vanilla). */
export function translateDeath(key: string, ...args: string[]): string {
  const fmt = DEATH_MESSAGES[key] ?? key;
  return fmt.replace(/%(\d)\$s/g, (_m, i: string) => args[Number(i) - 1] ?? '');
}

/** An entity behind a damage source (vanilla DamageSource.getEntity). */
export interface CombatEntity {
  name: string;
  player: boolean;
  /** custom name of the item in its main hand, if renamed (the ".item" messages) */
  namedItem?: string;
}

export interface CombatSource {
  /** vanilla msgId (fall, player, mob, inFire, ...) */
  id: string;
  /** EntityDamageSource / IndirectEntityDamageSource: the (owning) attacker */
  entity?: CombatEntity;
  /** the thorns flavour of an entity source */
  thorns?: boolean;
}

export interface CombatEntry {
  source: CombatSource;
  time: number;
  health: number;
  damage: number;
  /** climbing location when hit ("ladder", "vines", "water", ...) or null */
  location: string | null;
  fallDistance: number;
}

const isFallish = (s: CombatSource) => s.id === 'fall' || s.id === 'outOfWorld';

export class CombatTracker {
  readonly entries: CombatEntry[] = [];
  private lastDamageTime = 0;
  private inCombat = false;
  private takingDamage = false;

  /** CombatTracker.recordDamage (after recheckStatus and prepareForDamage). */
  recordDamage(source: CombatSource, health: number, damage: number, time: number, location: string | null, fallDistance: number, alive: boolean): void {
    this.recheckStatus(time, alive);
    this.entries.push({ source, time, health, damage, location, fallDistance });
    this.lastDamageTime = time;
    this.takingDamage = true;
    if (source.entity && !this.inCombat && alive) this.inCombat = true;
  }

  /** CombatTracker.recheckStatus: forget everything 5 s (15 s in combat) after the last hit. */
  recheckStatus(time: number, alive: boolean): void {
    const timeout = this.inCombat ? 300 : 100;
    if (this.takingDamage && (!alive || time - this.lastDamageTime > timeout)) {
      this.takingDamage = false;
      this.inCombat = false;
      this.entries.length = 0;
    }
  }

  /** CombatTracker.getKiller: the player with the most damage unless a mob did over 3× as much. */
  getKiller(): CombatEntity | null {
    let living: CombatEntity | null = null, player: CombatEntity | null = null;
    let f = 0, f1 = 0;
    for (const e of this.entries) {
      const ent = e.source.entity;
      if (!ent) continue;
      if (ent.player && (!player || e.damage > f1)) {
        f1 = e.damage;
        player = ent;
      }
      if (!living || e.damage > f) {
        f = e.damage;
        living = ent;
      }
    }
    return player && f1 >= f / 3 ? player : living;
  }

  private mostSignificantFall(): CombatEntry | null {
    let fall: CombatEntry | null = null, located: CombatEntry | null = null;
    let f = 0, f1 = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (isFallish(e.source) && e.fallDistance > 0 && (!fall || e.fallDistance > f1)) {
        fall = i > 0 ? this.entries[i - 1]! : e;
        f1 = e.fallDistance;
      }
      if (e.location !== null && (!located || e.damage > f)) {
        located = e;
        f = e.damage;
      }
    }
    if (f1 > 5 && fall) return fall;
    return f > 5 && located ? located : null;
  }

  /**
   * CombatTracker.getDeathMessage. `credit` is LivingEntity.getKillCredit's fallback when the
   * tracker has no killer (the last player or mob to hurt the victim within 5 s).
   */
  getDeathMessage(victim: string, credit: CombatEntity | null = null): string {
    if (!this.entries.length) return translateDeath('death.attack.generic', victim);
    const sig = this.mostSignificantFall();
    const last = this.entries[this.entries.length - 1]!;
    const lastAttacker = last.source.entity?.name ?? null;
    if (sig && last.source.id === 'fall') {
      const sigAttacker = sig.source.entity?.name ?? null;
      if (!isFallish(sig.source)) {
        if (sigAttacker !== null && sigAttacker !== lastAttacker) {
          const item = sig.source.entity!.namedItem;
          return item ? translateDeath('death.fell.assist.item', victim, sigAttacker, item) : translateDeath('death.fell.assist', victim, sigAttacker);
        }
        if (lastAttacker !== null) {
          const item = last.source.entity!.namedItem;
          return item ? translateDeath('death.fell.finish.item', victim, lastAttacker, item) : translateDeath('death.fell.finish', victim, lastAttacker);
        }
        return translateDeath('death.fell.killer', victim);
      }
      return translateDeath(`death.fell.accident.${sig.location ?? 'generic'}`, victim);
    }
    return this.localized(last.source, victim, this.getKiller() ?? credit);
  }

  /** DamageSource / EntityDamageSource / IndirectEntityDamageSource.getLocalizedDeathMessage. */
  private localized(src: CombatSource, victim: string, killer: CombatEntity | null): string {
    const key = `death.attack.${src.id}`;
    if (src.id === 'badRespawnPoint') return translateDeath('death.attack.badRespawnPoint.message', victim, INTENTIONAL_GAME_DESIGN);
    if (src.entity) {
      const item = src.entity.namedItem;
      if (src.thorns) return item ? translateDeath('death.attack.thorns.item', victim, src.entity.name, item) : translateDeath('death.attack.thorns', victim, src.entity.name);
      return item ? translateDeath(`${key}.item`, victim, src.entity.name, item) : translateDeath(key, victim, src.entity.name);
    }
    return killer ? translateDeath(`${key}.player`, victim, killer.name) : translateDeath(key, victim);
  }
}

/**
 * CombatTracker.prepareForDamage: the climbable block the victim was last on (ladders and
 * trapdoors count as "ladder"), else "water" if it is in water.
 */
export function fallLocation(lastClimbable: string | null, inWater: boolean): string | null {
  if (lastClimbable) {
    if (lastClimbable === 'ladder' || lastClimbable.endsWith('_trapdoor')) return 'ladder';
    if (lastClimbable === 'vine') return 'vines';
    if (lastClimbable === 'weeping_vines' || lastClimbable === 'weeping_vines_plant') return 'weeping_vines';
    if (lastClimbable === 'twisting_vines' || lastClimbable === 'twisting_vines_plant') return 'twisting_vines';
    if (lastClimbable === 'scaffolding') return 'scaffolding';
    return 'other_climbable';
  }
  return inWater ? 'water' : null;
}
