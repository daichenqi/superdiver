import { cleaveThrough, sameShotThroughPlating } from "./cleave";
import type { AngleBand, AttackProfile, Enemy, GearPiece, Part, ShotContext, Situation, Slot } from "./model";
import { sharesOneAp, shotDamage } from "./shot";

export interface KillCard {
  method: string;
  conditions: string[];
  environment: string[];
  damageTypes: { type: "fire" | "arc" | "acid" | "gas"; label: "更有效" | "抗性" | "免疫" }[];
  weakPoints: { name: string; armor: number; fatal: boolean; durability?: number; note?: string }[];
  locations: { name: string; detail: string }[];
  gear: { name: string; component: string; target?: string; reason: string; shots?: number }[];
  blockedCount: number;
  missing: string[];
  rules: string[];
  conflicts: string[];
  wikiUrl?: string;
  importedAt?: string;
}

interface Verdict {
  penetrates: boolean;
  shots?: number;
  cleaves: boolean;
  damage: number;
  fatal: boolean;
  target?: string;
  partId?: string;
  missingBallistics: boolean;
  equalPen?: boolean;
  plateShots?: number;
  innerName?: string;
  innerShots?: number;
  innerBlocked?: boolean;
  bundle?: string;
  explosionImmune?: boolean;
  explosionResist?: number;
}

interface Rated {
  piece: GearPiece;
  attack: AttackProfile;
  verdict: Verdict;
}

const SLOT_ORDER: Record<Slot, number> = {
  primary: 0,
  secondary: 1,
  grenade: 2,
  support: 3,
  stratagem: 4,
};

const DAMAGE_ORDER = ["fire", "arc", "acid", "gas"] as const;

const DAMAGE_WORD: Record<(typeof DAMAGE_ORDER)[number], string> = {
  fire: "火焰",
  arc: "电弧",
  acid: "酸液",
  gas: "气体",
};

const COMPONENT_ZH: Record<string, string> = {
  Ballistic: "实弹",
  Explosion: "爆炸",
  explosion: "爆炸",
  projectile: "投射物",
  "Impact Explosion": "冲击爆炸",
  Fire: "火焰",
  Melee: "近战",
  Gas: "气体",
  Laser: "激光",
  Arc: "电弧",
  spray: "喷射",
  Direct: "直击",
  Beam: "光束",
  ballistic: "实弹",
  beam: "光束",
  laser: "激光",
  arc: "电弧",
  fire: "火焰",
  gas: "气体",
  melee: "近战",
};

function componentName(label: string): string {
  const titled = label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
  return COMPONENT_ZH[label] ?? COMPONENT_ZH[label.toLowerCase()] ?? COMPONENT_ZH[titled] ?? label;
}

function attackTitle(attack: AttackProfile): string {
  const name = componentName(attack.label);
  return attack.mode ? `${name}（${attack.mode}）` : name;
}

const ANGLES: { angle: AngleBand; label: string }[] = [
  { angle: "slight", label: "26°\u201360°" },
  { angle: "large", label: "61°\u201380°" },
  { angle: "extreme", label: "81°\u201390°" },
];

function pushUnique(lines: string[], line: string): void {
  if (!lines.includes(line)) lines.push(line);
}

function ceilShots(health: number | undefined, damage: number): number | undefined {
  if (health === undefined || !(damage > 0)) return undefined;
  return Math.ceil(health / damage);
}

function compareOutcome(a: Verdict, b: Verdict): number {
  if (a.fatal !== b.fatal) return a.fatal ? -1 : 1;
  if ((a.shots === undefined) !== (b.shots === undefined)) return a.shots === undefined ? 1 : -1;
  if (a.shots !== undefined && b.shots !== undefined && a.shots !== b.shots) return a.shots - b.shots;
  if (a.damage !== b.damage) return b.damage - a.damage;
  return 0;
}

function emptyVerdict(): Verdict {
  return { penetrates: false, cleaves: false, damage: 0, fatal: false, missingBallistics: false };
}

function attackAtAp(attack: AttackProfile, ap: number): AttackProfile {
  return { ...attack, ap: { front: ap, slight: ap, large: ap, extreme: ap } };
}

