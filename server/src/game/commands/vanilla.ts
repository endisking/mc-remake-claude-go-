/**
 * The 1.17.1 commands (syntax, permission levels and feedback text as in vanilla en_us).
 */
import { CommandDispatcher, literal, argument, type CommandContext, type CommandNode } from './dispatcher';
import { CommandSyntaxError, StringReader } from './reader';
import { CommandSource, CommandError, isPlayer, nameOf, eyeHeightOf, typeOf, type Target, type TextComponent } from './source';
import {
  integer, float, bool, word, greedyString, vec3, blockPos, rotation, entityArg, gameProfile, itemArg, itemPredicateArg,
  blockStateArg, blockPredicateArg, effectArg, enchantmentArg, summonableArg, timeArg, messageArg, resolveMessage,
  getEntities, getEntity, getPlayers, getPlayer, loadedBlockPos, spawnableBlockPos, type Coordinates, type ItemInput, type BlockInput,
} from './arguments';
import type { EntitySelector } from './selector';
import { GAME_RULE_NAMES, isIntRule, type GameRuleName } from './gamerules';
import { commandHooks, STRUCTURE_NAMES, structureDisplay } from './hooks';
import { IP_PATTERN } from './access';
import type { ServerPlayer } from '../player';
import { ItemEntity, ExperienceOrb } from '../entity';
import { DAMAGE } from '../survival';
import { maxStackSize } from '@shared/item/stack';
import { ENTITIES_BY_NAME, BLOCKS_BY_NAME, ITEMS_BY_NAME, ITEMS_BY_ID } from '@shared/data';
import { xpNeededForNextLevel } from '@shared/game/experience';
import { blockDrops } from '@shared/game/loot';
import { soundId, sourceId } from '@shared/sound/events';

type S = CommandSource;
type Ctx = CommandContext<S>;

const MODE_NAMES = ['Survival Mode', 'Creative Mode', 'Adventure Mode', 'Spectator Mode'];
const MODE_IDS = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const DIFFICULTY_NAMES = ['Peaceful', 'Easy', 'Normal', 'Hard'];

const lvl = (n: number) => (s: S) => s.hasPermission(n);
const dedicated = (n: number) => (s: S) => s.server.opts.dedicated === true && s.hasPermission(n);

/** Java's Double.toString for the values commands print (1.0, 10.5, -3.25). */
export function jd(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return v.toFixed(1);
  return String(v);
}
/** Java's Float.toString (rounded to float precision). */
function jf(v: number): string {
  const f = Math.fround(v);
  if (Number.isInteger(f) && Math.abs(f) < 1e7) return f.toFixed(1);
  return String(parseFloat(f.toPrecision(7)));
}

/** ItemStack.getDisplayName: "[Name]" */
function itemDisplay(id: number, count = 1): TextComponent {
  const d = ITEMS_BY_ID[id]?.displayName ?? 'Air';
  return { text: `[${d}]`, hoverEvent: { action: 'show_item', contents: JSON.stringify({ id: `minecraft:${ITEMS_BY_ID[id]?.name ?? 'air'}`, count }) } };
}

function msg(...parts: (string | TextComponent)[]): TextComponent {
  return { text: '', extra: parts };
}

function coord(v: number): string {
  return String(v);
}

/** Teleport a target (vanilla TeleportCommand.performTeleport). */
function teleport(src: S, t: Target, x: number, y: number, z: number, yaw: number | null, pitch: number | null): void {
  if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || y < -20000000 || y > 20000000) throw new CommandError('Invalid position for teleport');
  const s = src.server;
  if (isPlayer(t)) {
    if (t.sleepingPos) s.sleep.wake(t, true);
    if (t.camera) s.setCamera(t, null);
    t.x = x;
    t.y = y;
    t.z = z;
    if (yaw !== null) t.yaw = ((yaw % 360) + 540) % 360 - 180;
    if (pitch !== null) t.pitch = Math.max(-90, Math.min(90, ((pitch % 360) + 540) % 360 - 180));
    t.fallDistance = 0;
    t.prevTickX = x;
    t.prevTickZ = z;
    s.send(t, { t: 'teleport', x, y, z, yaw: t.yaw, pitch: t.pitch });
  } else {
    t.x = x;
    t.y = y;
    t.z = z;
    if (yaw !== null) t.yaw = yaw;
    if (pitch !== null) t.pitch = pitch;
    t.fallDistance = 0;
    t.onGround = false;
  }
}

/** Entity.lookAt (eyes toward a point): [yaw, pitch]. */
function lookAt(t: Target, x: number, y: number, z: number): [number, number] {
  const dx = x - t.x, dy = y - (t.y + eyeHeightOf(t)), dz = z - t.z;
  const h = Math.sqrt(dx * dx + dz * dz);
  const pitch = -(Math.atan2(dy, h) * 180) / Math.PI;
  const yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
  return [((yaw % 360) + 540) % 360 - 180, Math.max(-90, Math.min(90, pitch))];
}

function setXpPoints(p: ServerPlayer, points: number): void {
  const l = p.living;
  const f = xpNeededForNextLevel(l.experienceLevel);
  const g = (f - 1) / f;
  l.experienceProgress = Math.max(0, Math.min(g, points / f));
  l.totalExperience = Math.max(0, l.totalExperience);
}
function xpPoints(p: ServerPlayer): number {
  return Math.round(p.living.experienceProgress * xpNeededForNextLevel(p.living.experienceLevel));
}
function syncXp(s: S, p: ServerPlayer): void {
  p.living.lastSentExp = -1;
  s.server.send(p, { t: 'experience', progress: p.living.experienceProgress, level: p.living.experienceLevel, total: p.living.totalExperience });
  s.server.survival.sync(p);
}

