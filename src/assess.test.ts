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
  it("shows catalog component names in Chinese", () => {
    const piece: GearPiece = { ...rifle, attacks: [{ ...rifle.attacks[0], label: "Ballistic" }] };
    const card = assess(charger, [piece], calm);
    expect(card.method).toContain("实弹");
    expect(card.method).not.toContain("Ballistic");
    expect(card.gear[0]?.component).toBe("实弹");
    expect(card.missing.some((line) => line.includes("实弹"))).toBe(true);
  });

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

  it("names missing combat data when selected gear cannot be ranked", () => {
    const blank: GearPiece = {
      ...rifle,
      attacks: [],
      missingCombatData: true,
    };
    const card = assess(charger, [blank], calm);
    expect(card.method).toContain("缺少战斗数据");
    expect(card.method).not.toContain("打头");
    expect(card.method).not.toContain("打腿肉");
    expect(card.method).not.toContain("部位暂缺");
    expect(card.method).not.toContain("火焰更有效");
    expect(card.missing.some((line) => line.includes("缺少战斗数据") && line.includes("步枪"))).toBe(true);
    expect(card.gear).toEqual([]);
  });

  it("says a zero-damage piece deals no damage", () => {
    const blank: GearPiece = { ...rifle, attacks: [], harmless: true };
    const card = assess(charger, [blank], calm);
    expect(card.method).toContain("不造成伤害");
    expect(card.missing.some((line) => line.includes("不造成伤害") && line.includes("步枪"))).toBe(true);
    expect(card.method).not.toContain("缺少战斗数据");
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

  it("names the sorted held weapon during an ion storm when it cannot penetrate", () => {
    const shell: Enemy = {
      ...charger,
      parts: [
        { id: "head", name: "头", armor: 6, health: 600, durability: 0, fatal: true, breakable: false },
      ],
    };
    const weak: GearPiece = {
      ...rifle,
      attacks: [{ ...rifle.attacks[0], ap: { front: 2 } }],
    };
    const card = assess(shell, [strike, weak], { weather: ["ion-storms"], gloom: "none" });
    expect(card.method).toContain("步枪");
    expect(card.method).not.toContain("轨道打击");
    expect(card.method).not.toContain("大约");
    expect(card.method).not.toContain("风暴间歇才能呼叫");
    expect(card.conditions.some((line) => line.includes("外圈"))).toBe(false);
    expect(card.gear.map((item) => item.name)).toEqual(["轨道打击"]);

    const blocked = assess(shell, [weak], { weather: ["ion-storms"], gloom: "none" });
    expect(blocked.method).toContain("步枪");
    expect(blocked.method).not.toContain("火焰");
    expect(blocked.gear).toEqual([]);
  });

  it("writes a 2/3 heat factor in extreme cold without inventing seconds", () => {
    const laser: GearPiece = {
      ...rifle,
      id: "laser",
      name: "激光枪",
      attacks: [{ ...rifle.attacks[0], heat: true }],
    };
    const card = assess(charger, [laser], { weather: ["extreme-cold"], gloom: "none" });
    expect(card.environment.some((line) => line.includes("2/3"))).toBe(true);
    expect(card.environment.some((line) => line.includes("90%"))).toBe(true);
    expect(card.environment.some((line) => line.includes("秒"))).toBe(false);
    expect(card.gear[0]?.reason).toContain("1.1");
  });

  it("writes the shortened heat cooldown when extreme cold has a base time", () => {
    const laser: GearPiece = {
      ...rifle,
      id: "laser",
      name: "激光枪",
      attacks: [{ ...rifle.attacks[0], heat: true, cooldownSeconds: 3 }],
    };
    const card = assess(charger, [laser], { weather: ["extreme-cold"], gloom: "none" });
    expect(card.environment.some((line) => line.includes("2/3"))).toBe(true);
    expect(card.environment.some((line) => line.includes("2 秒"))).toBe(true);
    expect(card.environment.some((line) => line.includes("90%"))).toBe(true);
    expect(card.gear[0]?.reason).toContain("1.1");
  });

  it("omits the outer-radius line when the explosion has no radius", () => {
    const shell: Enemy = {
      ...charger,
      parts: [
        { id: "head", name: "头", armor: 5, health: 100, durability: 0, fatal: true, breakable: false },
      ],
    };
    const bomb: GearPiece = {
      ...strike,
      attacks: [{
        ...strike.attacks[0],
        ap: { front: 6 },
        standardDamage: 100,
        durableDamage: 100,
        explosion: undefined,
      }],
    };
    const card = assess(shell, [bomb], calm);
    expect(card.conditions.some((line) => line.includes("外圈"))).toBe(false);
    expect(card.missing.some((line) => line.includes("半径"))).toBe(true);
  });

  it("says a rifle cannot penetrate any part", () => {
    const shell: Enemy = {
      ...charger,
      parts: [
        { id: "head", name: "头", armor: 6, health: 600, durability: 0, fatal: true, breakable: false },
      ],
    };
    const weak: GearPiece = {
      ...rifle,
      attacks: [{ ...rifle.attacks[0], ap: { front: 2 } }],
    };
    const card = assess(shell, [weak], calm);
    expect(card.method).toContain("步枪");
    expect(card.method).toContain("直击");
    expect(card.method).toContain("打不穿");
    expect(card.method).not.toContain("大约");
    expect(card.method).not.toContain("打头");
    expect(card.rules).toContain("投射物距离衰减用的是简化公式，和游戏内模拟大约差 2%–4%。");
  });

  it("keeps the storm call note when that first piece cannot penetrate", () => {
    const shell: Enemy = {
      ...charger,
      parts: [
        { id: "head", name: "头", armor: 10, health: 600, durability: 0, fatal: true, breakable: false },
      ],
    };
    const card = assess(shell, [strike], { weather: ["ion-storms"], gloom: "none" });
    expect(card.method).toContain("轨道打击");
    expect(card.method).toContain("爆炸");
    expect(card.method).toContain("打不穿");
    expect(card.method).toContain("风暴间歇才能呼叫");
    expect(card.method).not.toContain("大约");
  });

  it("writes the projectile rule only when a projectile result is shown", () => {
    const aimed = assess(charger, [rifle], calm);
    expect(aimed.method).toContain("大约");
    expect(aimed.method).not.toContain("打不穿");
    expect(aimed.rules).toContain("投射物距离衰减用的是简化公式，和游戏内模拟大约差 2%–4%。");
    expect(aimed.rules.some((line) => line.includes("耐久缺失"))).toBe(false);
    const boom = assess(charger, [strike], calm);
    expect(boom.rules.some((line) => line.includes("投射物"))).toBe(false);
  });

  it("records a standard-damage rule when durability is missing", () => {
    const soft: Enemy = {
      ...charger,
      parts: [{ id: "head", name: "头", armor: 4, health: 100, fatal: true, breakable: false }],
    };
    const card = assess(soft, [rifle], calm);
    expect(card.missing.some((line) => line.includes("耐久"))).toBe(true);
    expect(card.rules).toContain("耐久缺失时只用标准伤害。");
  });

  it("does not publish a plate-only count when the inner part has no health", () => {
    const plated: Enemy = {
      ...charger,
      parts: [
        { id: "leg", name: "腿甲", armor: 4, health: 400, durability: 0, fatal: false, breakable: true, behindId: "flesh" },
        { id: "flesh", name: "腿肉", armor: 1, fatal: true, breakable: false },
      ],
    };
    const card = assess(plated, [rifle], calm);
    expect(card.method).not.toContain("大约");
    expect(card.method).not.toContain("打不穿");
    expect(card.gear.every((item) => !item.reason.includes("大约"))).toBe(true);
    expect(card.gear[0]?.shots).toBeUndefined();
  });

  it("lists every firing mode, including one that cannot penetrate", () => {
    const hull: Enemy = {
      ...charger,
      parts: [{ id: "hull", name: "车体", armor: 5, health: 1000, durability: 0, fatal: true, breakable: false }],
    };
    const gun: GearPiece = {
      ...rifle,
      name: "机炮",
      attacks: [
        { ...rifle.attacks[0], id: "heat", label: "Ballistic", mode: "破甲", ap: { front: 6 }, standardDamage: 3200, durableDamage: 3200 },
        { ...rifle.attacks[0], id: "he", label: "Ballistic", mode: "高爆", ap: { front: 3 }, standardDamage: 750, durableDamage: 750 },
      ],
    };
    const card = assess(hull, [gun], calm);
    expect(card.method).toContain("实弹（破甲）");
    expect(card.method).toContain("大约");
    expect(card.gear.map((item) => item.component)).toEqual(["实弹（破甲）", "实弹（高爆）"]);
    expect(card.gear[1]?.reason).toBe("打不穿");
    expect(card.blockedCount).toBe(0);
  });

  it("lists every part, including equal penetration and breaking the plate", () => {
    const card = assess(charger, [rifle], calm);
    expect(card.locations.map((item) => item.name)).toEqual(["头", "腿肉", "腿甲", "臀"]);
    expect(card.locations[0]?.detail).toBe("同级穿甲，大约 10 发");
    expect(card.locations[1]?.detail).toBe("大约 50 发");
    expect(card.locations[2]?.detail).toBe("同级穿甲，先打碎外甲 7 发，再打腿肉 50 发");
    expect(card.locations[3]?.detail).toBe("大约 8 发，腿肉打不穿");
    expect(assess(charger, [], calm).locations).toEqual([]);
  });

  it("adds the main-health transfer and the bleed from breaking a plate", () => {
    const plated: Enemy = {
      ...charger,
      parts: [{
        id: "plate",
        name: "背板",
        armor: 4,
        health: 400,
        durability: 0,
        fatal: false,
        breakable: false,
        percentToMain: 0.1,
        bleed: 35000,
        bleedPerSecond: 0,
      }],
    };
    const card = assess(plated, [rifle], calm);
    expect(card.locations[0]?.detail).toBe("同级穿甲，大约 7 发。10% 进主体，打碎后主体掉 35000");
  });

  it("keeps the break payoff when the shot cannot open the plate", () => {
    const plated: Enemy = {
      ...charger,
      parts: [{
        id: "plate",
        name: "背板",
        armor: 6,
        health: 400,
        durability: 0,
        fatal: false,
        breakable: false,
        bleed: 35000,
        bleedPerSecond: 0,
      }],
    };
    const card = assess(plated, [rifle], calm);
    expect(card.locations[0]?.detail).toBe("打不穿。若打碎，主体掉 35000");
  });

  it("adds the shell, the burst, and every fragment on the same part", () => {
    const body: Enemy = {
      ...charger,
      parts: [{ id: "body", name: "身", armor: 0, health: 1000, durability: 0, fatal: true, breakable: false }],
    };
    const gun: GearPiece = {
      ...rifle,
      name: "机炮",
      attacks: [
        { ...rifle.attacks[0], id: "shell", label: "Ballistic", mode: "空爆", ap: { front: 4 }, standardDamage: 100, durableDamage: 100, sourceName: "P", parentName: "GUN" },
        { ...rifle.attacks[0], id: "blast", label: "Explosion", kind: "explosion", aimed: false, mode: "空爆", ap: { front: 3 }, standardDamage: 50, durableDamage: 50, sourceName: "IE", parentName: "P", shrapnelCount: 30, shrapnelName: "F", explosion: { innerRadius: 2, outerRadius: 7, falloff: "quick" } },
        { ...rifle.attacks[0], id: "frag", label: "Ballistic", mode: "空爆", fragment: true, ap: { front: 3 }, standardDamage: 10, durableDamage: 10, sourceName: "F", parentName: "IE" },
      ],
    };
    const card = assess(body, [gun], calm);
    expect(card.method).toContain("大约 3 发");
    expect(card.method).toContain("30 枚破片");
    expect(card.method).toContain("都打中这一处");
    expect(card.locations[0]?.detail).toContain("30 枚破片");
  });

  it("leaves an explosion off a part that is explosion immune", () => {
    const mouth: Enemy = {
      ...charger,
      parts: [{ id: "mouth", name: "口腔", armor: 2, health: 430, durability: 0, fatal: false, breakable: false, explosionResist: 1 }],
    };
    const gun: GearPiece = {
      ...rifle,
      name: "机炮",
      attacks: [
        { ...rifle.attacks[0], id: "shell", label: "Ballistic", mode: "空爆", ap: { front: 4 }, standardDamage: 100, durableDamage: 100, sourceName: "P", parentName: "GUN" },
        { ...rifle.attacks[0], id: "blast", label: "Explosion", kind: "explosion", aimed: false, mode: "空爆", ap: { front: 3 }, standardDamage: 50, durableDamage: 50, sourceName: "IE", parentName: "P", shrapnelCount: 30, shrapnelName: "F", explosion: { innerRadius: 2, outerRadius: 7, falloff: "quick" } },
        { ...rifle.attacks[0], id: "frag", label: "Ballistic", mode: "空爆", fragment: true, ap: { front: 3 }, standardDamage: 10, durableDamage: 10, sourceName: "F", parentName: "IE" },
      ],
    };
    const card = assess(mouth, [gun], calm);
    expect(card.method).toContain("大约 2 发");
    expect(card.method).toContain("爆炸免疫");
    expect(card.method).not.toContain("含弹头、爆炸");
    expect(card.locations[0]?.detail).toContain("爆炸免疫");
  });

  it("keeps three quarters of an explosion against 25 percent resistance", () => {
    const body: Enemy = {
      ...charger,
      parts: [{ id: "body", name: "主体", armor: 0, health: 100, durability: 0, fatal: true, breakable: false, explosionResist: 0.25 }],
    };
    const bomb: GearPiece = {
      ...rifle,
      attacks: [{
        ...rifle.attacks[0],
        kind: "explosion",
        aimed: false,
        label: "Explosion",
        ap: { front: 4 },
        standardDamage: 100,
        durableDamage: 100,
        explosion: { innerRadius: 2, outerRadius: 7, falloff: "quick" },
      }],
    };
    const card = assess(body, [bomb], calm);
    expect(card.method).toContain("大约 2 发");
    expect(card.method).toContain("爆炸抗性 25%");
  });
});