function aimedVerdict(
  attack: AttackProfile,
  part: Part,
  ctx: ShotContext,
  byId: Map<string, Part>,
  missing: string[],
  recordMissing: boolean,
): Verdict {
  if (recordMissing && part.durability === undefined) pushUnique(missing, `缺少耐久：${part.name}`);
  const shot = shotDamage(attack, part, ctx);
  const plain: Verdict = {
    penetrates: shot.penetrates,
    shots: shot.penetrates ? ceilShots(part.health, shot.damage) : undefined,
    cleaves: false,
    damage: shot.damage,
    fatal: part.fatal && shot.penetrates,
    target: part.name,
    partId: part.id,
    missingBallistics: shot.missingBallistics,
    equalPen: shot.penetrates && shot.apUsed === shot.armorUsed,
    ...(shot.explosionImmune ? { explosionImmune: true } : {}),
    ...(shot.explosionResist !== undefined ? { explosionResist: shot.explosionResist } : {}),
  };
  if (!part.behindId) return plain;

  const behind = byId.get(part.behindId);
  if (!behind) {
    if (recordMissing) pushUnique(missing, `缺少后一部位：${part.name}`);
    return plain;
  }
  if (!shot.penetrates) return plain;

  const reduced = cleaveThrough(shot.armorUsed, part.durability, shot.apUsed);
  const plating = sameShotThroughPlating(shot.armorUsed, part.durability, shot.apUsed);
  if (plating || (!part.breakable && reduced !== null)) {
    if (recordMissing && behind.durability === undefined) pushUnique(missing, `缺少耐久：${behind.name}`);
    const next = shotDamage(attackAtAp(attack, reduced ?? 0), behind, ctx);
    const behindKill = behind.fatal && next.penetrates;
    const frontShots = ceilShots(part.health, shot.damage);
    const behindShots = ceilShots(behind.health, next.damage);
    let shots = frontShots;
    if (behindKill && part.fatal) {
      shots = frontShots !== undefined && behindShots !== undefined ? Math.max(frontShots, behindShots) : undefined;
    } else if (behindKill) {
      shots = behindShots;
    }
    return {
      penetrates: true,
      shots,
      cleaves: true,
      damage: behindKill ? next.damage : shot.damage,
      fatal: part.fatal || behindKill,
      target: part.name,
      partId: part.id,
      missingBallistics: shot.missingBallistics || next.missingBallistics,
      equalPen: shot.apUsed === shot.armorUsed,
      innerName: behind.name,
      innerBlocked: !next.penetrates,
    };
  }

  if (part.breakable) {
    if (recordMissing && behind.durability === undefined) pushUnique(missing, `缺少耐久：${behind.name}`);
    const inner = shotDamage(attack, behind, ctx);
    const outerShots = ceilShots(part.health, shot.damage);
    const innerShots = ceilShots(behind.health, inner.damage);
    const innerHits = inner.penetrates && inner.damage > 0;
    const shots =
      outerShots !== undefined && innerShots !== undefined ? outerShots + innerShots : undefined;
    return {
      penetrates: true,
      shots,
      cleaves: false,
      damage: shot.damage,
      fatal: part.fatal || (behind.fatal && innerHits),
      target: part.name,
      partId: part.id,
      missingBallistics: shot.missingBallistics || inner.missingBallistics,
      equalPen: shot.apUsed === shot.armorUsed,
      plateShots: outerShots,
      innerName: behind.name,
      innerShots: innerHits ? innerShots : undefined,
      innerBlocked: !innerHits,
    };
  }

  return plain;
}

function bestAimed(
  attack: AttackProfile,
  parts: Part[],
  ctx: ShotContext,
  byId: Map<string, Part>,
  missing: string[],
  recordMissing: boolean,
): Verdict {
  if (parts.length === 0) return emptyVerdict();
  let best = aimedVerdict(attack, parts[0], ctx, byId, missing, recordMissing);
  for (const part of parts.slice(1)) {
    const verdict = aimedVerdict(attack, part, ctx, byId, missing, recordMissing);
    if (compareOutcome(verdict, best) < 0) best = verdict;
  }
  return best;
}

