import { describe, expect, it } from "vitest";
import { filterEnemies, toGear } from "./import-catalog";

describe("toGear", () => {
  it("maps a support weapon and keeps wiki ap when it conflicts", () => {
    const gear = toGear(
      [{
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
      }],
      { "40-k-meltagun": { ap: { front: 6 }, conflicts: ["穿甲"] } },
      { "40-k-meltagun": ["火喷"] },
    );
    expect(gear[0].slot).toBe("support");
    expect(gear[0].requiresCall).toBe(true);
    expect(gear[0].attacks[0].ap.front).toBe(6);
    expect(gear[0].attacks[0].heat).toBe(true);
    expect(gear[0].attacks[0].roundsPerMinute).toBe(50);
    expect(gear[0].name).toBe("40-K 熔化枪");
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
