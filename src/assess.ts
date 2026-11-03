import { cleaveThrough, sameShotThroughPlating } from "./cleave";
import type { AngleBand, AttackProfile, Enemy, GearPiece, Part, ShotContext, Situation, Slot } from "./model";
import { sharesOneAp, shotDamage } from "./shot";

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

interface Verdict {
  penetrates: boolean;
  shots?: number;
  cleaves: boolean;
  damage: number;
  fatal: boolean;
  target?: string;
  partId?: string;
  missingBallistics: boolean;
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
    };
  }

  if (part.breakable) {
    const inner = shotDamage(attack, behind, ctx);
    const outerShots = ceilShots(part.health, shot.damage);
    const innerShots = inner.penetrates ? ceilShots(behind.health, inner.damage) : undefined;
    const innerHits = inner.penetrates && inner.damage > 0;
    const shots =
      outerShots !== undefined && innerHits && innerShots !== undefined ? outerShots + innerShots : outerShots;
    return {
      penetrates: true,
      shots,
      cleaves: false,
      damage: shot.damage,
      fatal: part.fatal || (behind.fatal && innerHits),
      target: part.name,
      partId: part.id,
      missingBallistics: shot.missingBallistics || inner.missingBallistics,
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

function explosionVerdict(attack: AttackProfile, parts: Part[], ctx: ShotContext): Verdict {
  if (parts.length === 0) return emptyVerdict();
  const rows = parts.map((part) => {
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
  if (attack.kind === "explosion") return explosionVerdict(attack, enemy.parts, ctx);
  return bestAimed(attack, enemy.parts, ctx, byId, missing, recordMissing);
}

function verdictAt(
  attack: AttackProfile,
  verdict: Verdict,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
): Verdict {
  if (attack.kind === "explosion") return explosionVerdict(attack, enemy.parts, ctx);
  const part = enemy.parts.find((item) => item.id === verdict.partId);
  if (!part) return emptyVerdict();
  return aimedVerdict(attack, part, ctx, byId, [], false);
}

function changed(main: Verdict, next: Verdict): boolean {
  return main.penetrates !== next.penetrates || main.shots !== next.shots || main.cleaves !== next.cleaves;
}

function conditionLine(label: string, verdict: Verdict): string {
  if (!verdict.penetrates) return `${label}：打不穿`;
  if (verdict.shots !== undefined) return `${label}：大约 ${verdict.shots} 发`;
  if (verdict.cleaves) return `${label}：能打到后一部位`;
  return `${label}：打不到后一部位`;
}

function listConditions(
  attack: AttackProfile,
  verdict: Verdict,
  enemy: Enemy,
  ctx: ShotContext,
  byId: Map<string, Part>,
): string[] {
  const lines: string[] = [];
  const at = (next: ShotContext) => verdictAt(attack, verdict, enemy, next, byId);
  if (!sharesOneAp(attack)) {
    for (const band of ANGLES) {
      const next = at({ ...ctx, angle: band.angle });
      if (changed(verdict, next)) lines.push(conditionLine(band.label, next));
    }
  }
  if (attack.kind === "projectile" && attack.ballistics && !verdict.missingBallistics) {
    for (const distanceM of [25, 50]) {
      const next = at({ ...ctx, distanceM });
      if (changed(verdict, next)) lines.push(conditionLine(`${distanceM} 米`, next));
    }
  }
  if (attack.kind === "beam" && attack.beam) {
    const next = at({ ...ctx, distanceM: attack.beam.range });
    if (changed(verdict, next)) lines.push(conditionLine("最大射程", next));
  }
  if (ctx.acid) {
    const next = at({ ...ctx, acid: false });
    if (changed(verdict, next)) lines.push(conditionLine("酸雨结束", next));
  }
  if (attack.kind === "explosion") {
    const distanceM = attack.explosion ? (attack.explosion.innerRadius + attack.explosion.outerRadius) / 2 : 0;
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
  let reason = "打不穿";
  if (verdict.penetrates && verdict.fatal && verdict.shots !== undefined) reason = `致命部位，大约 ${verdict.shots} 发`;
  else if (verdict.penetrates && verdict.shots !== undefined) reason = `大约 ${verdict.shots} 发`;
  else if (verdict.penetrates && verdict.fatal) reason = "致命部位";
  else if (verdict.penetrates) reason = "打得穿";
  if (situation.weather.includes("extreme-cold") && attack.roundsPerMinute && verdict.shots !== undefined) {
    const seconds = verdict.shots / ((attack.roundsPerMinute / 60) * 0.9);
    reason += `，大约 ${oneDecimal(seconds)} 秒`;
  }
  return reason;
}

function gearItem(rated: Rated, situation: Situation): KillCard["gear"][number] {
  const item: KillCard["gear"][number] = {
    name: rated.piece.name,
    component: rated.attack.label,
    reason: reasonFor(rated, situation),
  };
  if (rated.attack.kind !== "explosion" && rated.verdict.target) item.target = rated.verdict.target;
  if (rated.verdict.shots !== undefined) item.shots = rated.verdict.shots;
  return item;
}

function methodFrom(rated: Rated, ion: boolean): string {
  let text = `用${rated.piece.name}的${rated.attack.label}`;
  if (rated.attack.kind !== "explosion" && rated.verdict.target) text += `打${rated.verdict.target}`;
  if (rated.verdict.shots !== undefined) text += `，大约 ${rated.verdict.shots} 发`;
  if (ion && rated.piece.requiresCall) text += `，风暴间歇才能呼叫`;
  return text;
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

function listEnvironment(situation: Situation, gear: GearPiece[]): string[] {
  const weather = new Set(situation.weather);
  const lines: string[] = [];
  if (weather.has("acid-storms")) lines.push("酸雨：护甲减 1");
  if (weather.has("extreme-cold")) lines.push("严寒：射速按 90%");
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
    if (piece.missingCombatData || piece.attacks.length === 0) {
      pushUnique(missing, `缺少战斗数据：${piece.name}`);
      continue;
    }
    let best: Rated | undefined;
    for (const attack of piece.attacks) {
      const verdict = rateAttack(attack, enemy, mainCtx, byId, missing, true);
      if (attack.kind === "projectile" && (verdict.missingBallistics || !attack.ballistics)) {
        pushUnique(missing, `缺少弹道：${piece.name}的${attack.label}`);
      }
      if (attack.kind === "explosion" && !attack.explosion) {
        pushUnique(missing, `缺少半径：${piece.name}的${attack.label}`);
      }
      const row = { piece, attack, verdict };
      if (!best || compareOutcome(verdict, best.verdict) < 0) best = row;
    }
    if (!best) continue;
    rated.push(best);
  }

  rated.sort((a, b) => compareGear(a, b, ion));
  const shown = rated.filter((row) => row.verdict.penetrates).slice(0, 3);
  const blockedCount = rated.filter((row) => !row.verdict.penetrates).length;
  const damageTypes = listDamage(enemy);
  const weakPoints = listWeakPoints(enemy, acid);
  const lead = shown[0];

  return {
    method: lead ? methodFrom(lead, ion) : openMethod(enemy, weakPoints, damageTypes),
    conditions: lead ? listConditions(lead.attack, lead.verdict, enemy, mainCtx, byId) : [],
    environment: listEnvironment(situation, gear),
    damageTypes,
    weakPoints,
    gear: shown.map((row) => gearItem(row, situation)),
    blockedCount,
    missing,
    conflicts: meta?.conflicts ?? [],
    wikiUrl: enemy.wikiUrl,
    importedAt: meta?.importedAt,
  };
}