function explosionVerdict(
  attack: AttackProfile,
  parts: Part[],
  ctx: ShotContext,
  missing: string[] = [],
  recordMissing = false,
): Verdict {
  if (parts.length === 0) return emptyVerdict();
  const rows = parts.map((part) => {
    if (recordMissing && part.durability === undefined) pushUnique(missing, `缺少耐久：${part.name}`);
    const shot = shotDamage(attack, part, ctx);
    return {
      part,
      shot,
      shots: shot.penetrates ? ceilShots(part.health, shot.damage) : undefined,
    };
  });
  const penetrating = rows.filter((row) => row.shot.penetrates);
  if (penetrating.length === 0) {
    return {
      penetrates: false,
      cleaves: false,
      damage: 0,
      fatal: false,
      missingBallistics: rows.some((row) => row.shot.missingBallistics),
      ...(rows.length > 0 && rows.every((row) => row.shot.explosionImmune) ? { explosionImmune: true } : {}),
    };
  }
  const fatalRows = penetrating.filter((row) => row.part.fatal);
  const pool = fatalRows.length > 0 ? fatalRows : penetrating;
  let best = pool[0];
  for (const row of pool.slice(1)) {
    const rowShotsMissing = row.shots === undefined;
    const bestShotsMissing = best.shots === undefined;
    if (rowShotsMissing !== bestShotsMissing) {
      if (!rowShotsMissing) best = row;
      continue;
    }
    if (row.shots !== undefined && best.shots !== undefined && row.shots !== best.shots) {
      if (row.shots < best.shots) best = row;
      continue;
    }
    if (row.shot.damage > best.shot.damage) best = row;
  }
  return {
    penetrates: true,
    shots: best.shots,
    cleaves: false,
    damage: best.shot.damage,
    fatal: best.part.fatal,
    missingBallistics: rows.some((row) => row.shot.missingBallistics),
    ...(best.shot.explosionResist !== undefined ? { explosionResist: best.shot.explosionResist } : {}),
  };
}

function rateAttack(
  attack: AttackProfile,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
  missing: string[],
  recordMissing: boolean,
): Verdict {
  if (attack.kind === "explosion") return explosionVerdict(attack, enemy.parts, ctx, missing, recordMissing);
  return bestAimed(attack, enemy.parts, ctx, byId, missing, recordMissing);
}

function verdictAt(
  attacks: AttackProfile[],
  verdict: Verdict,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
): Verdict {
  if (attacks.length > 1) {
    const part = enemy.parts.find((item) => item.id === verdict.partId);
    return part ? salvoAt(attacks, part, ctx) : emptyVerdict();
  }
  const attack = attacks[0];
  if (!attack) return emptyVerdict();
  if (attack.kind === "explosion") return explosionVerdict(attack, enemy.parts, ctx);
  const part = enemy.parts.find((item) => item.id === verdict.partId);
  if (!part) return emptyVerdict();
  return aimedVerdict(attack, part, ctx, byId, [], false);
}

function changed(main: Verdict, next: Verdict): boolean {
  return main.penetrates !== next.penetrates || main.shots !== next.shots || main.cleaves !== next.cleaves;
}

function aftermath(part: Part): string {
  const bits: string[] = [];
  if (part.percentToMain !== undefined && part.percentToMain > 0) {
    const percent = part.percentToMain * 100;
    const shown = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
    bits.push(`${shown}% 进主体`);
  }
  const broken = bleedNote(part, true);
  if (broken) bits.push(broken);
  return bits.length > 0 ? `。${bits.join("，")}` : "";
}

function bleedNote(part: Part, opened: boolean): string {
  if (part.bleed === undefined || !(part.bleed > 0)) return "";
  const amount = part.bleedPerSecond ? `主体掉 ${part.bleed}，每秒 ${part.bleedPerSecond}` : `主体掉 ${part.bleed}`;
  return opened ? `打碎后${amount}` : `若打碎，${amount}`;
}

function resistanceNote(verdict: Verdict): string {
  const bits: string[] = [];
  if (verdict.explosionImmune) bits.push("爆炸免疫");
  if (verdict.explosionResist !== undefined && verdict.explosionResist > 0 && verdict.explosionResist < 1) {
    const percent = verdict.explosionResist * 100;
    const shown = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
    bits.push(`爆炸抗性 ${shown}%`);
  }
  return bits.join("，");
}

