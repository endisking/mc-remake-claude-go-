import { describe, expect, it } from 'vitest';
import { ClientMob, ClientMobs, rotateIfNecessary, sheepColor, isMobType, type MobHooks } from './mobs';
import { encodeS2C, decodeS2C } from '@shared/protocol/packets';
import { MOB_MODELS, MOB_RENDER, bakeMobModel, createPoses, MOB_TEXTURES } from '../render/entities/mobmodels';

function hooks(log: string[] = []): MobHooks {
  return {
    sound: (ev) => log.push(`sound:${ev}`),
    blockStep: () => log.push('blockStep'),
    hasSound: (ev) => ev.startsWith('entity.zombie.'),
    poof: (m) => log.push(`poof:${m.id}`),
    forget: (id) => log.push(`forget:${id}`),
  };
}

describe('client mobs', () => {
  it('interpolates toward server positions over 3 ticks (lerpSteps)', () => {
    const m = new ClientMob(1, 'zombie');
    m.setPos(0, 64, 0, 0, 0, 0);
    m.lerpTo(3, 64, 0, 0, 0, 0, true);
    m.tick();
    expect(m.x).toBeCloseTo(1);
    m.tick();
    expect(m.x).toBeCloseTo(2);
    m.tick();
    expect(m.x).toBeCloseTo(3);
    m.tick();
    expect(m.x).toBeCloseTo(3);
  });

  it('body follows yRot while moving and keeps the head within 75°', () => {
    const m = new ClientMob(1, 'pig');
    m.setPos(0, 64, 0, 0, 0, 0);
    m.lerpTo(0, 64, 1, 90, 0, 170, true);
    for (let i = 0; i < 3; i++) m.tick();
    expect(m.bodyYaw).toBeCloseTo(90);
    expect(Math.abs(m.headYaw - m.bodyYaw)).toBeLessThanOrEqual(75.0001);
  });

  it('standing still, the body turns after a head turn over 15° and lines up after 10 ticks', () => {
    const m = new ClientMob(1, 'cow');
    m.setPos(0, 64, 0, 0, 0, 0);
    m.lerpTo(0, 64, 0, 0, 0, 100, true);
    for (let i = 0; i < 3; i++) m.tick();
    // the head is 100° off: the body is pulled to within 75°
    expect(m.bodyYaw).toBeCloseTo(25, 0);
    for (let i = 0; i < 25; i++) m.tick();
    expect(m.bodyYaw).toBeCloseTo(100, 0);
  });

  it('rotateIfNecessary clamps the difference', () => {
    expect(rotateIfNecessary(0, 100, 75)).toBe(25);
    expect(rotateIfNecessary(0, 50, 75)).toBe(0);
    expect(rotateIfNecessary(170, -170, 10)).toBe(-180);
  });

  it('limb swing builds up while walking (calculateEntityAnimation)', () => {
    const m = new ClientMob(1, 'zombie');
    m.setPos(0, 64, 0, 0, 0, 0);
    for (let i = 0; i < 10; i++) {
      m.lerpTo(0, 64, (i + 1) * 0.2, 0, 0, 0, true);
      m.tick();
    }
    expect(m.animationSpeed).toBeGreaterThan(0.5);
    expect(m.animationPosition).toBeGreaterThan(2);
  });

  it('hurt event: 10-tick red overlay and the hurt sound', () => {
    const log: string[] = [];
    const ms = new ClientMobs(hooks(log));
    const m = ms.add(5, 'zombie', 0, 64, 0);
    ms.event(5, 2);
    expect(m.hurtTime).toBe(10);
    expect(log).toContain('sound:entity.zombie.hurt');
    for (let i = 0; i < 10; i++) ms.tick();
    expect(m.hurtTime).toBe(0);
  });

  it('death: falls over for 20 ticks, then poofs and is removed even if the server removed it early', () => {
    const log: string[] = [];
    const ms = new ClientMobs(hooks(log));
    ms.rand = () => 0.999;
    const m = ms.add(7, 'zombie', 0, 64, 0);
    ms.event(7, 3);
    expect(log).toContain('sound:entity.zombie.death');
    expect(m.deathTime).toBe(1);
    ms.remove(7); // removeEntities arrives while dying
    expect(ms.get(7)).toBe(m);
    for (let i = 0; i < 18; i++) ms.tick();
    expect(ms.get(7)).toBe(m);
    expect(log).not.toContain('poof:7');
    ms.tick();
    expect(ms.get(7)).toBeUndefined();
    expect(log.filter((l) => l === 'poof:7')).toHaveLength(1);
  });

  it('removes living mobs at once', () => {
    const ms = new ClientMobs(hooks());
    ms.add(1, 'pig', 0, 64, 0);
    ms.remove(1);
    expect(ms.get(1)).toBeUndefined();
  });

  it('sheep grazing animation (event 10) follows Sheep.getHeadEat*Scale', () => {
    const m = new ClientMob(1, 'sheep');
    m.handleEvent(10);
    expect(m.eatAnimationTick).toBe(40);
    expect(m.headEatPositionScale(0)).toBeCloseTo(0, 5); // 40: -(0 - 0)/4
    m.tick();
    expect(m.headEatPositionScale(0)).toBeCloseTo(0.25);
    for (let i = 0; i < 10; i++) m.tick();
    expect(m.headEatPositionScale(0)).toBe(1);
    expect(m.headEatAngleScale(0)).not.toBeNull();
    for (let i = 0; i < 40; i++) m.tick();
    expect(m.eatAnimationTick).toBe(0);
    expect(m.headEatAngleScale(0)).toBeNull();
  });

  it('creeper swells while its fuse is lit and relaxes back', () => {
    const m = new ClientMob(1, 'creeper');
    m.setData('swell_dir', 1);
    for (let i = 0; i < 28; i++) m.tick();
    expect(m.swelling(1)).toBeCloseTo(1);
    m.setData('swell_dir', -1);
    for (let i = 0; i < 40; i++) m.tick();
    expect(m.swell).toBe(0);
  });

  it('chicken wings flap only while airborne', () => {
    const m = new ClientMob(1, 'chicken');
    m.onGround = true;
    for (let i = 0; i < 5; i++) m.tick();
    expect(m.chickenBob(0)).toBe(0);
    m.onGround = false;
    for (let i = 0; i < 5; i++) m.tick();
    expect(m.chickenBob(0)).toBeGreaterThan(0);
  });

  it('baby mobs have half-size boxes; slimes scale with size', () => {
    const m = new ClientMob(1, 'zombie');
    expect(m.dims()).toEqual([0.6, 1.95]);
    m.setData('baby', 1);
    expect(m.dims()).toEqual([0.3, 0.975]);
    const s = new ClientMob(2, 'slime');
    s.setData('size', 4);
    expect(s.dims()[0]).toBeCloseTo(2.04);
  });

  it('sheep wool colours (white is 0.9019608 grey, dyes at 75%)', () => {
    expect(sheepColor(0)).toEqual([0.9019608, 0.9019608, 0.9019608]);
    const red = sheepColor(14);
    expect(red[0]).toBeCloseTo((0xb0 / 255) * 0.75);
  });

  it('mobData packet round-trips (id, key, value)', () => {
    const p = decodeS2C(encodeS2C({ t: 'mobData', id: 42, key: 'swell_dir', value: -1 }));
    expect(p).toEqual({ t: 'mobData', id: 42, key: 'swell_dir', value: -1 });
  });

  it('rabbit hops for 10 ticks after event 1 or leaving the ground', () => {
    const m = new ClientMob(1, 'rabbit');
    m.handleEvent(1);
    expect(m.jumpCompletion(0)).toBe(0);
    for (let i = 0; i < 5; i++) m.tick();
    expect(m.jumpCompletion(0)).toBeCloseTo(0.5);
    for (let i = 0; i < 6; i++) m.tick();
    expect(m.jumpCompletion(0)).toBe(0);
  });

  it('iron golem arm slam lasts 10 ticks (event 4)', () => {
    const m = new ClientMob(1, 'iron_golem');
    m.handleEvent(4);
    expect(m.attackAnimationTick).toBe(10);
    for (let i = 0; i < 10; i++) m.tick();
    expect(m.attackAnimationTick).toBe(0);
  });

  it('recognises mob types from minecraft-data', () => {
    expect(isMobType('zombie')).toBe(true);
    expect(isMobType('pig')).toBe(true);
    expect(isMobType('item')).toBe(false);
    expect(isMobType('lightning_bolt')).toBe(false);
  });
});

