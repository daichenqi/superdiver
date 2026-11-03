# HD2 击杀卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个本地单页：选定可选配装和一名敌人，并可选天气与阴霾，按设计说明算出击杀卡。

**Architecture:** 结算是纯函数，只吃已经规范化的 JSON。导入脚本把 HD2Tool 目录和 wiki 补充字段收成那份 JSON。Vite 页面负责选择、调用结算、缓存星球；开发服务器把 `/hd2-api` 转到 `api.helldivers2.dev`。

**Tech Stack:** Vite 6、TypeScript 5、Vitest 3。无 React。运行时不请求 wiki。

## Global Constraints

- 配装空位：主武器、副武器、手雷、支援武器、最多四个战略；每格可空。
- 一件都不选时仍给弱点、伤害类型和一句打法，不出现「你的装备」。
- 敌人是导入结果中的全部《绝地潜兵 2》单位；排除阵营 `Cyborg Legion`。
- 单发顺序：酸雨把护甲减 1（最低 0）→ 取该档穿甲 → 衰减乘到两种伤害 → 高于满伤、相等 ×0.65、低于为 0 → 耐久混合 → 只向下取整一次。
- 发数是 `ceil(部位生命 / 单发伤害)`。单发为 0、没有部位生命、或护甲不是 0 到 10 的整数时不写发数；非法护甲视为打不穿。
- 入射角：小于 25°、26°–60°、61°–80°、81°–90°。只有一个穿甲值时四档共用，条件里不写入射角。
- 投射物衰减：`D = 0.0004712389 × size² × Cd / mass`，`Lp = 1 − 0.75 × (1 − e^(−2 × D × x))`。`Cd` 为 0 时倍率为 1。距离点是 0、25、50 米。缺弹道则不写距离行，主句按倍率 1。
- 爆炸内圈不衰减、不减穿甲。外圈穿甲减 1（最低 0）。中点 `x = 0.5`：慢衰减 `1 − x²`，快衰减 `1 − x`。
- 验算点：内圈 10、外圈 25、距离 20 时，`x = 2/3`，快衰减 1/3，慢衰减 5/9，外圈穿甲减 1。
- 穿透表只有无甲和极轻。耐久 0–24% / 25–75% / 76–100% 的门槛：无甲是 2、3、4；极轻是 4、5、5。通过后下一部位穿甲再减 2、3、4。其他等级不写穿透行。
- 可打碎外甲：同一发打到内部要同时满足穿甲 ≥ 3 × 护甲和穿透表。否则发数 = 打碎外甲的发数 + 内部的发数。
- 爆炸对主生命只结算一次，取单个最合适部位。
- 穿透速度损失不乘进伤害。
- 条件行只在打不穿、发数或能否打到后一部位相对主句发生变化时出现。
- 离子风暴：主武器、副武器、手雷算手上的；支援武器和战略算需要呼叫，排在后面。
- 严寒射速 ×0.9，热量冷却 ×2/3。炎热热量冷却 ×4/3。火焰龙卷套用炎热，冷却只乘一次。
- 射速字段是每分钟发数。秒数 = `发数 / (每分钟发数 / 60 × 0.9)`。没有基础冷却秒数时只写倍率。
- 阴霾：无和轻不写；中度鹰式再装填 +20%；重和源头 +30%，拾取弹药减半；源头另写增援 −20%。有鹰式战略才写再装填。
- 能见度和地震不改发数。岩浆、陨石、龙卷火焰不计入发数。
- 同一字段冲突时计算用 wiki，依据并列两个值。
- 界面中文、纯文本，不打包游戏图片。
- 请求头固定 `X-Super-Client: hd2-kill-card`。
- 耐久在模型里用 0 到 1 的小数。30% 写成 `0.3`。

---