function locationDetail(verdict: Verdict, part: Part): string {
  const note = resistanceNote(verdict);
  const finish = (text: string) => {
    const withBundle = verdict.bundle ? `${text}，${verdict.bundle}` : text;
    return note ? `${withBundle}，${note}` : withBundle;
  };
  if (!verdict.penetrates) {
    const broken = bleedNote(part, false);
    const head = note ? `打不穿，${note}` : "打不穿";
    return broken ? `${head}。${broken}` : head;
  }
  const equal = verdict.equalPen ? "同级穿甲，" : "";
  const after = aftermath(part);
  if (verdict.innerName && !verdict.cleaves) {
    const plate = verdict.plateShots !== undefined ? `先打碎外甲 ${verdict.plateShots} 发` : "先打碎外甲";
    const inner = verdict.innerBlocked
      ? `${verdict.innerName}打不穿`
      : verdict.innerShots !== undefined
        ? `再打${verdict.innerName} ${verdict.innerShots} 发`
        : `再打${verdict.innerName}`;
    return finish(`${equal}${plate}，${inner}${after}`);
  }
  if (verdict.cleaves && verdict.innerName && verdict.innerBlocked) {
    if (verdict.shots !== undefined) return finish(`${equal}大约 ${verdict.shots} 发，${verdict.innerName}打不穿${after}`);
    return finish(`${equal}${verdict.innerName}打不穿${after}`);
  }
  if (verdict.cleaves && verdict.innerName) {
    if (verdict.shots !== undefined) return finish(`${equal}打进${verdict.innerName}，大约 ${verdict.shots} 发${after}`);
    return finish(`${equal}打进${verdict.innerName}${after}`);
  }
  if (verdict.shots !== undefined) return finish(`${equal}大约 ${verdict.shots} 发${after}`);
  return finish(`${equal}打得穿${after}`);
}

function listLocations(
  attacks: AttackProfile[],
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
): KillCard["locations"] {
  return enemy.parts
    .map((part, index) => ({
      part,
      index,
      verdict: attacks.length > 1 ? salvoAt(attacks, part, ctx) : aimedVerdict(attacks[0], part, ctx, byId, [], false),
    }))
    .sort((a, b) => compareOutcome(a.verdict, b.verdict) || a.index - b.index)
    .map(({ part, verdict }) => ({ name: part.name, detail: locationDetail(verdict, part) }));
}

function conditionLine(label: string, verdict: Verdict): string {
  if (!verdict.penetrates) {
    const note = resistanceNote(verdict);
    return `${label}：${note ? `打不穿，${note}` : "打不穿"}`;
  }
  if (verdict.shots !== undefined) return `${label}：大约 ${verdict.shots} 发`;
  if (verdict.cleaves) return `${label}：能打到后一部位`;
  return `${label}：打不到后一部位`;
}

function listConditions(
  attacks: AttackProfile[],
  verdict: Verdict,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
): string[] {
  const lines: string[] = [];
  const at = (next: ShotContext) => verdictAt(attacks, verdict, enemy, next, byId);
  const aimed = attacks.find((attack) => !attack.fragment && attack.kind === "projectile");
  const blast = attacks.find((attack) => !attack.fragment && attack.kind === "explosion" && attack.explosion);
  const beam = attacks.find((attack) => attack.kind === "beam" && attack.beam);
  if (aimed && !sharesOneAp(aimed)) {
    for (const band of ANGLES) {
      const next = at({ ...ctx, angle: band.angle });
      if (changed(verdict, next)) lines.push(conditionLine(band.label, next));
    }
  }
  if (aimed?.ballistics && !verdict.missingBallistics) {
    for (const distanceM of [25, 50]) {
      const next = at({ ...ctx, distanceM });
      if (changed(verdict, next)) lines.push(conditionLine(`${distanceM} 米`, next));
    }
  }
  if (beam?.beam) {
    const next = at({ ...ctx, distanceM: beam.beam.range });
    if (changed(verdict, next)) lines.push(conditionLine("最大射程", next));
  }
  if (ctx.acid) {
    const next = at({ ...ctx, acid: false });
    if (changed(verdict, next)) lines.push(conditionLine("酸雨结束", next));
  }
  if (blast?.explosion) {
    const distanceM = (blast.explosion.innerRadius + blast.explosion.outerRadius) / 2;
    const next = at({ ...ctx, zone: "outer", distanceM });
    if (verdict.penetrates !== next.penetrates || verdict.shots !== next.shots) {
      lines.push(conditionLine("外圈", next));
    }
  }
  return lines;
}

function heldWeapon(piece: GearPiece): boolean {
  return piece.slot === "primary" || piece.slot === "secondary" || piece.slot === "grenade";
}