describe('mob models', () => {
  it('every box UV stays inside its texture', () => {
    for (const [name, def] of Object.entries(MOB_MODELS)) {
      const baked = bakeMobModel(def.parts, def.tex[0], def.tex[1]);
      for (let i = 0; i < baked.data.length; i += 8) {
        const u = baked.data[i + 3]!, v = baked.data[i + 4]!;
        expect(u, name).toBeGreaterThanOrEqual(0);
        expect(u, name).toBeLessThanOrEqual(1);
        expect(v, name).toBeGreaterThanOrEqual(0);
        expect(v, name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every model animates without missing parts, for every mob type', () => {
    for (const [type, r] of Object.entries(MOB_RENDER)) {
      const mob = new ClientMob(1, type);
      for (const l of r.layers) {
        const def = MOB_MODELS[l.model]!;
        const poses = createPoses(def.parts);
        for (const data of [{}, { aggressive: 1 }, { hanging: 1 }, { carried: 1, bow: 0 }]) {
          for (const [k, v] of Object.entries(data)) mob.setData(k, v);
          expect(() => def.anim(poses, { limbSwing: 3, limbSwingAmount: 0.8, ageInTicks: 50, netHeadYaw: 20, headPitch: 10, attackTime: 0.4, partial: 0.5, mob })).not.toThrow();
          for (const p of Object.values(poses)) expect(Number.isFinite(p.xRot + p.yRot + p.zRot + p.x + p.y + p.z)).toBe(true);
        }
      }
    }
  });

  it('walk cycle: legs swing opposite (cos(limbSwing·0.6662)·1.4·amount)', () => {
    const def = MOB_MODELS.pig!;
    const poses = createPoses(def.parts);
    def.anim(poses, { limbSwing: 0, limbSwingAmount: 1, ageInTicks: 0, netHeadYaw: 0, headPitch: 0, attackTime: 0, partial: 0, mob: new ClientMob(1, 'pig') });
    expect(poses.right_hind_leg!.xRot).toBeCloseTo(1.4);
    expect(poses.left_hind_leg!.xRot).toBeCloseTo(-1.4);
    expect(poses.right_front_leg!.xRot).toBeCloseTo(-1.4);
    expect(poses.body!.xRot).toBeCloseTo(Math.PI / 2);
  });

  it('zombie arms reach forward, higher when aggressive (animateZombieArms)', () => {
    const def = MOB_MODELS.zombie!;
    const mob = new ClientMob(1, 'zombie');
    const poses = createPoses(def.parts);
    const a = { limbSwing: 0, limbSwingAmount: 0, ageInTicks: 0, netHeadYaw: 0, headPitch: 0, attackTime: 0, partial: 0, mob };
    def.anim(poses, a);
    const calm = poses.right_arm!.xRot;
    mob.setData('aggressive', 1);
    def.anim(poses, a);
    expect(calm).toBeCloseTo(-Math.PI / 2.25, 1);
    expect(poses.right_arm!.xRot).toBeLessThan(calm);
  });

  it('lists a texture for every layer', () => {
    expect(MOB_TEXTURES).toContain('zombie');
    expect(MOB_TEXTURES).toContain('spider_eyes');
    expect(MOB_TEXTURES).toContain('sheep_fur');
  });
});
