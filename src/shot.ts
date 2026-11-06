import type { AngleBand, AttackProfile, Part, ShotContext, ShotResult } from "./model";

const DRAG_K = 0.0004712389;

export function apFor(attack: AttackProfile, angle: AngleBand): number {
  return attack.ap[angle] ?? attack.ap.front;
}

export function sharesOneAp(attack: AttackProfile): boolean {
  return attack.ap.slight === undefined && attack.ap.large === undefined && attack.ap.extreme === undefined;
}

export function projectileFalloff(
  ballistics: { sizeMm: number; massG: number; drag: number },
  distanceM: number,
): number | null {
  if (ballistics.drag === 0) return 1;
  if (ballistics.massG === 0) return null;
  const dragDecel = (DRAG_K * ballistics.sizeMm ** 2 * ballistics.drag) / ballistics.massG;
  return 1 - 0.75 * (1 - Math.exp(-2 * dragDecel * distanceM));
}

export function explosionFalloff(
  kind: "slow" | "quick",
  inner: number,
  outer: number,
  distanceM: number,
): number | null {
  if (!(outer > inner)) return null;
  if (distanceM <= inner) return 1;
  const x = Math.min(1, (distanceM - inner) / (outer - inner));
  return kind === "quick" ? 1 - x : 1 - x * x;
}

export function beamFalloff(beam: NonNullable<AttackProfile["beam"]>, distanceM: number): number {
  if (distanceM <= beam.falloffStart) return 1;
  if (distanceM >= beam.range || beam.range === beam.falloffStart) return beam.maxFalloff;
  const t = (distanceM - beam.falloffStart) / (beam.range - beam.falloffStart);
  return 1 - (1 - beam.maxFalloff) * t;
}

function validArmor(armor: number): boolean {
  return Number.isInteger(armor) && armor >= 0 && armor <= 10;
}

export function shotDamage(attack: AttackProfile, part: Part, ctx: ShotContext): ShotResult {
  const armorUsed = ctx.acid ? Math.max(0, part.armor - 1) : part.armor;
  const blank = (apUsed: number): ShotResult => ({
    damage: 0,
    penetrates: false,
    apUsed,
    armorUsed,
    falloff: 1,
    missingBallistics: false,
  });
  if (!validArmor(part.armor) || !validArmor(armorUsed)) return blank(attack.ap.front);

  let apUsed = attack.kind === "explosion" ? attack.ap.front : apFor(attack, ctx.angle);
  if (attack.kind === "explosion" && ctx.zone === "outer") apUsed = Math.max(0, apUsed - 1);

  let falloff = 1;
  let missingBallistics = false;
  if (attack.kind === "projectile") {
    if (!attack.ballistics) missingBallistics = true;
    else {
      const value = projectileFalloff(attack.ballistics, ctx.distanceM);
      if (value === null) missingBallistics = true;
      else falloff = value;
    }
  } else if (attack.kind === "explosion" && ctx.zone === "outer") {
    if (!attack.explosion) missingBallistics = true;
    else {
      const value = explosionFalloff(
        attack.explosion.falloff,
        attack.explosion.innerRadius,
        attack.explosion.outerRadius,
        ctx.distanceM,
      );
      if (value === null) missingBallistics = true;
      else falloff = value;
    }
  } else if (attack.kind === "beam" && attack.beam) {
    falloff = beamFalloff(attack.beam, ctx.distanceM);
  }

  const factor = apUsed > armorUsed ? 1 : apUsed === armorUsed ? 0.65 : 0;
  const standard = attack.standardDamage * falloff * factor;
  let mixed =
    part.durability === undefined || attack.durableDamage === undefined
      ? standard
      : standard * (1 - part.durability) + attack.durableDamage * falloff * factor * part.durability;
  const resist = attack.kind === "explosion" ? part.explosionResist : undefined;
  const explosionImmune = resist !== undefined && resist >= 1;
  if (explosionImmune) mixed = 0;
  else if (resist !== undefined && resist > 0 && factor > 0) mixed *= 1 - resist;
  const damage = Math.floor(mixed);
  return {
    damage,
    penetrates: factor > 0 && damage > 0,
    apUsed,
    armorUsed,
    falloff,
    missingBallistics,
    ...(explosionImmune ? { explosionImmune: true } : {}),
    ...(resist !== undefined && resist > 0 && resist < 1 && damage > 0 ? { explosionResist: resist } : {}),
  };
}