function compareGear(a: Rated, b: Rated, ion: boolean): number {
  if (ion) {
    const group = Number(!heldWeapon(a.piece)) - Number(!heldWeapon(b.piece));
    if (group !== 0) return group;
  }
  const outcome = compareOutcome(a.verdict, b.verdict);
  if (outcome !== 0) return outcome;
  const slot = SLOT_ORDER[a.piece.slot] - SLOT_ORDER[b.piece.slot];
  if (slot !== 0) return slot;
  return a.piece.order - b.piece.order;
}

function oneDecimal(value: number): string {
  return (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);
}

function reasonFor(rated: Rated, situation: Situation): string {
  const { verdict, attack } = rated;
  const resisted = resistanceNote(verdict);
  let reason = resisted ? `打不穿，${resisted}` : "打不穿";
  if (verdict.penetrates && verdict.fatal && verdict.shots !== undefined) reason = `致命部位，大约 ${verdict.shots} 发`;
  else if (verdict.penetrates && verdict.shots !== undefined) reason = `大约 ${verdict.shots} 发`;
  else if (verdict.penetrates && verdict.fatal) reason = "致命部位";
  else if (verdict.penetrates) reason = "打得穿";
  if (verdict.bundle) reason += `，${verdict.bundle}`;
  if (verdict.penetrates && resisted) reason += `，${resisted}`;
  if (situation.weather.includes("extreme-cold") && attack.roundsPerMinute && verdict.shots !== undefined) {
    const seconds = verdict.shots / ((attack.roundsPerMinute / 60) * 0.9);
    reason += `，大约 ${oneDecimal(seconds)} 秒`;
  }
  return reason;
}

function gearItem(rated: Rated, situation: Situation): KillCard["gear"][number] {
  const item: KillCard["gear"][number] = {
    name: rated.piece.name,
    component: attackTitle(rated.attack),
    reason: reasonFor(rated, situation),
  };
  if (rated.attack.kind !== "explosion" && rated.verdict.target) item.target = rated.verdict.target;
  if (rated.verdict.shots !== undefined) item.shots = rated.verdict.shots;
  return item;
}

function methodFrom(rated: Rated, ion: boolean): string {
  const call = ion && rated.piece.requiresCall ? "，风暴间歇才能呼叫" : "";
  const resisted = resistanceNote(rated.verdict);
  if (!rated.verdict.penetrates) return `${rated.piece.name}的${attackTitle(rated.attack)}${resisted ? `打不穿，${resisted}` : "打不穿"}${call}。`;
  let text = `用${rated.piece.name}的${attackTitle(rated.attack)}`;
  if (rated.attack.kind !== "explosion" && rated.verdict.target) text += `打${rated.verdict.target}`;
  if (rated.verdict.shots !== undefined) text += `，大约 ${rated.verdict.shots} 发`;
  if (rated.verdict.bundle) text += `，${rated.verdict.bundle}`;
  if (resisted) text += `，${resisted}`;
  return text + call;
}

function listRules(lead: Rated | undefined, shown: Rated[], missing: string[]): string[] {
  const rules: string[] = [];
  const projectile = lead?.attack.kind === "projectile" || shown.some((row) => row.attack.kind === "projectile");
  if (projectile) rules.push("投射物距离衰减用的是简化公式，和游戏内模拟大约差 2%–4%。");
  if ([lead, ...shown].some((row) => row?.verdict.explosionImmune || row?.verdict.explosionResist !== undefined)) {
    rules.push("爆炸抗性按部位计算。标成 100% 的部位不吃爆炸伤害。");
  }
  if (missing.some((line) => line.includes("耐久"))) rules.push("耐久缺失时只用标准伤害。");
  return rules;
}

function openMethod(enemy: Enemy, weakPoints: KillCard["weakPoints"], damageTypes: KillCard["damageTypes"]): string {
  if (weakPoints.length === 0) {
    return enemy.health === undefined ? "部位暂缺。" : `部位暂缺。总生命 ${enemy.health}。`;
  }
  const boosts = damageTypes
    .filter((row) => row.label === "更有效")
    .map((row) => `${DAMAGE_WORD[row.type]}更有效`)
    .join("。");
  return boosts ? `打${weakPoints[0].name}。${boosts}。` : `打${weakPoints[0].name}。`;
}

