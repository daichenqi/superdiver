import { describe, expect, it } from "vitest";
import type { CatalogItem } from "./import-catalog";
import { buildGear, type CargoStratagem, type CargoWeapon, type DecodedDoc, type LegacyDoc } from "./wiki-gear";

const weaponsDoc: DecodedDoc = {
  wep_version: "1.007.202",
  damage: {
    "AR-11_dm": { dmg: 80, dmg2: 20, ap1: 3, ap2: 3, ap3: 2, ap4: 0, element_name_sub: "ballistic" },
    "P4_dm": { dmg: 200, dmg2: 200, ap1: 4, ap2: 4, ap3: 3, ap4: 2, element_name_sub: "ballistic" },
    "AR-23_dm": { dmg: 90, dmg2: 22, ap1: 2, ap2: 2, ap3: 2, ap4: 0, element_name_sub: "ballistic" },
    "AC-8_dm": { dmg: 350, dmg2: 350, ap1: 4, ap2: 4, ap3: 4, ap4: 4, element_name_sub: "ballistic" },
    "MG_dm": { dmg: 90, dmg2: 22, ap1: 3, ap2: 3, ap3: 3, ap4: 0, element_name_sub: "ballistic" },
  },
  projectile: {
    "AR-11_P": { damage_id: "AR-11_dm", caliber: 8, mass: 6, drag: 0.2 },
    P4: { damage_id: "P4_dm", caliber: 40, mass: 80, drag: 0.4 },
    "AR-23_P": { damage_id: "AR-23_dm", caliber: 5.5, mass: 4.5, drag: 0.3 },
    "AC-8_P": { damage_id: "AC-8_dm", caliber: 20, mass: 50, drag: 0.5 },
    "MG-43_P": { damage_id: "MG_dm", caliber: 8, mass: 8, drag: 0.3 },
  },
  weapons: {
    "AR-11 ARBITRATOR": {
      rpm: 1200,
      attacks: [
        { type: "projectile", name: "AR-11_P" },
        { type: "weapons", name: "Underbarrel_AR-11 ARBITRATOR 0" },
      ],
    },
    "Underbarrel_AR-11 ARBITRATOR 0": {
      rpm: 80,
      attacks: [{ type: "projectile", name: "P4" }],
    },
    "AR-23 LIBERATOR": { rpm: 640, attacks: [{ type: "projectile", name: "AR-23_P" }] },
    "AC-8 AUTOCANNON": { rpm: 200, attacks: [{ type: "projectile", name: "AC-8_P" }] },
    "MG-43 MACHINE GUN": { rpm: 760, attacks: [{ type: "projectile", name: "MG-43_P" }] },
  },
};

const stratDoc: DecodedDoc = {
  strat_version: "01.007.202",
  damage: {
    E_dm: { dmg: 1500, dmg2: 1500, ap1: 6, ap2: 0, ap3: 0, ap4: 0, element_name_sub: "explosion" },
    IE_dm: { dmg: 0, ap1: 3, element_name: "gas", element_name_sub: "explosion" },
    GAS_dm: { dmg: 1500, dmg2: 1500, ap1: 7, ap2: 7, ap3: 7, ap4: 7, element_name_sub: "ballistic" },
  },
  explosion: {
    S_P_E: { damage_id: "E_dm", r1: 10, r2: 25, r3: 35 },
    S_P_IE: { damage_id: "IE_dm", r1: 1, r2: 3, r3: 6 },
  },
  projectile: {
    S_P6: { damage_id: "GAS_dm", caliber: 25, mass: 100, drag: 0.5 },
  },
  stratagems: {
    "EAGLE 500KG BOMB": {
      cooldown: 15,
      attacks: [
        { type: "explosion", name: "S_P_E" },
        { type: "explosion", name: "S_P_IE" },
        { type: "status", name: "Fire" },
      ],
    },
    REINFORCE: { cooldown: 10, attacks: [] },
    AUTOCANNON: { cooldown: 480, attacks: [] },
    "MACHINE GUN": { cooldown: 480, attacks: [] },
    "EAGLE GAS AIRSTRIKE": { cooldown: 15, attacks: [{ type: "projectile", name: "S_P6" }] },
    "SEAF ARTILLERY": { cooldown: 15, attacks: [] },
    "EXPENDABLE ANTI-TANKII": { cooldown: 0, attacks: [] },
  },
};

