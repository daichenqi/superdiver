import { describe, expect, it } from "vitest";
import { assess } from "./assess";
import type { Enemy, GearPiece, Situation } from "./model";

const calm: Situation = { weather: [], gloom: "none" };

const charger: Enemy = {
  id: "charger",
  name: "冲锋虫",
  faction: "Terminids",
  health: 1000,
  wikiUrl: "https://helldivers.wiki.gg/wiki/Charger",
  multipliers: { fire: 1.5, gas: 0, arc: 0.5 },
  parts: [
    { id: "head", name: "头", armor: 4, health: 600, durability: 0.2, fatal: true, breakable: false },
    { id: "leg", name: "腿甲", armor: 4, health: 400, durability: 0, fatal: false, breakable: true, behindId: "flesh" },
    { id: "flesh", name: "腿肉", armor: 1, health: 5000, durability: 0, fatal: true, breakable: false },
    { id: "butt", name: "臀", armor: 0, health: 800, durability: 0.8, fatal: false, breakable: false, behindId: "flesh" },
  ],
};

const rifle: GearPiece = {
  id: "rifle",
  name: "步枪",
  slot: "primary",
  order: 0,
  requiresCall: false,
  eagle: false,
  attacks: [{
    id: "hit",
    label: "直击",
    kind: "projectile",
    aimed: true,
    ap: { front: 4, slight: 4, large: 2, extreme: 2 },
    standardDamage: 100,
    durableDamage: 100,
    heat: false,
    roundsPerMinute: 600,
  }],
};

const strike: GearPiece = {
  id: "strike",
  name: "轨道打击",
  slot: "stratagem",
  order: 0,
  requiresCall: true,
  eagle: false,
  attacks: [{
    id: "boom",
    label: "爆炸",
    kind: "explosion",
    aimed: false,
    ap: { front: 7 },
    standardDamage: 1000,
    durableDamage: 1000,
    heat: false,
    explosion: { innerRadius: 5, outerRadius: 15, falloff: "quick" },
  }],
};

describe("assess", () => {
  it("aims inner flesh when a plate only lists it as behindId", () => {
    const plated: Enemy = {
      ...charger,
      parts: [
        { id: "leg", name: "腿甲", armor: 4, health: 400, durability: 0, fatal: false, breakable: true, behindId: "flesh" },
        { id: "flesh", name: "腿肉", armor: 1, health: 200, durability: 0, fatal: true, breakable: false },
      ],
    };
    const card = assess(plated, [rifle], calm);
    expect(card.method).toContain("腿肉");
  });

  it("shows an angle condition only when the result changes", () => {
    const card = assess(charger, [rifle], calm);
    expect(card.conditions.some((line) => line.includes("61"))).toBe(true);
    expect(card.conditions.some((line) => line.includes("26"))).toBe(false);
  });

  it("promotes acid armor into the headline and keeps the recovery line", () => {
    const card = assess(charger, [rifle], { weather: ["acid-storms"], gloom: "none" });
    expect(card.method).toContain("步枪");
    expect(card.conditions.some((line) => line.includes("酸雨结束"))).toBe(true);
  });

  it("ranks called stratagems after held weapons during ion storms", () => {
    const card = assess(charger, [strike, rifle], { weather: ["ion-storms"], gloom: "none" });
    expect(card.gear[0]?.name).toBe("步枪");
    expect(card.gear.map((item) => item.name)).toContain("轨道打击");
    expect(card.method).toContain("步枪");
  });

  it("omits the gear section text by leaving gear empty", () => {
    const card = assess(charger, [], calm);
    expect(card.gear).toEqual([]);
    expect(card.weakPoints.length).toBeGreaterThan(0);
    expect(card.damageTypes).toEqual([
      { type: "fire", label: "更有效" },
      { type: "arc", label: "抗性" },
      { type: "gas", label: "免疫" },
    ]);
    expect(card.method.length).toBeGreaterThan(0);
  });

  it("applies heat cooldown once when fire tornados and intense heat are both on", () => {
    const laser: GearPiece = {
      ...rifle,
      id: "laser",
      name: "激光枪",
      attacks: [{ ...rifle.attacks[0], heat: true, cooldownSeconds: 3 }],
    };
    const card = assess(charger, [laser], { weather: ["fire-tornados", "intense-heat"], gloom: "none" });
    expect(card.environment.filter((line) => line.includes("4/3")).length).toBe(1);
    expect(card.environment.some((line) => line.includes("视野"))).toBe(true);
  });

  it("keeps a front-shot method when ballistics and the behind part are missing", () => {
    const bare: Enemy = { ...charger, parts: [{ ...charger.parts[0], behindId: undefined }] };
    const plain: GearPiece = {
      ...rifle,
      attacks: [{ ...rifle.attacks[0], ballistics: undefined, ap: { front: 4 } }],
    };
    const card = assess(bare, [plain], calm);
    expect(card.method).toContain("步枪");
    expect(card.conditions.some((line) => line.includes("米"))).toBe(false);
    expect(card.missing.some((line) => line.includes("弹道"))).toBe(true);
  });
});