function listDamage(enemy: Enemy): KillCard["damageTypes"] {
  const rows: KillCard["damageTypes"] = [];
  for (const type of DAMAGE_ORDER) {
    const value = enemy.multipliers[type];
    if (value === undefined || value === 1) continue;
    if (value > 1) rows.push({ type, label: "更有效" });
    else if (value === 0) rows.push({ type, label: "免疫" });
    else if (value > 0) rows.push({ type, label: "抗性" });
  }
  return rows;
}

function listWeakPoints(enemy: Enemy, acid: boolean): KillCard["weakPoints"] {
  const armorOf = (part: Part) => (acid ? Math.max(0, part.armor - 1) : part.armor);
  return enemy.parts
    .map((part, index) => ({ part, index }))
    .sort((a, b) => {
      if (a.part.fatal !== b.part.fatal) return a.part.fatal ? -1 : 1;
      const armor = armorOf(a.part) - armorOf(b.part);
      if (armor !== 0) return armor;
      const health = (a.part.health ?? Number.POSITIVE_INFINITY) - (b.part.health ?? Number.POSITIVE_INFINITY);
      if (health !== 0) return health;
      return a.index - b.index;
    })
    .slice(0, 3)
    .map(({ part }) => {
      const point: KillCard["weakPoints"][number] = {
        name: part.name,
        armor: armorOf(part),
        fatal: part.fatal,
      };
      if (part.durability !== undefined) point.durability = part.durability;
      if (part.breakable) point.note = "先打碎外甲，伤害不进里面";
      return point;
    });
}

function formatColdSeconds(seconds: number): string {
  const value = (seconds * 2) / 3;
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function coldLine(gear: GearPiece[]): string {
  const heat = gear.flatMap((piece) => piece.attacks).filter((attack) => attack.heat);
  const line = "严寒：射速按 90%";
  if (heat.length === 0) return line;
  const known = [...new Set(
    heat.flatMap((attack) => (
      attack.cooldownSeconds === undefined ? [] : [formatColdSeconds(attack.cooldownSeconds)]
    )),
  )];
  if (known.length === 0) return `${line}，热量冷却变为 2/3`;
  return `${line}，热量冷却变为 2/3，${known.join("、")} 秒`;
}

function listEnvironment(situation: Situation, gear: GearPiece[]): string[] {
  const weather = new Set(situation.weather);
  const lines: string[] = [];
  if (weather.has("acid-storms")) lines.push("酸雨：护甲减 1");
  if (weather.has("extreme-cold")) lines.push(coldLine(gear));
  if (weather.has("intense-heat") || weather.has("fire-tornados")) lines.push("热量冷却变为 4/3");
  if (weather.has("fire-tornados")) lines.push("火焰龙卷：敌人视野下降");
  if (weather.has("ion-storms")) lines.push("离子风暴：不能新呼叫战略");
  if (weather.has("blizzards")) lines.push("暴风雪：能见度中等下降");
  if (weather.has("sandstorms")) lines.push("沙尘暴：能见度大幅下降");
  if (weather.has("rainstorms")) lines.push("暴雨：能见度下降");
  if (weather.has("thick-fog")) lines.push("浓雾：能见度轻微下降");
  if (weather.has("tremors")) lines.push("地震：瞄准会被震停");
  if (weather.has("volcanic-activity")) lines.push("岩浆：场上有额外伤害，不计入发数");
  if (weather.has("meteor-storms")) lines.push("陨石：场上有额外伤害，不计入发数");

  const eagle = gear.some((piece) => piece.eagle);
  if (situation.gloom === "moderate" && eagle) lines.push("中度阴霾：鹰式再装填加 20%");
  if (situation.gloom === "heavy" || situation.gloom === "source") {
    let line = eagle ? "重度阴霾：鹰式再装填加 30%，拾取弹药减半" : "重度阴霾：拾取弹药减半";
    if (situation.gloom === "source") line += "，增援数减 20%";
    lines.push(line);
  }
  for (const hazard of situation.unknownHazards ?? []) lines.push(hazard);
  if (situation.cachedAt) lines.push(`星球数据缓存于 ${situation.cachedAt}`);
  return lines;
}

function fragmentPieces(attacks: AttackProfile[], shrapnelName: string): AttackProfile[] {
  const names = new Set([shrapnelName]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const attack of attacks) {
      if (attack.parentName && names.has(attack.parentName) && attack.sourceName && !names.has(attack.sourceName)) {
        names.add(attack.sourceName);
        grew = true;
      }
    }
  }
  return attacks.filter((attack) => attack.fragment && attack.sourceName && names.has(attack.sourceName));
}

