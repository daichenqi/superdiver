import { describe, expect, it } from "vitest";
import { filterEnemies, listConflicts, toGear } from "./import-catalog";

describe("toGear", () => {
  it("maps a support weapon and keeps wiki ap when it conflicts", () => {
    const items = [{
      id: "40-k-meltagun",
      productKind: "support-weapon",
      model: "40-K",
      nameZh: "40-K 熔化枪",
      nameEn: "40-K Meltagun",
      weaponType: "Heavy Energy-Based",
      combat: {
        components: [{
          id: "c1",
          type: "beam",
          label: "Laser",
          fields: { standardDamage: 2600, durableDamage: 2600, armorPenetration: { value: 7 } },
        }],
      },
      handling: { fireRate: 50 },
      deployment: { type: "Support Weapon", cooldownSeconds: 410 },
    }];
    const extras = { "40-k-meltagun": { ap: { front: 6 }, standardDamage: 2000, conflicts: ["穿甲"] } };
    const gear = toGear(items, extras, { "40-k-meltagun": ["火喷"] });
    expect(gear[0].slot).toBe("support");
    expect(gear[0].requiresCall).toBe(true);
    expect(gear[0].attacks[0].ap.front).toBe(6);
    expect(gear[0].attacks[0].standardDamage).toBe(2000);
    expect(gear[0].attacks[0].heat).toBe(true);
    expect(gear[0].attacks[0].roundsPerMinute).toBe(50);
    expect(gear[0].name).toBe("40-K 熔化枪");
    expect(gear[0].model).toBe("40-K");
    expect(gear[0].nameEn).toBe("40-K Meltagun");
    expect(listConflicts(items, extras)).toContain("40-k-meltagun:穿甲:目录7:wiki6");
    expect(listConflicts(items, extras)).toContain("40-k-meltagun:标准伤害:目录2600:wiki2000");
  });

  it("includes the component id when several components disagree", () => {
    const items = [{
      id: "40-k-meltagun",
      productKind: "support-weapon",
      model: "40-K",
      nameZh: "40-K 熔化枪",
      nameEn: "40-K Meltagun",
      combat: {
        components: [
          { id: "c1", type: "beam", label: "Laser", fields: { standardDamage: 2600, durableDamage: 2600, armorPenetration: { value: 7 } } },
          { id: "c2", type: "projectile", label: "Pellet", fields: { standardDamage: 100, durableDamage: 80, armorPenetration: { value: 4 } } },
        ],
      },
    }];
    const extras = { "40-k-meltagun": { ap: { front: 6 }, durableDamage: 50 } };
    expect(listConflicts(items, extras)).toEqual([
      "40-k-meltagun:c1:穿甲:目录7:wiki6",
      "40-k-meltagun:c1:耐久伤害:目录2600:wiki50",
      "40-k-meltagun:c2:穿甲:目录4:wiki6",
      "40-k-meltagun:c2:耐久伤害:目录80:wiki50",
    ]);
    const gear = toGear(items, extras, {});
    expect(gear[0].attacks[0].durableDamage).toBe(50);
    expect(gear[0].attacks[1].ap.front).toBe(6);
  });

  it("drops the first-generation Cyborg Legion faction", () => {
    expect(filterEnemies([
      { id: "a", name: "旧敌人", faction: "Cyborg Legion", multipliers: {}, parts: [] },
      { id: "b", name: "拾荒者", faction: "Terminids", multipliers: {}, parts: [] },
    ]).map((enemy) => enemy.id)).toEqual(["b"]);
  });

  it("excludes nothing by itself and marks items without components", () => {
    const gear = toGear(
      [{ id: "empty", productKind: "primary-weapon", model: "X", nameZh: "空枪", nameEn: "Empty", combat: { components: [] } }],
      {},
      {},
    );
    expect(gear[0].missingCombatData).toBe(true);
    expect(gear[0].slot).toBe("primary");
    expect(gear[0].requiresCall).toBe(false);
  });
});
