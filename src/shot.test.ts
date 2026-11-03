import { describe, expect, it } from "vitest";
import { explosionFalloff, projectileFalloff, shotDamage } from "./shot";
import type { AttackProfile, Part } from "./model";

const part = (armor: number, durability?: number): Part => ({
  id: "p",
  name: "部位",
  armor,
  health: 100,
  durability,
  fatal: true,
  breakable: false,
});

const gun = (over: Partial<AttackProfile> = {}): AttackProfile => ({
  id: "gun",
  label: "直击",
  kind: "projectile",
  aimed: true,
  ap: { front: 3 },
  standardDamage: 95,
  durableDamage: 23,
  heat: false,
  ...over,
});

describe("shotDamage", () => {
  it("mixes durable damage and floors once", () => {
    const result = shotDamage(gun(), part(2, 0.3), {
      angle: "front",
      distanceM: 0,
      zone: "inner",
      acid: false,
    });
    expect(result.damage).toBe(73);
    expect(result.penetrates).toBe(true);
  });

  it("applies 65 percent before the durable mix", () => {
    const result = shotDamage(
      gun({ ap: { front: 2 }, standardDamage: 100, durableDamage: 50 }),
      part(2, 0.5),
      { angle: "front", distanceM: 0, zone: "inner", acid: false },
    );
    expect(result.damage).toBe(48);
    expect(result.penetrates).toBe(true);
  });

  it("deals zero when ap is below armor", () => {
    const result = shotDamage(gun({ ap: { front: 1 } }), part(2, 0), {
      angle: "front",
      distanceM: 0,
      zone: "inner",
      acid: false,
    });
    expect(result.damage).toBe(0);
    expect(result.penetrates).toBe(false);
  });

  it("keeps falloff at 1 when drag is zero", () => {
    expect(projectileFalloff({ sizeMm: 10, massG: 5, drag: 0 }, 0)).toBe(1);
    expect(projectileFalloff({ sizeMm: 10, massG: 5, drag: 0 }, 25)).toBe(1);
    expect(projectileFalloff({ sizeMm: 10, massG: 5, drag: 0 }, 50)).toBe(1);
  });

  it("matches the 500kg outer-radius sample", () => {
    expect(explosionFalloff("quick", 10, 25, 20)).toBeCloseTo(1 / 3, 10);
    expect(explosionFalloff("slow", 10, 25, 20)).toBeCloseTo(5 / 9, 10);
    const bomb: AttackProfile = {
      ...gun({
        kind: "explosion",
        aimed: false,
        ap: { front: 7 },
        standardDamage: 1000,
        durableDamage: 1000,
      }),
      explosion: { innerRadius: 10, outerRadius: 25, falloff: "quick" },
    };
    const outer = shotDamage(bomb, part(7, 0), {
      angle: "front",
      distanceM: 20,
      zone: "outer",
      acid: false,
    });
    expect(outer.apUsed).toBe(6);
    expect(outer.penetrates).toBe(false);
  });

  it("drops enemy armor by 1 during acid storms", () => {
    const result = shotDamage(gun({ ap: { front: 2 }, standardDamage: 100, durableDamage: 100 }), part(2, 0), {
      angle: "front",
      distanceM: 0,
      zone: "inner",
      acid: true,
    });
    expect(result.armorUsed).toBe(1);
    expect(result.damage).toBe(100);
  });
});