function componentHit(attack: AttackProfile, part: Part, ctx: ShotContext): { damage: number; penetrates: boolean; equal: boolean; immune: boolean; resist?: number } {
  const shot = shotDamage(attack, part, ctx);
  return {
    damage: shot.penetrates ? shot.damage : 0,
    penetrates: shot.penetrates && shot.damage > 0,
    equal: shot.penetrates && shot.apUsed === shot.armorUsed,
    immune: shot.explosionImmune === true,
    ...(shot.explosionResist !== undefined ? { resist: shot.explosionResist } : {}),
  };
}

function bundleText(shell: boolean, blast: boolean, fragments: number): string | undefined {
  const bits: string[] = [];
  if (shell) bits.push("弹头");
  if (blast) bits.push("爆炸");
  if (fragments > 0) bits.push(`${fragments} 枚破片`);
  if (fragments > 0) return `含${bits.join("、")}，破片按都打中这一处`;
  if (shell && blast) return "含弹头和爆炸";
  return undefined;
}

function salvoAt(attacks: AttackProfile[], part: Part, ctx: ShotContext): Verdict {
  let total = 0;
  let shell = false;
  let blast = false;
  let fragments = 0;
  let onlyEqual = true;
  let explosionImmune = false;
  let explosionResist: number | undefined;
  const add = (hit: { damage: number; penetrates: boolean; equal: boolean }) => {
    if (!hit.penetrates) return;
    total += hit.damage;
    if (!hit.equal) onlyEqual = false;
  };
  for (const attack of attacks) {
    if (attack.fragment || attack.kind === "explosion") continue;
    const hit = componentHit(attack, part, ctx);
    if (hit.penetrates) shell = true;
    add(hit);
  }
  for (const attack of attacks) {
    if (attack.fragment || attack.kind !== "explosion") continue;
    const hit = componentHit(attack, part, ctx);
    if (hit.immune) explosionImmune = true;
    if (hit.penetrates) {
      blast = true;
      if (hit.resist !== undefined) explosionResist = hit.resist;
    }
    add(hit);
    if (!attack.shrapnelCount || !attack.shrapnelName) continue;
    let perFragment = 0;
    let fragmentHits = false;
    for (const piece of fragmentPieces(attacks, attack.shrapnelName)) {
      const pieceHit = componentHit(piece, part, ctx);
      if (!pieceHit.penetrates) continue;
      perFragment += pieceHit.damage;
      fragmentHits = true;
      if (!pieceHit.equal) onlyEqual = false;
    }
    if (fragmentHits && perFragment > 0) {
      total += perFragment * attack.shrapnelCount;
      fragments += attack.shrapnelCount;
    }
  }
  const hits = shell || blast || fragments > 0;
  return {
    penetrates: hits,
    shots: hits ? ceilShots(part.health, total) : undefined,
    cleaves: false,
    damage: total,
    fatal: part.fatal && hits,
    target: part.name,
    partId: part.id,
    missingBallistics: false,
    equalPen: hits && onlyEqual && fragments === 0 && !(shell && blast),
    bundle: bundleText(shell, blast, fragments),
    ...(explosionImmune ? { explosionImmune: true } : {}),
    ...(explosionResist !== undefined ? { explosionResist } : {}),
  };
}

function rateSalvo(
  piece: GearPiece,
  attacks: AttackProfile[],
  enemy: Enemy,
  ctx: ShotContext,
): Rated | undefined {
  if (enemy.parts.length === 0) return undefined;
  let best = salvoAt(attacks, enemy.parts[0], ctx);
  for (const part of enemy.parts.slice(1)) {
    const verdict = salvoAt(attacks, part, ctx);
    if (compareOutcome(verdict, best) < 0) best = verdict;
  }
  const attack = attacks.find((item) => item.kind === "explosion" && item.shrapnelCount)
    ?? attacks.find((item) => !item.fragment && item.kind === "projectile")
    ?? attacks[0];
  return { piece, attack, verdict: best };
}

function sameProgram(piece: GearPiece, attack: AttackProfile): AttackProfile[] {
  const mode = attack.mode ?? "";
  const attacks = piece.attacks.filter((item) => (item.mode ?? "") === mode);
  return attacks.length > 0 ? attacks : [attack];
}