### Task 1: 项目骨架和单发伤害

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/model.ts`
- Create: `src/shot.ts`
- Create: `src/shot.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `shotDamage(attack: AttackProfile, part: Part, ctx: ShotContext): ShotResult`，以及 `model.ts` 里的 `AttackProfile`、`Part`、`ShotContext`、`ShotResult`、`projectileFalloff`、`explosionFalloff`

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/shot.test.ts`

Expected: FAIL，`shotDamage` 未定义。先写下面三个配置文件再跑；若 `npm` 不存在则先安装 Node 依赖。

`package.json`

```json
{
  "name": "hd2-kill-card",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "build": "tsc --noEmit && vite build"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vite": "^6.2.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Run: `npm install`

- [ ] **Step 3: 写最小实现**

`src/model.ts`

```ts
export type AngleBand = "front" | "slight" | "large" | "extreme";
export type Slot = "primary" | "secondary" | "grenade" | "support" | "stratagem";
export type Weather =
  | "acid-storms"
  | "blizzards"
  | "extreme-cold"
  | "fire-tornados"
  | "intense-heat"
  | "ion-storms"
  | "meteor-storms"
  | "rainstorms"
  | "sandstorms"
  | "thick-fog"
  | "tremors"
  | "volcanic-activity";
export type Gloom = "none" | "light" | "moderate" | "heavy" | "source";

export interface AttackProfile {
  id: string;
  label: string;
  kind: "projectile" | "explosion" | "beam";
  aimed: boolean;
  ap: { front: number; slight?: number; large?: number; extreme?: number };
  standardDamage: number;
  durableDamage?: number;
  heat: boolean;
  roundsPerMinute?: number;
  cooldownSeconds?: number;
  ballistics?: { sizeMm: number; massG: number; drag: number };
  explosion?: { innerRadius: number; outerRadius: number; falloff: "slow" | "quick" };
  beam?: { falloffStart: number; range: number; maxFalloff: number };
}

export interface GearPiece {
  id: string;
  name: string;
  slot: Slot;
  order: number;
  requiresCall: boolean;
  eagle: boolean;
  attacks: AttackProfile[];
  missingCombatData?: boolean;
}

export interface Part {
  id: string;
  name: string;
  armor: number;
  health?: number;
  durability?: number;
  fatal: boolean;
  breakable: boolean;
  behindId?: string;
}

export interface Enemy {
  id: string;
  name: string;
  faction: string;
  health?: number;
  wikiUrl?: string;
  multipliers: { fire?: number; arc?: number; acid?: number; gas?: number };
  parts: Part[];
}

export interface Situation {
  weather: Weather[];
  gloom: Gloom;
  unknownHazards?: string[];
  cachedAt?: string;
}

export interface ShotContext {
  angle: AngleBand;
  distanceM: number;
  zone: "inner" | "outer";
  acid: boolean;
}

export interface ShotResult {
  damage: number;
  penetrates: boolean;
  apUsed: number;
  armorUsed: number;
  falloff: number;
  missingBallistics: boolean;
}
```

`src/shot.ts`

```ts
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
  const mixed =
    part.durability === undefined || attack.durableDamage === undefined
      ? standard
      : standard * (1 - part.durability) + attack.durableDamage * falloff * factor * part.durability;
  return {
    damage: Math.floor(mixed),
    penetrates: factor > 0,
    apUsed,
    armorUsed,
    falloff,
    missingBallistics,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/shot.test.ts`

Expected: PASS，6 个测试。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/model.ts src/shot.ts src/shot.test.ts
git commit -m "feat: add single-shot damage rules"
```

### Task 2: 穿透和外甲

**Files:**
- Create: `src/cleave.ts`
- Create: `src/cleave.test.ts`

**Interfaces:**
- Consumes: `Part.armor`、`Part.durability`，数值穿甲
- Produces: `cleaveThrough(armor: number, durability: number | undefined, ap: number): number | null`。返回下一部位可用穿甲；不能穿或没有公开行时返回 `null`。`sameShotThroughPlating(armor: number, durability: number | undefined, ap: number): boolean`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { cleaveThrough, sameShotThroughPlating } from "./cleave";

describe("cleaveThrough", () => {
  it("requires ap 4 on unarmored 80 percent durable and then subtracts 4", () => {
    expect(cleaveThrough(0, 0.8, 4)).toBe(0);
    expect(cleaveThrough(0, 0.8, 3)).toBeNull();
  });

  it("does not invent rows for light armor and above", () => {
    expect(cleaveThrough(2, 0, 10)).toBeNull();
    expect(cleaveThrough(3, 0, 10)).toBeNull();
    expect(cleaveThrough(4, 0, 10)).toBeNull();
    expect(cleaveThrough(5, 0, 10)).toBeNull();
  });

  it("uses the very-light row", () => {
    expect(cleaveThrough(1, 0.1, 4)).toBe(2);
    expect(cleaveThrough(1, 0.5, 4)).toBeNull();
    expect(cleaveThrough(1, 0.9, 5)).toBe(1);
  });

  it("lets a same shot pass plating only when both gates pass", () => {
    expect(sameShotThroughPlating(0, 0.1, 2)).toBe(true);
    expect(sameShotThroughPlating(1, 0.1, 3)).toBe(false);
    expect(sameShotThroughPlating(1, 0.1, 4)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/cleave.test.ts`

Expected: FAIL，`cleaveThrough` 未定义。

- [ ] **Step 3: 写最小实现**

`src/cleave.ts`

```ts
const TABLE: Record<number, [number, number, number]> = {
  0: [2, 3, 4],
  1: [4, 5, 5],
};

function band(durability: number): 0 | 1 | 2 {
  if (durability <= 0.24) return 0;
  if (durability <= 0.75) return 1;
  return 2;
}

export function cleaveThrough(armor: number, durability: number | undefined, ap: number): number | null {
  if (durability === undefined) return null;
  const row = TABLE[armor];
  if (!row) return null;
  const index = band(durability);
  if (ap < row[index]) return null;
  return ap - [2, 3, 4][index];
}

export function sameShotThroughPlating(armor: number, durability: number | undefined, ap: number): boolean {
  return ap >= armor * 3 && cleaveThrough(armor, durability, ap) !== null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/cleave.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/cleave.ts src/cleave.test.ts
git commit -m "feat: add cleave and plating gates"
```

### Task 3: 击杀卡

**Files:**
- Create: `src/assess.ts`
- Create: `src/assess.test.ts`

**Interfaces:**
- Consumes: `shotDamage`、`cleaveThrough`、`sameShotThroughPlating`、`sharesOneAp`、`Enemy`、`GearPiece`、`Situation`
- Produces: `assess(enemy: Enemy, gear: GearPiece[], situation: Situation, meta?: { importedAt?: string; conflicts?: string[] }): KillCard`

`KillCard` 的字段固定为：

```ts
export interface KillCard {
  method: string;
  conditions: string[];
  environment: string[];
  damageTypes: { type: "fire" | "arc" | "acid" | "gas"; label: "更有效" | "抗性" | "免疫" }[];
  weakPoints: { name: string; armor: number; fatal: boolean; durability?: number; note?: string }[];
  gear: { name: string; component: string; target?: string; reason: string; shots?: number }[];
  blockedCount: number;
  missing: string[];
  conflicts: string[];
  wikiUrl?: string;
  importedAt?: string;
}
```

- [ ] **Step 1: 写失败测试**

`src/assess.test.ts` 覆盖设计说明里的第 3、6、7、8、9、10 条，以及空部位和打不穿计数。用下面的夹具，断言写在每个 `it` 里，不要改成快照。

```ts
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
    { id: "flesh", name: "腿肉", armor: 1, health: 200, durability: 0, fatal: true, breakable: false },
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/assess.test.ts`

Expected: FAIL，`assess` 未定义。

- [ ] **Step 3: 写实现**

`src/assess.ts` 实现 `assess`。规则：

1. `acid = situation.weather.includes("acid-storms")`。主句情景是 `{ angle: "front", distanceM: 0, zone: "inner", acid }`。
2. 对每个可瞄准组件和每个部位调用 `shotDamage`。部位有 `behindId` 时：先算当前部位；`sameShotThroughPlating` 为真，或非外甲且 `cleaveThrough` 返回数字时，后一部位用减去消耗后的穿甲再算一次，`cleaves` 为真。外甲两道不都通过时，`shots = ceil(外甲生命 / 外甲单发) + ceil(内部生命 / 内部单发)`，内部那一发用原始穿甲、不穿透消耗。单发为 0 的那一段不产生发数。
3. 爆炸组件不指定部位。对每个部位算内圈；发数取能打穿的致命部位里最少的，没有致命部位就取能打穿里最少的。`target` 留空。外圈用半径中点 `(inner + outer) / 2`，只有打不穿状态或发数变了才进条件。
4. 条件情景：另外三个角度、投射物 25 米和 50 米（有 `ballistics` 才算）、光束 `beam.range`、酸雨主句再算一遍 `acid: false`。用「打得穿、发数、cleaves」比较，变了才 push 一行中文：`61°–80°：打不穿` 或 `25 米：大约 N 发` 或 `酸雨结束：大约 N 发`。只有一个穿甲值时不生成角度行。
5. 排序按 Global Constraints 的离子风暴分组和四条比较。`missingCombatData` 或 `attacks.length === 0` 的不进 `gear`，写进 `missing`：`缺少战斗数据：名称`。打不穿且没进前三的数量放进 `blockedCount`。`gear` 最多 3 条。
6. 弱点最多 3 个：致命优先，护甲升序，生命升序。护甲用酸雨后的值。`breakable` 的 `note` 为 `先打碎外甲，伤害不进里面`。`parts.length === 0` 时 `weakPoints` 为空，`missing` 含 `部位暂缺`。
7. 伤害类型按倍率：`> 1` 更有效，`=== 0` 免疫，`(0, 1)` 抗性，等于 1 或缺失不写。顺序固定火、电弧、酸、气体。
8. 环境行按这个表生成，能见度和地震不改发数。炎热与火焰龙卷同时存在时，`热量冷却变为 4/3` 只出现一次。中度阴霾只在配装有 `eagle` 时写再装填；重和源头始终写弹药，再装填仍只在有鹰式时写。

| 条件 | 环境行 |
| --- | --- |
| 酸雨 | `酸雨：护甲减 1` |
| 严寒 | `严寒：射速按 90%`。该装备有 `roundsPerMinute` 且有发数时，`reason` 追加 `，大约 X 秒`，`X = 发数 / (每分钟发数 / 60 × 0.9)`，保留一位小数 |
| 炎热或火焰龙卷 | `热量冷却变为 4/3` |
| 火焰龙卷 | 另加 `火焰龙卷：敌人视野下降` |
| 离子风暴 | `离子风暴：不能新呼叫战略` |
| 暴风雪 | `暴风雪：能见度中等下降` |
| 沙尘暴 | `沙尘暴：能见度大幅下降` |
| 暴雨 | `暴雨：能见度下降` |
| 浓雾 | `浓雾：能见度轻微下降` |
| 地震 | `地震：瞄准会被震停` |
| 岩浆 | `岩浆：场上有额外伤害，不计入发数` |
| 陨石 | `陨石：场上有额外伤害，不计入发数` |
| 阴霾中，且有鹰式 | `中度阴霾：鹰式再装填加 20%` |
| 阴霾重 | `重度阴霾：拾取弹药减半`；有鹰式时把再装填加进同一句：`重度阴霾：鹰式再装填加 30%，拾取弹药减半` |
| 阴霾源头 | 与重相同，句末再加 `，增援数减 20%` |

`unknownHazards` 的原始字符串各占一行。`cachedAt` 存在时加 `星球数据缓存于 <cachedAt>`。
9. `method`：有装备时用排序后的第一件，`用步枪的直击打头，大约 N 发`。没有发数就省略后半句。离子风暴且第一件 `requiresCall` 时句末加 `，风暴间歇才能呼叫`。没装备时用第一个弱点：`打头。火焰更有效。` 没有弱点时：`部位暂缺。总生命 1000。`
10. `conflicts` 和 `importedAt` 从 `meta` 原样抄到卡片。`wikiUrl` 从敌人抄。

发数公式和中文标点用全角逗号 `，`。不要把 25 米写进主句。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`

Expected: PASS，`shot`、`cleave`、`assess` 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/assess.ts src/assess.test.ts
git commit -m "feat: build the kill card from shot and cleave rules"
```

### Task 4: 目录导入

**Files:**
- Create: `src/import-catalog.ts`
- Create: `src/import-catalog.test.ts`
- Create: `scripts/import.ts`
- Create: `data/equipment.json`
- Create: `data/enemies.json`
- Create: `data/environment.json`
- Create: `data/part-names.zh.json`
- Create: `data/meta.json`

**Interfaces:**
- Consumes: HD2Tool 条目形状 `{ id, productKind, model, nameZh, nameEn, weaponType?, wiki?, combat?: { components: { id, type, label, fields: { standardDamage?, durableDamage?, armorPenetration?: { value } } }[] }, handling?: { fireRate? }, deployment?: { cooldownSeconds?, type? } }`
- Produces: `toGear(items: CatalogItem[], extras: Record<string, WikiExtra>, aliases: Record<string, string[]>): GearPiece[]`，以及 `filterEnemies(enemies: Enemy[]): Enemy[]`。`WikiExtra` 为 `{ ap?: AttackProfile["ap"]; ballistics?: AttackProfile["ballistics"]; explosion?: AttackProfile["explosion"]; beam?: AttackProfile["beam"]; conflicts?: string[] }`，键是装备 `id`。没有 `standardDamage` 或没有穿甲值的组件丢弃。

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/import-catalog.test.ts`

Expected: FAIL，`toGear` 未定义。

- [ ] **Step 3: 写实现和种子数据**

`toGear` 规则：

- `primary-weapon` → `primary`，`secondary-weapon` → `secondary`，`grenade` → `grenade`，都不需要呼叫。
- `support-weapon` → `support`，`requiresCall: true`。
- 其他 `productKind` → `stratagem`，`requiresCall: true`。
- `heat`：`weaponType` 匹配 `/energy|laser|heat/i`，或组件 `type` 为 `beam`。
- `eagle`：`nameEn` 或 `deployment.type` 匹配 `/eagle/i`。
- 组件 `type` 为 `explosion` 时 `kind` 为 `explosion` 且 `aimed` 为 false；`beam` 时 `kind` 为 `beam`；其余 `projectile` 且 `aimed` 为 true。
- 有 `extras[id].ap` 时用它，否则 `{ front: armorPenetration.value }`。没有穿甲值则该组件丢弃。全部组件丢弃时 `missingCombatData: true`，`attacks` 为空。
- `roundsPerMinute` 来自 `handling.fireRate`。`cooldownSeconds` 来自 `deployment.cooldownSeconds`。
- 名称用 `nameZh`，没有则用 `nameEn`。别名不进 `GearPiece`；搜索在页面里另读 `data/aliases.json`。本任务把别名写入 `data/aliases.json`，测试只检查函数不读盘。
- 冲突字符串不进 `GearPiece`。`scripts/import.ts` 把 `extras[id].conflicts` 收集进 `data/meta.json` 的 `conflicts` 数组，格式 `id:字段`。

`scripts/import.ts` 用 `node --experimental-strip-types` 跑。它读取 `data/raw/catalog.json` 和可选的 `data/raw/extras.json`、`data/raw/aliases.json`、`data/raw/enemies.json`。文件缺失时打印该文件名并退出码 1，不覆盖已有 `data/equipment.json`。成功时写 `equipment.json`、`aliases.json`、`meta.json`。`enemies.json` 只在 raw 存在时覆盖。

种子 `data/enemies.json` 放 Task 3 的冲锋虫，再加一个没有部位的敌人 `{ id: "scavenger", name: "拾荒者", faction: "Terminids", health: 80, multipliers: {}, parts: [] }`。`data/equipment.json` 放 Task 3 的步枪。`data/environment.json`：

```json
{
  "hazards": {
    "acid storms": "acid-storms",
    "blizzards": "blizzards",
    "extreme cold": "extreme-cold",
    "fire tornados": "fire-tornados",
    "intense heat": "intense-heat",
    "ion storms": "ion-storms",
    "meteor storms": "meteor-storms",
    "rainstorms": "rainstorms",
    "sandstorms": "sandstorms",
    "thick fog": "thick-fog",
    "tremors": "tremors",
    "volcanic activity": "volcanic-activity"
  },
  "gloom": {}
}
```

`data/part-names.zh.json` 的键用英文小写：`head` 头、`leg` 腿、`butt` 臀、`torso` 躯干、`body` 躯干、`arm` 臂、`heatsink` 散热口、`flesh` 肉、`sac` 囊、`tail` 尾、`wing` 翼、`eye` 眼、`mouth` 口、`abdomen` 腹部。

`data/meta.json`：`{ "importedAt": "2026-11-03", "conflicts": [], "sources": ["HD2Tool catalog", "helldivers.wiki.gg"] }`

`data/aliases.json`：`{}`

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/import-catalog.ts src/import-catalog.test.ts scripts/import.ts data
git commit -m "feat: map the equipment catalog into kill-card gear"
```

### Task 5: 页面、星球接口和声明

**Files:**
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `src/main.ts`
- Create: `src/planets.ts`
- Create: `src/planets.test.ts`
- Create: `src/vite-env.d.ts`
- Create: `NOTICE`

**Interfaces:**
- Consumes: `assess`、`GearPiece`、`Enemy`、`Situation`、`data/environment.json` 的 `hazards` 与 `gloom`
- Produces: `mapPlanet(planet: { name: string; hazards?: { name: string }[] }, tables: { hazards: Record<string, string>; gloom: Record<string, "light" | "moderate" | "heavy" | "source"> }): { weather: Weather[]; gloom: Gloom; unknownHazards: string[] }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { mapPlanet } from "./planets";

const tables = {
  hazards: { "ion storms": "ion-storms", "acid storms": "acid-storms" } as Record<string, "ion-storms" | "acid-storms">,
  gloom: { Hellmire: "heavy" as const },
};

describe("mapPlanet", () => {
  it("maps known hazards and gloom, and keeps unknown names", () => {
    const mapped = mapPlanet(
      { name: "Hellmire", hazards: [{ name: "Ion Storms" }, { name: "Spore Geysers" }] },
      tables,
    );
    expect(mapped.weather).toEqual(["ion-storms"]);
    expect(mapped.gloom).toBe("heavy");
    expect(mapped.unknownHazards).toEqual(["Spore Geysers"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/planets.test.ts`

Expected: FAIL，`mapPlanet` 未定义。

- [ ] **Step 3: 写实现**

`src/planets.ts`：`name` 先 trim 再查 `gloom`。每个 hazard 的 `name.trim().toLowerCase()` 查 `hazards`；命中才推进 `weather`，不重复。未命中推进 `unknownHazards`，保留原始字符串。没有阴霾记录时 `gloom` 为 `none`。

`src/main.ts`：

- `fetch("/data/equipment.json")`、`enemies.json`、`aliases.json`、`environment.json`、`meta.json`。Vite 用 `public` 目录提供静态文件，所以把 `data` 复制到 `public/data` 不作为第二份来源；`vite.config.ts` 里用 `server.fs` 不必改。改为把 JSON 放在 `public/data`，导入脚本同时写 `data/` 和 `public/data/`。Task 4 的种子也复制到 `public/data`。
- 五个 `<select>` 加一个「空」选项。战略用四个 select。敌人一个 select，前面有文本搜索，按名称、id 过滤。
- 环境下拉先有「不指定」。手动区是 12 个天气 checkbox 和一个阴霾 select：无、轻、中、重、源头。选了星球后，勾选被星球结果替换；再手动改动则不再标成该星球。
- 点「读取星球」时 `fetch("/hd2-api/api/v1/planets", { headers: { "X-Super-Client": "hd2-kill-card" } })`。成功则把 `{ fetchedAt, planets: [{ name, hazards }] }` 写入 `localStorage` 键 `hd2-kill-planets`，并填星球下拉。失败则读该键；仍失败则只留手动环境。
- 配装、敌人 id、手动天气写入 `hd2-kill-selection`。
- 选中敌人后调用 `assess`，把 `method`、`conditions`、`environment`、`damageTypes`、`weakPoints`、`gear`、`blockedCount`、`missing`、`conflicts`、`wikiUrl`、`importedAt` 画成卡片。依据放在 `<details>`。没选敌人时卡片只写 `先选一个敌人`。
- `blockedCount > 0` 时写 `打不穿：N`。

`vite.config.ts`

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/hd2-api": {
        target: "https://api.helldivers2.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hd2-api/, ""),
        headers: { "X-Super-Client": "hd2-kill-card" },
      },
    },
  },
});
```

`index.html` 标题为 `击杀卡`，根节点 `<div id="app"></div>`，脚本 `/src/main.ts`。

`NOTICE` 写明：装备中文名和目录字段来自 HD2Tool；战斗部位、穿甲表、衰减公式和天气效果来自 helldivers.wiki.gg；实时星球来自 api.helldivers2.dev。游戏名称、商标和图片不在本仓库代码许可内。与 Arrowhead、Sony、PlayStation 无隶属关系。

- [ ] **Step 4: 跑测试和构建**

Run: `npm test && npm run build`

Expected: 测试 PASS，`tsc --noEmit` 和 `vite build` 成功。

- [ ] **Step 5: Commit**

```bash
git add index.html vite.config.ts src/main.ts src/planets.ts src/planets.test.ts src/vite-env.d.ts public/data NOTICE
git commit -m "feat: show the kill card and load planet hazards"
```
