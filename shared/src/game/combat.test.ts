import { describe, it, expect } from 'vitest';
import { computeAttack, attackDamageOf, attackStrengthDelay } from './combat';
import { ITEMS_BY_NAME } from '../data';

const id = (n: string) => ITEMS_BY_NAME.get(n)!.id;
const base = { item: 0, attackStrengthTicker: 100, sprinting: false, fallDistance: 0, onGround: true, onClimbable: false, inWater: false, walked: 0, speed: 0.1 };

describe('melee', () => {
  it('item attack damage and recharge times', () => {
    expect(attackDamageOf(0)).toBe(1);
    expect(attackDamageOf(id('diamond_sword'))).toBe(7);
    expect(attackDamageOf(id('netherite_axe'))).toBe(10);
    expect(attackStrengthDelay(0)).toBe(5);
    expect(attackStrengthDelay(id('iron_sword'))).toBeCloseTo(12.5);
  });
  it('fully charged hits deal full damage; spam clicks deal 20%', () => {
    expect(computeAttack({ ...base, item: id('diamond_sword') }).damage).toBeCloseTo(7);
    expect(computeAttack({ ...base, item: id('diamond_sword'), attackStrengthTicker: 0 }).damage).toBeCloseTo(7 * (0.2 + (0.5 / 12.5) ** 2 * 0.8));
  });
  it('falling charged hits crit for 150%; sprint hits add knockback instead', () => {
    const crit = computeAttack({ ...base, item: id('iron_sword'), fallDistance: 0.5, onGround: false });
    expect(crit.critical).toBe(true);
    expect(crit.damage).toBeCloseTo(9);
    const sprint = computeAttack({ ...base, item: id('iron_sword'), sprinting: true, fallDistance: 0.5, onGround: false });
    expect(sprint.critical).toBe(false);
    expect(sprint.knockback).toBe(1);
  });
  it('sweeps with a sword when standing still on the ground', () => {
    expect(computeAttack({ ...base, item: id('stone_sword') }).sweep).toBe(true);
    expect(computeAttack({ ...base, item: id('stone_axe') }).sweep).toBe(false);
  });
});