function rateModes(
  piece: GearPiece,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
  missing: string[],
): Rated[] {
  const groups = new Map<string, AttackProfile[]>();
  for (const attack of piece.attacks) {
    const key = attack.mode ?? "";
    const list = groups.get(key) ?? [];
    list.push(attack);
    groups.set(key, list);
  }
  const rows: Rated[] = [];
  for (const attacks of groups.values()) {
    for (const attack of attacks) {
      if (attack.kind === "projectile" && !attack.ballistics) {
        pushUnique(missing, `缺少弹道：${piece.name}的${attackTitle(attack)}`);
      }
      if (attack.kind === "explosion" && !attack.explosion) {
        pushUnique(missing, `缺少半径：${piece.name}的${attackTitle(attack)}`);
      }
    }
    if (attacks.length > 1) {
      const row = rateSalvo(piece, attacks, enemy, ctx);
      if (row) rows.push(row);
      continue;
    }
    const attack = attacks[0];
    const verdict = rateAttack(attack, enemy, ctx, byId, missing, true);
    if (attack.kind === "projectile" && verdict.missingBallistics) {
      pushUnique(missing, `缺少弹道：${piece.name}的${attackTitle(attack)}`);
    }
    rows.push({ piece, attack, verdict });
  }
  return rows;
}

export function assess(
  enemy: Enemy,
  gear: GearPiece[],
  situation: Situation,
  meta?: { importedAt?: string; conflicts?: string[] },
): KillCard {
  const acid = situation.weather.includes("acid-storms");
  const ion = situation.weather.includes("ion-storms");
  const mainCtx: ShotContext = { angle: "front", distanceM: 0, zone: "inner", acid };
  const byId = new Map(enemy.parts.map((part) => [part.id, part]));
  const missing: string[] = [];
  if (enemy.parts.length === 0) missing.push("部位暂缺");

  const rated: Rated[] = [];
  for (const piece of gear) {
    if (piece.harmless) {
      pushUnique(missing, `不造成伤害：${piece.name}`);
      continue;
    }
    if (piece.missingCombatData || piece.attacks.length === 0) {
      pushUnique(missing, `缺少战斗数据：${piece.name}`);
      continue;
    }
    if (piece.catalogFallback) {
      pushUnique(missing, `维基攻击表没有记录，伤害用的是装备目录：${piece.name}`);
    }
    rated.push(...rateModes(piece, enemy, mainCtx, byId, missing));
  }

  rated.sort((a, b) => compareGear(a, b, ion));
  const shown = rated.filter((row) => row.verdict.penetrates).slice(0, 3);
  const lead = rated[0];
  const anchor = new Set([...shown, ...(lead ? [lead] : [])].map((row) => row.piece.id));
  const extra = rated.filter((row) => row.attack.mode && anchor.has(row.piece.id) && !shown.includes(row));
  const listed = [...shown, ...extra];
  const listedIds = new Set(listed.map((row) => row.piece.id));
  const bestByPiece = new Map<string, Rated>();
  for (const row of rated) {
    const previous = bestByPiece.get(row.piece.id);
    if (!previous || compareOutcome(row.verdict, previous.verdict) < 0) bestByPiece.set(row.piece.id, row);
  }
  const blockedCount = [...bestByPiece.values()].filter((row) => !row.verdict.penetrates && !listedIds.has(row.piece.id)).length;
  const damageTypes = listDamage(enemy);
  const weakPoints = listWeakPoints(enemy, acid);

  return {
    method: lead
      ? methodFrom(lead, ion)
      : gear.length === 0
        ? openMethod(enemy, weakPoints, damageTypes)
        : gear.every((piece) => piece.harmless)
          ? "这些装备不造成伤害。"
          : "缺少战斗数据。",
    conditions: lead ? listConditions(sameProgram(lead.piece, lead.attack), lead.verdict, enemy, mainCtx, byId) : [],
    environment: listEnvironment(situation, gear),
    damageTypes,
    weakPoints,
    locations: lead ? listLocations(sameProgram(lead.piece, lead.attack), enemy, mainCtx, byId) : [],
    gear: listed.map((row) => gearItem(row, situation)),
    blockedCount,
    missing,
    rules: listRules(lead, listed, missing),
    conflicts: meta?.conflicts ?? [],
    wikiUrl: enemy.wikiUrl,
    importedAt: meta?.importedAt,
  };
}
