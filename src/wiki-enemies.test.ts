import { describe, expect, it } from "vitest";
import { enemyFromWiki, parseAnatomy } from "./wiki-enemies";

const charger = `
{{Anatomy Row
  | part_name = 头
  | health = 1,200
  | av = 4
  | durability = 75%
  | fatal = Yes
}}
{{Anatomy Row
  | part_name = 内部血肉
  | health = Main
  | av = 1
  | durability = 30%
  | fatal = Yes
}}
{{Anatomy Row
  | part_name = 尾部
  | health = 950
  | av = 0
  | durability = 80%
  | fatal = Yes<br>(Downs)
}}
`;

describe("wiki enemies", () => {
  it("reads armor, main-pool health, and fatal from the anatomy table", () => {
    const parts = parseAnatomy(charger, 2400);
    expect(parts.map((part) => part.name)).toEqual(["头", "内部血肉", "尾部"]);
    expect(parts[1]).toMatchObject({ armor: 1, health: 2400, durability: 0.3, fatal: true });
    expect(parts[2]).toMatchObject({ armor: 0, health: 950, fatal: true });
  });

  it("reads a Chinese fatal flag, plate bleed, and drops the repeated view", () => {
    const parts = parseAnatomy(`
{{Anatomy Row
  | part_name = 主体
  | health = 1,000
  | av = 5
  | durability = 0%
  | fatal = 致死
  | percent_to_main = -
  | bleed = 无健康值
  | exdr = 25%
}}
{{Anatomy Row
  | part_name = 背板装甲
  | health = 400
  | av = 4
  | durability = 0%
  | fatal = 非致死
  | percent_to_main = 10%
  | bleed = 35,000 [0/s]
  | exdr = 100%
}}
{{Anatomy Row
  | part_name = 主体
  | health = 1,000
  | av = 5
  | durability = 0%
  | fatal = 致死
  | exdr = 25%
}}
`, 1000);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ name: "主体", fatal: true, explosionResist: 0.25 });
    expect(parts[0].percentToMain).toBeUndefined();
    expect(parts[1]).toMatchObject({ fatal: false, percentToMain: 0.1, bleed: 35000, bleedPerSecond: 0, explosionResist: 1 });
  });

  it("drops the cyborg legion and keeps the icon name", () => {
    const kept = enemyFromWiki({
      page: "强袭虫",
      title: "强袭虫",
      faction: "终结族",
      health: "2,400",
      "fire mult": "1.5",
    }, "| image = Charger Enemy Icon.png\n" + charger);
    expect(kept?.id).toBe("charger");
    expect(kept?.name).toBe("强袭虫");
    expect(kept?.nameEn).toBe("Charger");
    expect(kept?.health).toBe(2400);
    expect(kept?.multipliers.fire).toBe(1.5);
    expect(kept?.parts).toHaveLength(3);
    expect(enemyFromWiki({ page: "噪轰引擎", title: "噪轰引擎", faction: "生化人军团" }, "")).toBeNull();
  });
});