const weaponRows: CargoWeapon[] = [
  { title: "AR-11 Arbitrator", category: "Primary Weapons" },
  { title: "AR-23 Liberator", category: "Primary Weapons" },
  { title: "AC-8 Autocannon", category: "Support Weapons" },
];

const stratRows: CargoStratagem[] = [
  { title: "Eagle 500kg Bomb", type: "Eagle" },
  { title: "Reinforce", type: "Ship" },
  { title: "AC-8 Autocannon", type: "Support Weapon" },
  { title: "MG-43 Machine Gun", type: "Support Weapon" },
  { title: "Eagle Gas Airstrike", type: "Eagle" },
  { title: "Upload Data", type: "Objective" },
  { title: "SEAF Artillery", type: "Objective" },
];

const catalog: CatalogItem[] = [
  {
    id: "ar-23-liberator",
    productKind: "primary-weapon",
    model: "AR-23",
    nameZh: "解放者",
    nameEn: "AR-23 Liberator",
  },
];

const lang = {
  "AR-11 Arbitrator": "AR-11 仲裁者",
  "Eagle Gas Airstrike": "飞鹰毒气空袭",
};

describe("wiki gear", () => {
  const { gear, version } = buildGear(weaponsDoc, stratDoc, weaponRows, stratRows, catalog, lang);

  it("keeps a new primary, folds the underbarrel, and fills ballistics", () => {
    const gun = gear.find((piece) => piece.name === "AR-11 仲裁者");
    expect(gun).toMatchObject({
      slot: "primary",
      requiresCall: false,
      model: "AR-11",
      nameEn: "AR-11 Arbitrator",
    });
    expect(gun?.attacks).toHaveLength(2);
    expect(gun?.attacks[0]).toMatchObject({
      label: "Ballistic",
      standardDamage: 80,
      ballistics: { sizeMm: 8, massG: 6, drag: 0.2 },
      ap: { front: 3, extreme: 0 },
      roundsPerMinute: 1200,
    });
    expect(gun?.attacks[1]).toMatchObject({ standardDamage: 200, ballistics: { sizeMm: 40 } });
    expect(gear.some((piece) => /underbarrel/i.test(piece.name))).toBe(false);
  });

  it("uses the catalog Chinese name when the English name matches", () => {
    expect(gear.find((piece) => piece.id === "ar-23-liberator")).toMatchObject({
      name: "解放者",
      model: "AR-23",
      slot: "primary",
      attacks: [expect.objectContaining({ ballistics: { sizeMm: 5.5, massG: 4.5, drag: 0.3 } })],
    });
  });

  it("lists a support weapon once and keeps the call-in cooldown", () => {
    const supports = gear.filter((piece) => piece.nameEn === "AC-8 Autocannon");
    expect(supports).toHaveLength(1);
    expect(supports[0]).toMatchObject({ slot: "support", requiresCall: true });
    expect(supports[0].attacks[0]).toMatchObject({ cooldownSeconds: 480, roundsPerMinute: 200 });
    const machineGun = gear.find((piece) => piece.nameEn === "MG-43 Machine Gun");
    expect(machineGun).toMatchObject({ slot: "support" });
    expect(machineGun?.attacks[0]).toMatchObject({ standardDamage: 90, roundsPerMinute: 760 });
  });

  it("reads explosion radii and skips ship calls and zero-damage status hits", () => {
    const bomb = gear.find((piece) => piece.nameEn === "Eagle 500kg Bomb");
    expect(bomb).toMatchObject({ slot: "stratagem", eagle: true });
    expect(bomb?.attacks).toHaveLength(1);
    expect(bomb?.attacks[0]).toMatchObject({
      label: "Explosion",
      explosion: { innerRadius: 10, outerRadius: 25, falloff: "quick" },
      cooldownSeconds: 15,
    });
    expect(gear.some((piece) => /reinforce/i.test(`${piece.name} ${piece.nameEn ?? ""}`))).toBe(false);
    expect(gear.find((piece) => piece.name === "飞鹰毒气空袭")?.attacks[0]).toMatchObject({
      ballistics: { sizeMm: 25, massG: 100, drag: 0.5 },
    });
    expect(version).toBe("1.007.202 / 01.007.202");
    expect(gear.some((piece) => piece.nameEn === "Upload Data")).toBe(false);
    expect(gear.find((piece) => piece.nameEn === "SEAF Artillery")).toMatchObject({ slot: "stratagem" });
    expect(gear.find((piece) => piece.name === "Expendable Anti-Tank II")).toMatchObject({
      slot: "stratagem",
      missingCombatData: true,
    });
  });

  it("follows the wiki page name when the display title does not match", () => {
    const doc: DecodedDoc = {
      damage: { SHOVEL_dm: { dmg: 165, dmg2: 83, ap1: 3, ap2: 0, ap3: 0, ap4: 0, element_name_sub: "melee" } },
      weapons: { "CQC-72 ENTRENCHMENT TOOL": { attacks: [{ type: "damage", name: "SHOVEL_dm" }] } },
    };
    const rows: CargoWeapon[] = [{ title: "Trench Shovel", page: "CQC-72 Entrenchment Tool", category: "Support Weapons" }];
    const { gear } = buildGear(doc, {}, rows, [], [], {});
    expect(gear).toHaveLength(1);
    expect(gear[0]).toMatchObject({ slot: "support", attacks: [expect.objectContaining({ standardDamage: 165 })] });
    expect(gear[0].missingCombatData).toBeUndefined();
  });

  it("calls a zero-damage grenade harmless instead of missing", () => {
    const doc: DecodedDoc = {
      damage: { STUN_dm: { dmg: 0, ap1: 6, element_name_sub: "explosion" } },
      explosion: { STUN_E: { damage_id: "STUN_dm", r1: 1, r2: 10 } },
      weapons: { "G-23 STUN": { attacks: [{ type: "explosion", name: "STUN_E" }] } },
    };
    const rows: CargoWeapon[] = [{ title: "G-23 Stun", category: "Throwables" }];
    const { gear } = buildGear(doc, {}, rows, [], [], {});
    expect(gear[0]).toMatchObject({ harmless: true, attacks: [] });
    expect(gear[0].missingCombatData).toBeUndefined();
  });

  it("fills an empty stratagem from the older attack module when the name is unique", () => {
    const strat: DecodedDoc = { stratagems: { HELLBOMB: { cooldown: 20, attacks: [] } } };
    const rows: CargoStratagem[] = [{ title: "Hellbomb", page: "NUX-223 Hellbomb", type: "Objective" }];
    const legacy: LegacyDoc = {
      damage: { Explosion_Hellbomb: { dmg: 10000, dmg2: 10000, ap1: 10, ap2: 0, ap3: 0, ap4: 0 } },
      explosion: { Hellbomb: { name: "Hellbomb", damageid: "Explosion_Hellbomb", r1: 17, r2: 25, r3: 45 } },
    };
    const { gear } = buildGear({}, strat, [], rows, [], {}, legacy);
    expect(gear[0].attacks[0]).toMatchObject({
      standardDamage: 10000,
      explosion: { innerRadius: 17, outerRadius: 25, falloff: "quick" },
    });
    expect(gear[0].missingCombatData).toBeUndefined();
  });

  it("names each shell program and keeps the flak fragments with that program", () => {
    const doc: DecodedDoc = {
      damage: {
        A_dm: { dmg: 325, ap1: 4, element_name_sub: "ballistic" },
        AE_dm: { dmg: 150, ap1: 3, element_name_sub: "explosion" },
        B_dm: { dmg: 150, ap1: 2, element_name_sub: "ballistic" },
        C_dm: { dmg: 110, ap1: 3, element_name_sub: "ballistic" },
        BB_dm: { dmg: 20, ap1: 3, element_name_sub: "explosion" },
      },
      projectile: {
        A: { damage_id: "A_dm", caliber: 20, mass: 120, drag: 0.3, explode_proximity: 0 },
        B: { damage_id: "B_dm", caliber: 40, mass: 130, drag: 0.3, explode_proximity: 3 },
        C: { damage_id: "C_dm", caliber: 10, mass: 20, drag: 0.4 },
      },
      explosion: {
        AE: { damage_id: "AE_dm", r1: 1, r2: 3 },
        BE: { damage_id: "AE_dm", r1: 2, r2: 6, shrapnel: "C", shrapnel_count: 30 },
        "GR-8_BACKBLAST_E": { damage_id: "BB_dm", r1: 1, r2: 4 },
      },
      weapons: {
        "AC-8 AUTOCANNON": {
          rpm: 190,
          attacks: [
            { type: "explosion", name: "GR-8_BACKBLAST_E", parent: "AC-8 AUTOCANNON", level: 1 },
            { type: "projectile", name: "A", parent: "AC-8 AUTOCANNON", level: 1 },
            { type: "explosion", name: "AE", parent: "A", level: 2 },
            { type: "projectile", name: "B", parent: "AC-8 AUTOCANNON", level: 1 },
            { type: "explosion", name: "BE", parent: "B", level: 2 },
            { type: "projectile", name: "C", parent: "BE", level: 3 },
          ],
        },
      },
    };
    const rows: CargoWeapon[] = [{ title: "AC-8 Autocannon", category: "Support Weapons" }];
    const book: CatalogItem[] = [{
      id: "ac-8",
      productKind: "support-weapon",
      model: "AC-8",
      nameZh: "机炮",
      nameEn: "AC-8 Autocannon",
      handling: { firingModes: ["Semi", "Auto", "APHET", "Flak"] },
      combat: {
        components: [
          { id: "1", type: "projectile", label: "Ballistic", fields: { standardDamage: 325, armorPenetration: { value: 4 } } },
          { id: "2", type: "projectile", label: "Ballistic", fields: { standardDamage: 110, armorPenetration: { value: 4 } } },
        ],
      },
    }];
    const { gear } = buildGear(doc, {}, rows, [], book, {});
    const gun = gear.find((piece) => piece.name === "机炮");
    expect(gun?.attacks.map((attack) => attack.standardDamage)).toEqual([325, 150, 150, 150, 110]);
    expect(gun?.attacks.map((attack) => attack.mode)).toEqual(["穿甲高爆", "穿甲高爆", "空爆", "空爆", "空爆"]);
    expect(gun?.attacks.some((attack) => attack.standardDamage === 20)).toBe(false);
    expect(gun?.attacks.find((attack) => attack.standardDamage === 110)).toMatchObject({ fragment: true });
    expect(gun?.attacks.find((attack) => attack.shrapnelCount === 30)?.mode).toBe("空爆");
  });

  it("uses the catalog shell when the wiki attack list is empty", () => {
    const strat: DecodedDoc = { stratagems: { "ANTI-TANK EMPLACEMENT": { cooldown: 180, attacks: [] } } };
    const rows: CargoStratagem[] = [{ title: "E/AT-12 Anti-Tank Emplacement", type: "Emplacement" }];
    const book: CatalogItem[] = [{
      id: "e-at-12",
      productKind: "stratagem",
      model: "E/AT-12",
      nameZh: "反坦克炮台",
      nameEn: "E/AT-12 Anti-Tank Emplacement",
      handling: { fireRate: 60 },
      combat: {
        components: [
          { id: "1", type: "projectile", label: "Ballistic", fields: { standardDamage: 1300, armorPenetration: { value: 6 } } },
          { id: "2", type: "explosion", label: "Explosion", fields: { standardDamage: 150 } },
        ],
      },
    }];
    const { gear } = buildGear({}, strat, [], rows, book, {});
    expect(gear[0]).toMatchObject({
      name: "反坦克炮台",
      catalogFallback: true,
      attacks: [expect.objectContaining({ standardDamage: 1300, ap: { front: 6 }, roundsPerMinute: 60, cooldownSeconds: 180 })],
    });
    expect(gear[0].attacks).toHaveLength(1);
    expect(gear[0].missingCombatData).toBeUndefined();
  });

  it("does not copy a different expendable launcher onto Anti-Tank II", () => {
    const strat: DecodedDoc = { stratagems: { "EXPENDABLE ANTI-TANKII": { cooldown: 0, attacks: [] } } };
    const rows: CargoStratagem[] = [{ title: "Expendable Anti-Tank II", type: "Support Weapon" }];
    const book: CatalogItem[] = [{
      id: "eat-17",
      productKind: "support-weapon",
      model: "EAT-17",
      nameZh: "消耗性反坦克武器",
      nameEn: "EAT-17 Expendable Anti-Tank",
      combat: {
        components: [
          { id: "1", type: "projectile", label: "Ballistic", fields: { standardDamage: 2000, armorPenetration: { value: 6 } } },
        ],
      },
    }];
    const { gear } = buildGear({}, strat, [], rows, book, {});
    expect(gear[0].missingCombatData).toBe(true);
    expect(gear[0].attacks).toEqual([]);
  });
});