export function registerVanillaCommands(d: CommandDispatcher<S>): void {
  // ---------------------------------------------------------------- /gamemode, /defaultgamemode
  const gm = literal<S>('gamemode').requires(lvl(2));
  MODE_IDS.forEach((id, mode) => {
    gm.then(
      literal<S>(id)
        .executes((c) => setMode(c, [c.source.entityOrThrow()], mode))
        .then(argument<S, EntitySelector>('target', entityArg(false, true)).executes((c) => setMode(c, getPlayers(c.get('target'), c.source), mode))),
    );
  });
  d.register(gm);
  function setMode(c: Ctx, targets: Target[], mode: number): number {
    let n = 0;
    for (const t of targets) {
      if (!isPlayer(t) || t.gameMode === mode) continue;
      c.source.server.setGameMode(t, mode);
      n++;
      const name = MODE_NAMES[mode]!;
      if (c.source.entity === t) c.source.sendSuccess(`Set own game mode to ${name}`, true);
      else {
        if (c.source.server.gameRules.sendCommandFeedback) c.source.server.send(t, { t: 'chat', json: JSON.stringify({ text: `Your game mode has been updated to ${name}` }) });
        c.source.sendSuccess(`Set ${t.name}'s game mode to ${name}`, true);
      }
    }
    return n;
  }
  const dgm = literal<S>('defaultgamemode').requires(lvl(2));
  MODE_IDS.forEach((id, mode) => dgm.then(literal<S>(id).executes((c) => {
    c.source.server.opts.defaultGameMode = mode;
    c.source.sendSuccess(`The default game mode is now ${MODE_NAMES[mode]}`, true);
    return 0;
  })));
  d.register(dgm);

  // ---------------------------------------------------------------- /teleport, /tp
  const tpToEntities = (c: Ctx, targets: Target[], dest: Target): number => {
    for (const t of targets) teleport(c.source, t, dest.x, dest.y, dest.z, dest.yaw, dest.pitch);
    if (targets.length === 1) c.source.sendSuccess(`Teleported ${nameOf(targets[0]!)} to ${nameOf(dest)}`, true);
    else c.source.sendSuccess(`Teleported ${targets.length} entities to ${nameOf(dest)}`, true);
    return targets.length;
  };
  const tpToPos = (c: Ctx, targets: Target[], pos: Coordinates, rot: Coordinates | null, facing: ((t: Target) => [number, number, number]) | null): number => {
    const [x, y, z] = pos.position(c.source);
    for (const t of targets) {
      let yaw: number | null = null, pitch: number | null = null;
      if (rot) {
        // RotationArgument relative to the target's own rotation
        const ts = new CommandSource(c.source.server, c.source.output, t.x, t.y, t.z, t.yaw, t.pitch, c.source.level, c.source.textName, t);
        [yaw, pitch] = rot.rotation(ts);
      }
      teleport(c.source, t, x, y, z, yaw, pitch);
      if (facing) {
        const [fx, fy, fz] = facing(t);
        const [fyaw, fpitch] = lookAt(t, fx, fy, fz);
        teleport(c.source, t, t.x, t.y, t.z, fyaw, fpitch);
      }
    }
    if (targets.length === 1) c.source.sendSuccess(`Teleported ${nameOf(targets[0]!)} to ${jd(x)}, ${jd(y)}, ${jd(z)}`, true);
    else c.source.sendSuccess(`Teleported ${targets.length} entities to ${jd(x)}, ${jd(y)}, ${jd(z)}`, true);
    return targets.length;
  };
  const facingEntity = (c: Ctx, anchor: 'feet' | 'eyes') => {
    const e = getEntity(c.get('facingEntity'), c.source);
    return (): [number, number, number] => [e.x, anchor === 'eyes' ? e.y + eyeHeightOf(e) : e.y, e.z];
  };
  const tp = literal<S>('teleport')
    .requires(lvl(2))
    .then(argument<S, Coordinates>('location', vec3()).executes((c) => tpToPos(c, [c.source.entityOrThrow()], c.get('location'), null, null)))
    .then(argument<S, EntitySelector>('destination', entityArg(true, false)).executes((c) => tpToEntities(c, [c.source.entityOrThrow()], getEntity(c.get('destination'), c.source))))
    .then(
      argument<S, EntitySelector>('targets', entityArg(false, false))
        .then(
          argument<S, Coordinates>('location', vec3())
            .executes((c) => tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), null, null))
            .then(argument<S, Coordinates>('rotation', rotation()).executes((c) => tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), c.get('rotation'), null)))
            .then(
              literal<S>('facing')
                .then(
                  literal<S>('entity').then(
                    argument<S, EntitySelector>('facingEntity', entityArg(true, false))
                      .executes((c) => tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), null, facingEntity(c, 'feet')))
                      .then(literal<S>('eyes').executes((c) => tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), null, facingEntity(c, 'eyes'))))
                      .then(literal<S>('feet').executes((c) => tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), null, facingEntity(c, 'feet')))),
                  ),
                )
                .then(argument<S, Coordinates>('facingLocation', vec3()).executes((c) => {
                  const f = c.get<Coordinates>('facingLocation').position(c.source);
                  return tpToPos(c, getEntities(c.get('targets'), c.source), c.get('location'), null, () => f);
                })),
            ),
        )
        .then(argument<S, EntitySelector>('destination', entityArg(true, false)).executes((c) => tpToEntities(c, getEntities(c.get('targets'), c.source), getEntity(c.get('destination'), c.source)))),
    );
  const tpNode = d.register(tp);
  d.alias('tp', tpNode);

  // ---------------------------------------------------------------- /give
  d.register(
    literal<S>('give').requires(lvl(2)).then(
      argument<S, EntitySelector>('targets', entityArg(false, true)).then(
        argument<S, ItemInput>('item', itemArg())
          .executes((c) => give(c, 1))
          .then(argument<S, number>('count', integer(1)).executes((c) => give(c, c.get('count')))),
      ),
    ),
  );
  function give(c: Ctx, count: number): number {
    const item = c.get<ItemInput>('item').item;
    const targets = getPlayers(c.get('targets'), c.source);
    const max = maxStackSize(item.id);
    if (count > max * 100) throw new CommandError(`Can't give more than ${max * 100} of ${itemDisplay(item.id).text}`);
    const s = c.source.server;
    for (const t of targets) {
      let left = count;
      while (left > 0) {
        const n = Math.min(left, max);
        left -= n;
        const rest = t.inventory.add({ id: item.id, count: n, damage: 0 });
        if (rest > 0) {
          // GiveCommand: what doesn't fit drops at the player's feet, immediately collectable
          const e = new ItemEntity(s.nextEntityId++, { id: item.id, count: rest, damage: 0 });
          e.x = t.x;
          e.y = t.y;
          e.z = t.z;
          e.pickupDelay = 0;
          s.spawnEntity(e);
        } else {
          const r = s.rand;
          s.send(t, { t: 'sound', event: soundId('entity.item.pickup'), category: sourceId('player'), x: t.x, y: t.y, z: t.z, volume: 0.2, pitch: ((r.nextFloat() - r.nextFloat()) * 0.7 + 1) * 2 });
        }
      }
      for (let i = 0; i < 41; i++) s.syncSlot(t, i);
    }
    const disp = itemDisplay(item.id, count);
    if (targets.length === 1) c.source.sendSuccess(msg(`Gave ${count} `, disp, ` to ${targets[0]!.name}`), true);
    else c.source.sendSuccess(msg(`Gave ${count} `, disp, ` to ${targets.length} players`), true);
    return targets.length;
  }

  // ---------------------------------------------------------------- /clear
  d.register(
    literal<S>('clear')
      .requires(lvl(2))
      .executes((c) => clear(c, [c.source.playerOrThrow()], () => true, -1))
      .then(
        argument<S, EntitySelector>('targets', entityArg(false, true))
          .executes((c) => clear(c, getPlayers(c.get('targets'), c.source), () => true, -1))
          .then(
            argument<S, (id: number) => boolean>('item', itemPredicateArg())
              .executes((c) => clear(c, getPlayers(c.get('targets'), c.source), c.get('item'), -1))
              .then(argument<S, number>('maxCount', integer(0)).executes((c) => clear(c, getPlayers(c.get('targets'), c.source), c.get('item'), c.get('maxCount')))),
          ),
      ),
  );
  function clear(c: Ctx, targets: ServerPlayer[], pred: (id: number) => boolean, maxCount: number): number {
    let total = 0;
    for (const t of targets) {
      // Inventory.clearOrCountMatchingItems
      let n = 0;
      for (let i = 0; i < 41; i++) {
        const st = t.inventory.get(i);
        if (!st || !pred(st.id)) continue;
        if (maxCount === 0) {
          n += st.count;
          continue;
        }
        const take = maxCount < 0 ? st.count : Math.min(maxCount - n, st.count);
        if (take <= 0) break;
        n += take;
        st.count -= take;
        if (st.count <= 0) t.inventory.set(i, null);
        c.source.server.syncSlot(t, i);
      }
      total += n;
    }
    if (total === 0) {
      if (targets.length === 1) throw new CommandError(`No items were found on player ${targets[0]!.name}`);
      throw new CommandError(`No items were found on ${targets.length} players`);
    }
    if (maxCount === 0) {
      if (targets.length === 1) c.source.sendSuccess(`Found ${total} matching items on player ${targets[0]!.name}`, true);
      else c.source.sendSuccess(`Found ${total} matching items on ${targets.length} players`, true);
    } else if (targets.length === 1) c.source.sendSuccess(`Removed ${total} items from player ${targets[0]!.name}`, true);
    else c.source.sendSuccess(`Removed ${total} items from ${targets.length} players`, true);
    return total;
  }

  // ---------------------------------------------------------------- /time
  const setTime = (c: Ctx, t: number): number => {
    c.source.server.setDayTime(t);
    c.source.sendSuccess(`Set the time to ${t}`, true);
    return Math.floor(c.source.server.dayTime % 24000);
  };
  const timeQuery = (c: Ctx, v: number): number => {
    c.source.sendSuccess(`The time is ${v}`, false);
    return v;
  };
  d.register(
    literal<S>('time')
      .requires(lvl(2))
      .then(
        literal<S>('set')
          .then(literal<S>('day').executes((c) => setTime(c, 1000)))
          .then(literal<S>('noon').executes((c) => setTime(c, 6000)))
          .then(literal<S>('night').executes((c) => setTime(c, 13000)))
          .then(literal<S>('midnight').executes((c) => setTime(c, 18000)))
          .then(argument<S, number>('time', timeArg()).executes((c) => setTime(c, c.get('time')))),
      )
      .then(literal<S>('add').then(argument<S, number>('time', timeArg()).executes((c) => {
        const s = c.source.server;
        s.setDayTime(s.dayTime + c.get<number>('time'));
        const now = Math.floor(s.dayTime % 24000);
        c.source.sendSuccess(`Set the time to ${now}`, true);
        return now;
      })))
      .then(
        literal<S>('query')
          .then(literal<S>('daytime').executes((c) => timeQuery(c, Math.floor(c.source.server.dayTime % 24000))))
          .then(literal<S>('gametime').executes((c) => timeQuery(c, Math.floor(c.source.server.gameTime % 2147483647))))
          .then(literal<S>('day').executes((c) => timeQuery(c, Math.floor(c.source.server.dayTime / 24000) % 2147483647))),
      ),
  );

  // ---------------------------------------------------------------- /weather
  const weather = literal<S>('weather').requires(lvl(2));
  for (const [kind, text] of [['clear', 'Set the weather to clear'], ['rain', 'Set the weather to rain'], ['thunder', 'Set the weather to rain & thunder']] as const) {
    const run = (c: Ctx, ticks: number) => {
      c.source.server.setWeather(kind, ticks);
      c.source.sendSuccess(text, true);
      return ticks;
    };
    weather.then(literal<S>(kind).executes((c) => run(c, 6000)).then(argument<S, number>('duration', integer(0, 1000000)).executes((c) => run(c, c.get<number>('duration') * 20))));
  }
  d.register(weather);

  // ---------------------------------------------------------------- /gamerule
  const gr = literal<S>('gamerule').requires(lvl(2));
  for (const name of GAME_RULE_NAMES) {
    const query = (c: Ctx) => {
      const v = c.source.server.gameRules[name];
      c.source.sendSuccess(`Gamerule ${name} is currently set to: ${v}`, false);
      return typeof v === 'number' ? v : v ? 1 : 0;
    };
    const set = (c: Ctx) => {
      const v = c.get<number | boolean>('value');
      setGameRule(c.source, name, v);
      c.source.sendSuccess(`Gamerule ${name} is now set to: ${v}`, true);
      return typeof v === 'number' ? v : v ? 1 : 0;
    };
    gr.then(literal<S>(name).executes(query).then(argument<S, number | boolean>('value', isIntRule(name) ? integer() : bool()).executes(set)));
  }
  d.register(gr);

  // ---------------------------------------------------------------- /difficulty
  const diff = literal<S>('difficulty').requires(lvl(2)).executes((c) => {
    const v = c.source.server.difficulty;
    c.source.sendSuccess(`The difficulty is ${DIFFICULTY_NAMES[v]}`, false);
    return v;
  });
  DIFFICULTIES.forEach((id, v) => diff.then(literal<S>(id).executes((c) => {
    const s = c.source.server;
    if (s.difficulty === v) throw new CommandError(`The difficulty did not change; it is already set to ${DIFFICULTY_NAMES[v]}`);
    s.difficulty = v as typeof s.difficulty;
    for (const o of s.players) s.send(o, { t: 'difficulty', difficulty: v });
    c.source.sendSuccess(`The difficulty has been set to ${DIFFICULTY_NAMES[v]}`, true);
    return 0;
  })));
  d.register(diff);

  // ---------------------------------------------------------------- /seed
  d.register(literal<S>('seed').requires((s) => !s.server.opts.dedicated || s.hasPermission(2)).executes((c) => {
    const seed = BigInt.asIntN(64, c.source.server.opts.seed).toString();
    c.source.sendSuccess(msg('Seed: ', { text: '[', color: 'green', extra: [{ text: seed, color: 'green', clickEvent: { action: 'copy_to_clipboard', value: seed }, hoverEvent: { action: 'show_text', contents: 'Click to Copy to Clipboard' } }, ']'] }), false);
    return Number(BigInt.asIntN(32, c.source.server.opts.seed));
  }));

  // ---------------------------------------------------------------- /kill
  const kill = (c: Ctx, targets: Target[]): number => {
    for (const t of targets) {
      if (isPlayer(t)) c.source.server.survival.hurt(t, { ...DAMAGE.outOfWorld, bypassInvul: true } as typeof DAMAGE.outOfWorld, 3.4028235e38);
      else t.removed = true;
    }
    if (targets.length === 1) c.source.sendSuccess(`Killed ${nameOf(targets[0]!)}`, true);
    else c.source.sendSuccess(`Killed ${targets.length} entities`, true);
    return targets.length;
  };
  d.register(
    literal<S>('kill')
      .requires(lvl(2))
      .executes((c) => kill(c, [c.source.entityOrThrow()]))
      .then(argument<S, EntitySelector>('targets', entityArg(false, false)).executes((c) => kill(c, getEntities(c.get('targets'), c.source)))),
  );

  // ---------------------------------------------------------------- /effect
  type Eff = { name: string; id: number; displayName: string };
  const giveEffect = (c: Ctx, seconds: number | null, amp: number, hide: boolean): number => {
    const eff = c.get<Eff>('effect');
    const targets = getEntities(c.get('targets'), c.source);
    const instant = eff.name === 'instant_health' || eff.name === 'instant_damage' || eff.name === 'saturation';
    const ticks = seconds !== null ? (instant ? seconds : seconds * 20) : instant ? 1 : 600;
    let n = 0;
    for (const t of targets) if (commandHooks.applyEffect?.(t, eff.name, ticks, amp, !hide)) n++;
    if (n === 0) throw new CommandError('Unable to apply this effect (target is either immune to effects, or has something stronger)');
    if (targets.length === 1) c.source.sendSuccess(`Applied effect ${eff.displayName} to ${nameOf(targets[0]!)}`, true);
    else c.source.sendSuccess(`Applied effect ${eff.displayName} to ${targets.length} targets`, true);
    return n;
  };
  const clearEffects = (c: Ctx, targets: Target[], eff: Eff | null): number => {
    let n = 0;
    for (const t of targets) if (commandHooks.removeEffect?.(t, eff ? eff.name : null)) n++;
    if (n === 0) throw new CommandError(eff ? "Target doesn't have the requested effect" : 'Target has no effects to remove');
    if (eff) {
      if (targets.length === 1) c.source.sendSuccess(`Removed effect ${eff.displayName} from ${nameOf(targets[0]!)}`, true);
      else c.source.sendSuccess(`Removed effect ${eff.displayName} from ${targets.length} targets`, true);
    } else if (targets.length === 1) c.source.sendSuccess(`Removed every effect from ${nameOf(targets[0]!)}`, true);
    else c.source.sendSuccess(`Removed every effect from ${targets.length} targets`, true);
    return n;
  };
  d.register(
    literal<S>('effect')
      .requires(lvl(2))
      .then(
        literal<S>('clear')
          .executes((c) => clearEffects(c, [c.source.entityOrThrow()], null))
          .then(
            argument<S, EntitySelector>('targets', entityArg(false, false))
              .executes((c) => clearEffects(c, getEntities(c.get('targets'), c.source), null))
              .then(argument<S, Eff>('effect', effectArg()).executes((c) => clearEffects(c, getEntities(c.get('targets'), c.source), c.get('effect')))),
          ),
      )
      .then(
        literal<S>('give').then(
          argument<S, EntitySelector>('targets', entityArg(false, false)).then(
            argument<S, Eff>('effect', effectArg())
              .executes((c) => giveEffect(c, null, 0, false))
              .then(
                argument<S, number>('seconds', integer(1, 1000000))
                  .executes((c) => giveEffect(c, c.get('seconds'), 0, false))
                  .then(
                    argument<S, number>('amplifier', integer(0, 255))
                      .executes((c) => giveEffect(c, c.get('seconds'), c.get('amplifier'), false))
                      .then(argument<S, boolean>('hideParticles', bool()).executes((c) => giveEffect(c, c.get('seconds'), c.get('amplifier'), c.get('hideParticles')))),
                  ),
              ),
          ),
        ),
      ),
  );

  // ---------------------------------------------------------------- /enchant
  type Ench = { name: string; displayName: string; maxLevel: number; category: string };
  const enchant = (c: Ctx, level: number): number => {
    const e = c.get<Ench>('enchantment');
    if (level > e.maxLevel) throw new CommandError(`${level} is higher than the maximum level of ${e.maxLevel} supported by that enchantment`);
    const targets = getEntities(c.get('targets'), c.source);
    let n = 0;
    const lv = level === 1 ? 'I' : ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][level] ?? `enchantment.level.${level}`;
    const label = `${e.displayName}${e.maxLevel === 1 && level === 1 ? '' : ` ${lv}`}`;
    for (const t of targets) {
      if (!isPlayer(t)) {
        if (targets.length === 1) throw new CommandError(`${nameOf(t)} is not a valid entity for this command`);
        continue;
      }
      const held = t.inventory.selectedStack;
      if (!held) {
        if (targets.length === 1) throw new CommandError(`${t.name} is not holding any item`);
        continue;
      }
      const cats = ITEMS_BY_ID[held.id]?.enchantCategories ?? [];
      if (!cats.includes(e.category) && ITEMS_BY_ID[held.id]?.name !== 'book') {
        if (targets.length === 1) throw new CommandError(`${ITEMS_BY_ID[held.id]?.displayName ?? 'Item'} cannot support that enchantment`);
        continue;
      }
      const r = commandHooks.enchant?.(t, e.name, level) ?? 'incompatible';
      if (r === 'ok') n++;
      else if (targets.length === 1 && r === 'incompatible') throw new CommandError(`${ITEMS_BY_ID[held.id]?.displayName ?? 'Item'} cannot support that enchantment`);
    }
    if (n === 0) throw new CommandError('Nothing changed. Targets either have no item in their hands or the enchantment could not be applied');
    if (targets.length === 1) c.source.sendSuccess(`Applied enchantment ${label} to ${nameOf(targets[0]!)}'s item`, true);
    else c.source.sendSuccess(`Applied enchantment ${label} to ${targets.length} entities`, true);
    return n;
  };
  d.register(
    literal<S>('enchant').requires(lvl(2)).then(
      argument<S, EntitySelector>('targets', entityArg(false, false)).then(
        argument<S, Ench>('enchantment', enchantmentArg())
          .executes((c) => enchant(c, 1))
          .then(argument<S, number>('level', integer(0)).executes((c) => enchant(c, c.get('level')))),
      ),
    ),
  );

  // ---------------------------------------------------------------- /summon
  const summon = (c: Ctx, pos: [number, number, number], nbt: string | null): number => {
    const type = c.get<string>('entity');
    const [x, y, z] = pos;
    if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || y < -20000000 || y > 20000000) throw new CommandError('Invalid position for summon');
    const s = c.source.server;
    let e: Target | null = null;
    const hook = commandHooks.summon.get(type);
    if (hook) {
      e = hook(s, x, y, z, nbt);
      if (e && !s.entities.has(e.id)) s.spawnEntity(e);
    } else if (type === 'lightning_bolt') {
      s.strikeLightning(x, y, z);
      e = [...s.entities.values()].pop() ?? null;
    } else if (type === 'item') {
      const st = nbtItem(nbt);
      if (st) {
        const it = new ItemEntity(s.nextEntityId++, st);
        it.x = x;
        it.y = y;
        it.z = z;
        s.spawnEntity(it);
        e = it;
      }
    } else if (type === 'experience_orb') {
      const v = /Value\s*:\s*(-?\d+)/.exec(nbt ?? '');
      const orb = new ExperienceOrb(s.nextEntityId++, v ? Math.max(0, Number(v[1])) : 0);
      orb.x = x;
      orb.y = y;
      orb.z = z;
      s.spawnEntity(orb);
      e = orb;
    }
    if (!e) throw new CommandError('Unable to summon entity');
    c.source.sendSuccess(`Summoned new ${nameOf(e)}`, true);
    return 1;
  };
  d.register(
    literal<S>('summon').requires(lvl(2)).then(
      argument<S, string>('entity', summonableArg())
        .executes((c) => summon(c, [c.source.x, c.source.y, c.source.z], null))
        .then(
          argument<S, Coordinates>('pos', vec3())
            .executes((c) => summon(c, c.get<Coordinates>('pos').position(c.source), null))
            .then(argument<S, string>('nbt', snbtArg()).executes((c) => summon(c, c.get<Coordinates>('pos').position(c.source), c.get('nbt')))),
        ),
    ),
  );

  // ---------------------------------------------------------------- /setblock
  const setblock = (c: Ctx, mode: 'replace' | 'keep' | 'destroy'): number => {
    const [x, y, z] = loadedBlockPos(c.get('pos'), c.source);
    const b = c.get<BlockInput>('block');
    const s = c.source.server;
    const old = s.world.getState(x, y, z);
    if (mode === 'keep' && !isAirState(old)) throw new CommandError('Could not set the block');
    if (mode === 'destroy') destroyWithDrops(s, x, y, z);
    if (s.world.getState(x, y, z) === b.state) throw new CommandError('Could not set the block');
    s.setBlock(x, y, z, b.state);
    s.updateNeighbors(x, y, z);
    c.source.sendSuccess(`Changed the block at ${x}, ${y}, ${z}`, true);
    return 1;
  };
  d.register(
    literal<S>('setblock').requires(lvl(2)).then(
      argument<S, Coordinates>('pos', blockPos()).then(
        argument<S, BlockInput>('block', blockStateArg())
          .executes((c) => setblock(c, 'replace'))
          .then(literal<S>('destroy').executes((c) => setblock(c, 'destroy')))
          .then(literal<S>('keep').executes((c) => setblock(c, 'keep')))
          .then(literal<S>('replace').executes((c) => setblock(c, 'replace'))),
      ),
    ),
  );

  // ---------------------------------------------------------------- /fill
  const fillRun = (c: Ctx, mode: FillMode, filter: BlockInput | null): number => {
    const a = c.get<Coordinates>('from').position(c.source).map(Math.floor) as Vec3i;
    const b = c.get<Coordinates>('to').position(c.source).map(Math.floor) as Vec3i;
    const n = fill(c.source.server, a, b, c.get<BlockInput>('block').state, mode, filter ? filter.test : null);
    c.source.sendSuccess(`Successfully filled ${n} blocks`, true);
    return n;
  };
  d.register(
    literal<S>('fill').requires(lvl(2)).then(
      argument<S, Coordinates>('from', blockPos()).then(
        argument<S, Coordinates>('to', blockPos()).then(
          argument<S, BlockInput>('block', blockStateArg())
            .executes((c) => fillRun(c, 'replace', null))
            .then(
              literal<S>('replace')
                .executes((c) => fillRun(c, 'replace', null))
                .then(argument<S, BlockInput>('filter', blockPredicateArg()).executes((c) => fillRun(c, 'replace', c.get('filter')))),
            )
            .then(literal<S>('keep').executes((c) => fillRun(c, 'keep', null)))
            .then(literal<S>('outline').executes((c) => fillRun(c, 'outline', null)))
            .then(literal<S>('hollow').executes((c) => fillRun(c, 'hollow', null)))
            .then(literal<S>('destroy').executes((c) => fillRun(c, 'destroy', null))),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- /clone
  const cloneRun = (c: Ctx, mask: 'replace' | 'masked' | 'filtered', flag: CloneFlag): number => {
    const a = c.get<Coordinates>('begin').position(c.source).map(Math.floor) as Vec3i;
    const b = c.get<Coordinates>('end').position(c.source).map(Math.floor) as Vec3i;
    const dst = c.get<Coordinates>('destination').position(c.source).map(Math.floor) as Vec3i;
    const filter = mask === 'filtered' ? c.get<BlockInput>('filter').test : mask === 'masked' ? (st: number) => !isAirState(st) : null;
    const n = clone(c.source.server, a, b, dst, filter, flag);
    c.source.sendSuccess(`Successfully cloned ${n} blocks`, true);
    return n;
  };
  const flags = (node: CommandNode<S>, mask: 'replace' | 'masked' | 'filtered') =>
    node
      .executes((c) => cloneRun(c, mask, 'normal'))
      .then(literal<S>('force').executes((c) => cloneRun(c, mask, 'force')))
      .then(literal<S>('move').executes((c) => cloneRun(c, mask, 'move')))
      .then(literal<S>('normal').executes((c) => cloneRun(c, mask, 'normal')));
  d.register(
    literal<S>('clone').requires(lvl(2)).then(
      argument<S, Coordinates>('begin', blockPos()).then(
        argument<S, Coordinates>('end', blockPos()).then(
          flags(argument<S, Coordinates>('destination', blockPos()), 'replace')
            .then(flags(literal<S>('replace'), 'replace'))
            .then(flags(literal<S>('masked'), 'masked'))
            .then(literal<S>('filtered').then(flags(argument<S, BlockInput>('filter', blockPredicateArg()), 'filtered'))),
        ),
      ),
    ),
  );

  // ---------------------------------------------------------------- /locate
  const locate = literal<S>('locate').requires(lvl(2));
  for (const name of STRUCTURE_NAMES) {
    locate.then(literal<S>(name).executes((c) => {
      const bx = Math.floor(c.source.x), bz = Math.floor(c.source.z);
      const r = commandHooks.locate.get(name)?.(c.source.server, bx, bz) ?? null;
      if (!r) throw new CommandError('Could not find that structure nearby');
      const dist = Math.floor(Math.hypot(r[0] - bx, r[1] - bz));
      c.source.sendSuccess(msg(`The nearest ${structureDisplay(name)} is at `, { text: `[${r[0]}, ~, ${r[1]}]`, color: 'green', clickEvent: { action: 'suggest_command', value: `/tp @s ${r[0]} ~ ${r[1]}` }, hoverEvent: { action: 'show_text', contents: 'Click to teleport' } }, ` (${dist} blocks away)`), false);
      return dist;
    }));
  }
  d.register(locate);

  // ---------------------------------------------------------------- /spawnpoint, /setworldspawn
  const spawnpoint = (c: Ctx, targets: ServerPlayer[], pos: Vec3i, angle: number): number => {
    for (const t of targets) t.respawn = { x: pos[0], y: pos[1], z: pos[2], angle };
    const where = `${pos[0]}, ${pos[1]}, ${pos[2]} [${jf(angle)}] in minecraft:overworld`;
    if (targets.length === 1) c.source.sendSuccess(`Set spawn point to ${where} for ${targets[0]!.name}`, true);
    else c.source.sendSuccess(`Set spawn point to ${where} for ${targets.length} players`, true);
    return targets.length;
  };
  const here = (c: Ctx): Vec3i => [Math.floor(c.source.x), Math.floor(c.source.y), Math.floor(c.source.z)];
  d.register(
    literal<S>('spawnpoint')
      .requires(lvl(2))
      .executes((c) => spawnpoint(c, [c.source.playerOrThrow()], here(c), 0))
      .then(
        argument<S, EntitySelector>('targets', entityArg(false, true))
          .executes((c) => spawnpoint(c, getPlayers(c.get('targets'), c.source), here(c), 0))
          .then(
            argument<S, Coordinates>('pos', blockPos())
              .executes((c) => spawnpoint(c, getPlayers(c.get('targets'), c.source), spawnableBlockPos(c.get('pos'), c.source), 0))
              .then(argument<S, Coordinates>('angle', angleArg()).executes((c) => spawnpoint(c, getPlayers(c.get('targets'), c.source), spawnableBlockPos(c.get('pos'), c.source), c.get<Coordinates>('angle').rotation(c.source)[0]))),
          ),
      ),
  );
  const worldspawn = (c: Ctx, pos: Vec3i, angle: number): number => {
    const s = c.source.server;
    s.worldSpawn = [pos[0], pos[1], pos[2]];
    s.worldSpawnSet = true;
    c.source.sendSuccess(`Set the world spawn point to ${pos[0]}, ${pos[1]}, ${pos[2]} [${jf(angle)}]`, true);
    return 1;
  };
  d.register(
    literal<S>('setworldspawn')
      .requires(lvl(2))
      .executes((c) => worldspawn(c, here(c), 0))
      .then(
        argument<S, Coordinates>('pos', blockPos())
          .executes((c) => worldspawn(c, loadedBlockPos(c.get('pos'), c.source), 0))
          .then(argument<S, Coordinates>('angle', angleArg()).executes((c) => worldspawn(c, loadedBlockPos(c.get('pos'), c.source), c.get<Coordinates>('angle').rotation(c.source)[0]))),
      ),
  );

  // ---------------------------------------------------------------- /experience, /xp
  const xpAdd = (c: Ctx, levels: boolean): number => {
    const targets = getPlayers(c.get('targets'), c.source);
    const amount = c.get<number>('amount');
    for (const t of targets) {
      c.source.server.survival.giveExperience(t, amount, levels);
      syncXp(c.source, t);
    }
    const what = levels ? 'levels' : 'points';
    if (targets.length === 1) c.source.sendSuccess(`Gave ${amount} experience ${what} to ${targets[0]!.name}`, true);
    else c.source.sendSuccess(`Gave ${amount} experience ${what} to ${targets.length} players`, true);
    return targets.length;
  };
  const xpSet = (c: Ctx, levels: boolean): number => {
    const targets = getPlayers(c.get('targets'), c.source);
    const amount = c.get<number>('amount');
    let n = 0;
    for (const t of targets) {
      if (levels) {
        t.living.experienceLevel = amount;
        n++;
      } else {
        if (amount >= xpNeededForNextLevel(t.living.experienceLevel)) continue;
        setXpPoints(t, amount);
        n++;
      }
      syncXp(c.source, t);
    }
    if (n === 0) throw new CommandError("Cannot set experience points above the maximum points for the player's current level");
    const what = levels ? 'levels' : 'points';
    if (targets.length === 1) c.source.sendSuccess(`Set ${amount} experience ${what} on ${targets[0]!.name}`, true);
    else c.source.sendSuccess(`Set ${amount} experience ${what} on ${targets.length} players`, true);
    return targets.length;
  };
  const xpQuery = (c: Ctx, levels: boolean): number => {
    const p = getPlayer(c.get('targets'), c.source);
    const v = levels ? p.living.experienceLevel : xpPoints(p);
    c.source.sendSuccess(`${p.name} has ${v} experience ${levels ? 'levels' : 'points'}`, false);
    return v;
  };
  const xp = d.register(
    literal<S>('experience')
      .requires(lvl(2))
      .then(
        literal<S>('add').then(
          argument<S, EntitySelector>('targets', entityArg(false, true)).then(
            argument<S, number>('amount', integer())
              .executes((c) => xpAdd(c, false))
              .then(literal<S>('points').executes((c) => xpAdd(c, false)))
              .then(literal<S>('levels').executes((c) => xpAdd(c, true))),
          ),
        ),
      )
      .then(
        literal<S>('set').then(
          argument<S, EntitySelector>('targets', entityArg(false, true)).then(
            argument<S, number>('amount', integer(0))
              .executes((c) => xpSet(c, false))
              .then(literal<S>('points').executes((c) => xpSet(c, false)))
              .then(literal<S>('levels').executes((c) => xpSet(c, true))),
          ),
        ),
      )
      .then(
        literal<S>('query').then(
          argument<S, EntitySelector>('targets', entityArg(true, true))
            .then(literal<S>('points').executes((c) => xpQuery(c, false)))
            .then(literal<S>('levels').executes((c) => xpQuery(c, true))),
        ),
      ),
  );
  d.alias('xp', xp);

  // ---------------------------------------------------------------- chat: /say, /msg, /me, /list
  d.register(literal<S>('say').requires(lvl(2)).then(argument<S, string>('message', messageArg()).executes((c) => {
    const text = resolveMessage(c.get('message'), c.source);
    c.source.server.commands.broadcast({ text: '', extra: [`[${c.source.textName}] `, text] });
    return 1;
  })));
  const msgNode = d.register(
    literal<S>('msg').then(
      argument<S, EntitySelector>('targets', entityArg(false, true)).then(
        argument<S, string>('message', messageArg()).executes((c) => {
          const targets = getPlayers(c.get('targets'), c.source);
          const text = resolveMessage(c.get('message'), c.source);
          for (const t of targets) {
            c.source.output.sendMessage({ text: `You whisper to ${t.name}: ${text}`, color: 'gray', italic: true });
            c.source.server.send(t, { t: 'chat', json: JSON.stringify({ text: `${c.source.textName} whispers to you: ${text}`, color: 'gray', italic: true }) });
          }
          return targets.length;
        }),
      ),
    ),
  );
  d.alias('tell', msgNode);
  d.alias('w', msgNode);
  d.register(literal<S>('me').then(argument<S, string>('action', greedyString()).executes((c) => {
    c.source.server.commands.broadcast({ text: `* ${c.source.textName} ${resolveMessage(c.get('action'), c.source)}` });
    return 1;
  })));
  const list = (c: Ctx, uuids: boolean): number => {
    const s = c.source.server;
    const names = s.players.map((p) => (uuids ? `${p.name} (${offlineId(p.name)})` : p.name)).join(', ');
    c.source.sendSuccess(`There are ${s.players.length} of a max of ${s.commands.maxPlayers} players online: ${names}`, false);
    return s.players.length;
  };
  d.register(literal<S>('list').executes((c) => list(c, false)).then(literal<S>('uuids').executes((c) => list(c, true))));

  // ---------------------------------------------------------------- moderation
  const kick = (c: Ctx, reason: string): number => {
    const targets = getPlayers(c.get('targets'), c.source);
    for (const t of targets) {
      c.source.server.commands.kick(t, reason);
      c.source.sendSuccess(`Kicked ${t.name}: ${reason}`, true);
    }
    return targets.length;
  };
  d.register(
    literal<S>('kick').requires(lvl(3)).then(
      argument<S, EntitySelector>('targets', entityArg(false, true))
        .executes((c) => kick(c, 'Kicked by an operator.'))
        .then(argument<S, string>('reason', messageArg()).executes((c) => kick(c, resolveMessage(c.get('reason'), c.source)))),
    ),
  );
  type Profile = { selector: EntitySelector | null; name: string | null };
  const profiles = (c: Ctx, name = 'targets'): string[] => {
    const p = c.get<Profile>(name);
    if (p.selector) {
      const l = p.selector.find(c.source).filter(isPlayer).map((t) => t.name);
      if (!l.length) throw new CommandError('That player does not exist');
      return l;
    }
    return [p.name!];
  };
  const ban = (c: Ctx, reason: string): number => {
    const access = c.source.server.commands.access;
    let n = 0;
    for (const name of profiles(c)) {
      if (!access.ban(name, c.source.textName, reason)) continue;
      n++;
      c.source.sendSuccess(`Banned ${name}: ${reason}`, true);
      const online = c.source.server.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (online) c.source.server.commands.kick(online, 'You are banned from this server.');
    }
    if (n === 0) throw new CommandError('Nothing changed. The player is already banned');
    return n;
  };
  d.register(
    literal<S>('ban').requires(dedicated(3)).then(
      argument<S, Profile>('targets', gameProfile())
        .executes((c) => ban(c, 'Banned by an operator.'))
        .then(argument<S, string>('reason', messageArg()).executes((c) => ban(c, resolveMessage(c.get('reason'), c.source)))),
    ),
  );
  const banIp = (c: Ctx, reason: string): number => {
    const target = c.get<string>('target');
    const s = c.source.server;
    let ip: string | undefined;
    if (IP_PATTERN.test(target)) ip = target;
    else ip = s.players.find((p) => p.name.toLowerCase() === target.toLowerCase())?.conn.address;
    if (!ip) throw new CommandError('Invalid IP address or unknown player');
    if (!s.commands.access.banIp(ip, c.source.textName, reason)) throw new CommandError('Nothing changed. That IP is already banned');
    const affected = s.players.filter((p) => p.conn.address === ip);
    c.source.sendSuccess(`Banned IP ${ip}: ${reason}`, true);
    if (affected.length) c.source.sendSuccess(`This ban affects ${affected.length} players: ${affected.map((p) => p.name).join(', ')}`, true);
    for (const p of affected) s.commands.kick(p, 'You have been IP banned.');
    return affected.length;
  };
  d.register(
    literal<S>('ban-ip').requires(dedicated(3)).then(
      argument<S, string>('target', word())
        .executes((c) => banIp(c, 'Banned by an operator.'))
        .then(argument<S, string>('reason', messageArg()).executes((c) => banIp(c, resolveMessage(c.get('reason'), c.source)))),
    ),
  );
  const banlist = (c: Ctx, players: boolean, ips: boolean): number => {
    const a = c.source.server.commands.access;
    const entries: { who: string; source: string; reason: string }[] = [];
    if (players) for (const b of a.bans) entries.push({ who: b.name, source: b.source, reason: b.reason });
    if (ips) for (const b of a.ipBans) entries.push({ who: b.ip, source: b.source, reason: b.reason });
    if (!entries.length) c.source.sendSuccess('There are no bans', false);
    else {
      c.source.sendSuccess(`There are ${entries.length} ban(s):`, false);
      for (const e of entries) c.source.sendSuccess(`${e.who} was banned by ${e.source}: ${e.reason}`, false);
    }
    return entries.length;
  };
  d.register(
    literal<S>('banlist')
      .requires(dedicated(3))
      .executes((c) => banlist(c, true, true))
      .then(literal<S>('ips').executes((c) => banlist(c, false, true)))
      .then(literal<S>('players').executes((c) => banlist(c, true, false))),
  );
  d.register(literal<S>('pardon').requires(dedicated(3)).then(argument<S, Profile>('targets', gameProfile()).executes((c) => {
    let n = 0;
    for (const name of profiles(c)) {
      if (!c.source.server.commands.access.pardon(name)) continue;
      n++;
      c.source.sendSuccess(`Unbanned ${name}`, true);
    }
    if (n === 0) throw new CommandError("Nothing changed. The player isn't banned");
    return n;
  })));
  d.register(literal<S>('pardon-ip').requires(dedicated(3)).then(argument<S, string>('target', word()).executes((c) => {
    const ip = c.get<string>('target');
    if (!IP_PATTERN.test(ip)) throw new CommandError('Invalid IP address');
    if (!c.source.server.commands.access.pardonIp(ip)) throw new CommandError("Nothing changed. That IP isn't banned");
    c.source.sendSuccess(`Unbanned IP ${ip}`, true);
    return 1;
  })));
  d.register(literal<S>('op').requires(dedicated(3)).then(argument<S, Profile>('targets', gameProfile()).executes((c) => {
    const s = c.source.server;
    let n = 0;
    for (const name of profiles(c)) {
      if (!s.commands.access.op(name)) continue;
      n++;
      c.source.sendSuccess(`Made ${name} a server operator`, true);
      const online = s.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (online) s.commands.sendOpLevel(online);
    }
    if (n === 0) throw new CommandError('Nothing changed. The player already is an operator');
    return n;
  })));
  d.register(literal<S>('deop').requires(dedicated(3)).then(argument<S, Profile>('targets', gameProfile()).executes((c) => {
    const s = c.source.server;
    let n = 0;
    for (const name of profiles(c)) {
      if (!s.commands.access.deop(name)) continue;
      n++;
      c.source.sendSuccess(`Made ${name} no longer a server operator`, true);
      const online = s.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (online) s.commands.sendOpLevel(online);
    }
    if (n === 0) throw new CommandError('Nothing changed. The player is not an operator');
    return n;
  })));
  d.register(
    literal<S>('whitelist')
      .requires(dedicated(3))
      .then(literal<S>('on').executes((c) => {
        const a = c.source.server.commands.access;
        if (a.whitelistEnabled) throw new CommandError('Whitelist is already turned on');
        a.setWhitelistEnabled(true);
        c.source.sendSuccess('Whitelist is now turned on', true);
        kickUnlisted(c.source);
        return 1;
      }))
      .then(literal<S>('off').executes((c) => {
        const a = c.source.server.commands.access;
        if (!a.whitelistEnabled) throw new CommandError('Whitelist is already turned off');
        a.setWhitelistEnabled(false);
        c.source.sendSuccess('Whitelist is now turned off', true);
        return 1;
      }))
      .then(literal<S>('list').executes((c) => {
        const names = c.source.server.commands.access.whitelist.map((w) => w.name);
        if (!names.length) c.source.sendSuccess('There are no whitelisted players', false);
        else c.source.sendSuccess(`There are ${names.length} whitelisted players: ${names.join(', ')}`, false);
        return names.length;
      }))
      .then(literal<S>('add').then(argument<S, Profile>('targets', gameProfile()).executes((c) => {
        let n = 0;
        for (const name of profiles(c)) {
          if (!c.source.server.commands.access.whitelistAdd(name)) continue;
          n++;
          c.source.sendSuccess(`Added ${name} to the whitelist`, true);
        }
        if (n === 0) throw new CommandError('Player is already whitelisted');
        return n;
      })))
      .then(literal<S>('remove').then(argument<S, Profile>('targets', gameProfile()).executes((c) => {
        let n = 0;
        for (const name of profiles(c)) {
          if (!c.source.server.commands.access.whitelistRemove(name)) continue;
          n++;
          c.source.sendSuccess(`Removed ${name} from the whitelist`, true);
        }
        if (n === 0) throw new CommandError('Player is not whitelisted');
        kickUnlisted(c.source);
        return n;
      })))
      .then(literal<S>('reload').executes((c) => {
        c.source.server.commands.access.reload();
        c.source.sendSuccess('Reloaded the whitelist', true);
        kickUnlisted(c.source);
        return 1;
      })),
  );
  d.register(literal<S>('stop').requires(dedicated(4)).executes((c) => {
    c.source.sendSuccess('Stopping the server', true);
    const s = c.source.server;
    for (const p of [...s.players]) s.commands.kick(p, 'Server closed');
    s.commands.onStop?.();
    return 1;
  }));

  // ---------------------------------------------------------------- /help
  d.register(
    literal<S>('help')
      .executes((c) => {
        const usage = d.smartUsage(d.root, c.source);
        for (const u of usage.values()) c.source.sendSuccess(`/${u}`, false);
        return usage.size;
      })
      .then(argument<S, string>('command', greedyString()).executes((c) => {
        const cmd = c.get<string>('command');
        const parse = d.parse(cmd, c.source);
        if (!parse.nodes.length || parse.reader.canRead()) throw new CommandError('Unknown command or insufficient permissions');
        const node = parse.nodes[parse.nodes.length - 1]!.node;
        const usage = d.smartUsage(node, c.source);
        const prefix = parse.input.slice(0, parse.nodes[parse.nodes.length - 1]!.end);
        if (node.command) c.source.sendSuccess(`/${prefix}`, false);
        for (const u of usage.values()) c.source.sendSuccess(`/${prefix} ${u}`, false);
        return usage.size;
      })),
  );
}

// ------------------------------------------------------------------ helpers
type Vec3i = [number, number, number];
export type FillMode = 'replace' | 'keep' | 'outline' | 'hollow' | 'destroy';
export type CloneFlag = 'normal' | 'force' | 'move';
const MAX_BLOCKS = 32768;

function isAirState(st: number): boolean {
  return st === 0 || st === BLOCKS_BY_NAME.get('cave_air')!.defaultState || st === BLOCKS_BY_NAME.get('void_air')!.defaultState;
}

function angleArg() {
  // AngleArgument: one (possibly relative) yaw value
  return {
    parse(r: StringReader): Coordinates {
      if (!r.canRead()) throw r.error('Incomplete (expected 1 angle)');
      const rel = r.peek() === '~';
      if (rel) r.skip();
      const v = r.canRead() && r.peek() !== ' ' ? r.readFloat() : 0;
      return { position: (s: S) => [s.x, s.y, s.z], rotation: (s: S) => [rel ? s.yaw + v : v, 0], isXRelative: rel, isYRelative: false, isZRelative: false };
    },
    examples: ['0', '~', '~-5'],
  };
}

function snbtArg() {
  return {
    parse(r: StringReader): string {
      if (!r.canRead() || r.peek() !== '{') throw r.error("Expected '{'");
      const s = r.cursor;
      let depth = 0;
      do {
        if (!r.canRead()) throw r.error("Expected '}'");
        const ch = r.next();
        if (ch === '"' || ch === "'") r.readStringUntil(ch);
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
      } while (depth > 0);
      return r.string.slice(s, r.cursor);
    },
    examples: ['{}', '{foo=bar}'],
  };
}

/** {Item:{id:"minecraft:stone",Count:3b}} → stack */
function nbtItem(nbt: string | null): { id: number; count: number; damage: number } | null {
  if (!nbt) return null;
  const id = /id\s*:\s*"?(?:minecraft:)?([a-z0-9_]+)"?/.exec(nbt);
  if (!id) return null;
  const item = ITEMS_BY_NAME.get(id[1]!);
  if (!item || item.name === 'air') return null;
  const count = /Count\s*:\s*(\d+)/.exec(nbt);
  return { id: item.id, count: count ? Math.max(1, Number(count[1])) : 1, damage: 0 };
}

/** Offline-mode style id for /list uuids (players have no accounts; a stable hash of the name). */
function offlineId(name: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = `OfflinePlayer:${name}`;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-3${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function kickUnlisted(src: S): void {
  const s = src.server;
  const a = s.commands.access;
  if (!a.whitelistEnabled || !a.enforceWhitelist) return;
  for (const p of [...s.players]) if (!a.mayJoinWhitelist(p.name)) s.commands.kick(p, 'You are not white-listed on this server!');
}

/** Level.destroyBlock(pos, true): particles, sound and the block's drops. */
function destroyWithDrops(s: import('../server').GameServer, x: number, y: number, z: number): void {
  const st = s.world.getState(x, y, z);
  if (isAirState(st)) return;
  for (const o of s.players) s.send(o, { t: 'levelEvent', event: 2001, x, y, z, data: st });
  s.setBlock(x, y, z, 0);
  for (const it of blockDrops(st, { silkTouch: false, canHarvest: true, random: () => s.rand.nextFloat() })) s.popResource(x, y, z, it);
}

function checkLoaded(s: import('../server').GameServer, a: Vec3i, b: Vec3i): void {
  if (Math.min(a[1], b[1]) < 0 || Math.max(a[1], b[1]) > 255) throw new CommandError('That position is not loaded');
  for (let cx = Math.min(a[0], b[0]) >> 4; cx <= Math.max(a[0], b[0]) >> 4; cx++)
    for (let cz = Math.min(a[2], b[2]) >> 4; cz <= Math.max(a[2], b[2]) >> 4; cz++)
      if (!s.world.getChunk(cx, cz)) throw new CommandError('That position is not loaded');
}

/** FillCommand.fillBlocks; returns the number of blocks changed. */
export function fill(s: import('../server').GameServer, a: Vec3i, b: Vec3i, state: number, mode: FillMode, filter: ((st: number) => boolean) | null): number {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), z0 = Math.min(a[2], b[2]);
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), z1 = Math.max(a[2], b[2]);
  const volume = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  if (volume > MAX_BLOCKS) throw new CommandError(`Too many blocks in the specified area (maximum ${MAX_BLOCKS}, specified ${volume})`);
  checkLoaded(s, a, b);
  const changed: Vec3i[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        const old = s.world.getState(x, y, z);
        if (filter && !filter(old)) continue;
        let target = state;
        if (mode === 'outline' && !edge) continue;
        if (mode === 'hollow' && !edge) target = 0;
        if (mode === 'keep' && !isAirState(old)) continue;
        if (mode === 'destroy') destroyWithDrops(s, x, y, z);
        if (s.world.getState(x, y, z) === target) continue;
        s.setBlock(x, y, z, target);
        changed.push([x, y, z]);
      }
  for (const [x, y, z] of changed) s.updateNeighbors(x, y, z);
  if (!changed.length) throw new CommandError('No blocks were filled');
  return changed.length;
}

/** CloneCommands.clone; returns the number of blocks cloned. */
export function clone(s: import('../server').GameServer, a: Vec3i, b: Vec3i, dst: Vec3i, filter: ((st: number) => boolean) | null, flag: CloneFlag): number {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), z0 = Math.min(a[2], b[2]);
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), z1 = Math.max(a[2], b[2]);
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  const dEnd: Vec3i = [dst[0] + sx, dst[1] + sy, dst[2] + sz];
  const volume = (sx + 1) * (sy + 1) * (sz + 1);
  if (volume > MAX_BLOCKS) throw new CommandError(`Too many blocks in the specified area (maximum ${MAX_BLOCKS}, specified ${volume})`);
  const overlap = dst[0] <= x1 && dEnd[0] >= x0 && dst[1] <= y1 && dEnd[1] >= y0 && dst[2] <= z1 && dEnd[2] >= z0;
  if (flag !== 'force' && overlap) throw new CommandError('The source and destination areas cannot overlap');
  checkLoaded(s, [x0, y0, z0], [x1, y1, z1]);
  checkLoaded(s, dst, dEnd);
  // snapshot the source first (so forced overlapping clones copy the original blocks)
  const copied: { x: number; y: number; z: number; st: number }[] = [];
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const st = s.world.getState(x, y, z);
        if (filter && !filter(st)) continue;
        copied.push({ x, y, z, st });
      }
  if (flag === 'move') for (const c of copied) s.setBlock(c.x, c.y, c.z, 0);
  let n = 0;
  const changed: Vec3i[] = [];
  for (const c of copied) {
    const tx = dst[0] + c.x - x0, ty = dst[1] + c.y - y0, tz = dst[2] + c.z - z0;
    n++;
    if (s.world.getState(tx, ty, tz) !== c.st) {
      s.setBlock(tx, ty, tz, c.st);
      changed.push([tx, ty, tz]);
    }
  }
  if (flag === 'move') for (const c of copied) changed.push([c.x, c.y, c.z]);
  for (const [x, y, z] of changed) s.updateNeighbors(x, y, z);
  if (n === 0) throw new CommandError('No blocks were cloned');
  return n;
}

/** Apply a game rule and its side effects (vanilla GameRules callbacks). */
export function setGameRule(src: S, name: GameRuleName, v: number | boolean): void {
  const s = src.server;
  (s.gameRules as unknown as Record<string, number | boolean>)[name] = v;
  switch (name) {
    case 'doDaylightCycle':
      s.doDaylightCycle = v as boolean;
      s.setDayTime(s.dayTime);
      break;
    case 'doWeatherCycle':
      s.doWeatherCycle = v as boolean;
      break;
    case 'playersSleepingPercentage':
      s.playersSleepingPercentage = v as number;
      break;
    case 'spawnRadius':
      s.spawnRadius = v as number;
      break;
  }
}

void typeOf;
void CommandSyntaxError;
