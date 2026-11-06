import type { AttackProfile, GearPiece, Slot } from "./model";
import type { CatalogItem } from "./import-catalog";

interface DamageRec {
  dmg?: number;
  dmg2?: number;
  ap1?: number;
  ap2?: number;
  ap3?: number;
  ap4?: number;
  element_name?: string;
  element_name_sub?: string;
}

interface ProjectileRec {
  damage_id?: string;
  caliber?: number;
  mass?: number;
  drag?: number;
  explode_proximity?: number;
}

interface ExplosionRec {
  damage_id?: string;
  r1?: number;
  r2?: number;
  r3?: number;
  shrapnel?: string;
  shrapnel_count?: number;
}

interface BeamRec {
  damage_id?: string;
  range?: number;
  falloff_reverse_start?: number;
  falloff?: number;
}

interface ArcRec {
  damage_id?: string;
}

interface AttackRef {
  type?: string;
  name?: string;
  parent?: string;
  level?: number;
}

interface WeaponRec {
  name?: string;
  rpm?: number;
  beam_fire_rate?: number;
  attacks?: AttackRef[];
}

interface StratRec {
  name?: string;
  cooldown?: number;
  attacks?: AttackRef[];
}

export interface DecodedDoc {
  damage?: Record<string, DamageRec>;
  explosion?: Record<string, ExplosionRec>;
  projectile?: Record<string, ProjectileRec>;
  beam?: Record<string, BeamRec>;
  arc?: Record<string, ArcRec>;
  spray?: Record<string, ArcRec>;
  weapons?: Record<string, WeaponRec>;
  stratagems?: Record<string, StratRec>;
  wep_version?: string;
  strat_version?: string;
}

export interface CargoWeapon {
  title: string;
  page?: string;
  category: string;
}

export interface CargoStratagem {
  title: string;
  page?: string;
  type: string;
}

interface LegacyDamage {
  name?: string;
  dmg?: number;
  dmg2?: number;
  ap1?: number;
  ap2?: number;
  ap3?: number;
  ap4?: number;
  element_name?: string;
  element_name_sub?: string;
}

interface LegacyRecord {
  name?: string;
  damageid?: string;
  r1?: number;
  r2?: number;
  r3?: number;
  caliber?: number;
  mass?: number;
  drag?: number;
  range?: number;
  falloff_reverse_start?: number;
  falloff?: number;
}

export interface LegacyDoc {
  damage?: Record<string, LegacyDamage>;
  explosion?: Record<string, LegacyRecord>;
  projectile?: Record<string, LegacyRecord>;
  beam?: Record<string, LegacyRecord>;
  arc?: Record<string, LegacyRecord>;
}

interface Named<T> {
  name: string;
  value: T;
  internal: boolean;
}

interface WikiRevision {
  slots?: { main?: { content?: string } & Record<string, string | undefined> };
}

interface WikiQuery {
  query?: { pages?: Record<string, { title?: string; revisions?: WikiRevision[] }> };
}

interface LangQuery {
  query?: { pages?: Record<string, { title?: string; langlinks?: ({ lang?: string; title?: string } & Record<string, string | undefined>)[] }> };
}

const SLOT_RANK: Record<Slot, number> = {
  primary: 0,
  secondary: 1,
  grenade: 2,
  support: 3,
  stratagem: 4,
};

export function buildGear(
  weaponsDoc: DecodedDoc,
  stratDoc: DecodedDoc,
  weaponRows: CargoWeapon[],
  stratRows: CargoStratagem[],
  catalog: CatalogItem[],
  lang: Record<string, string>,
  legacy?: LegacyDoc,
): { gear: GearPiece[]; version: string } {
  const weapons = namedWeapons(weaponsDoc, stratDoc);
  const stratagems = namedStratagems(stratDoc, weaponsDoc);
  const pieces: GearPiece[] = [];
  const titles: string[] = [];
  const usedIds = new Set<string>();

  for (const row of weaponRows) {
    const slot = slotFromCategory(row.category);
    if (!slot || !row.title.trim()) continue;
    addPiece(pieces, titles, usedIds, row, slot, false, weapons, stratagems, weaponsDoc, stratDoc, catalog, lang, legacy);
  }

  for (const row of stratRows) {
    const type = row.type.trim();
    if (!row.title.trim()) continue;
    const names = sourceNames(row.title, row.page);
    if (type === "Ship" || type === "" || (type === "Objective" && !names.some((name) => findMatch(name, stratagems)))) {
      remember(titles, row.title, row.page);
      continue;
    }
    const slot: Slot = type === "Support Weapon" ? "support" : "stratagem";
    if (names.some((name) => covered(name, titles))) continue;
    addPiece(pieces, titles, usedIds, row, slot, type === "Eagle", weapons, stratagems, weaponsDoc, stratDoc, catalog, lang, legacy);
  }

  for (const record of weapons) {
    if (record.internal || covered(record.name, titles)) continue;
    addPiece(pieces, titles, usedIds, { title: record.name }, guessSlot(record.name), false, weapons, stratagems, weaponsDoc, stratDoc, catalog, lang, legacy);
  }

  for (const record of stratagems) {
    if (covered(record.name, titles)) continue;
    addPiece(pieces, titles, usedIds, { title: record.name }, "stratagem", /eagle/i.test(record.name), weapons, stratagems, weaponsDoc, stratDoc, catalog, lang, legacy);
  }

  pieces.sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.name.localeCompare(b.name, "zh"));
  pieces.forEach((piece, order) => {
    piece.order = order;
  });
  return { gear: pieces, version: versionText(weaponsDoc, stratDoc) };
}

export async function fetchWikiGear(): Promise<{ gear: GearPiece[]; aliases: Record<string, string[]>; version: string }> {
  const [weaponsDoc, stratDoc, weaponRows, stratRows, overlay] = await Promise.all([
    fetchModule("Module:Decodedata-Attacks/weapons_data.json"),
    fetchModule("Module:Decodedata-Attacks/stratagems_data.json"),
    fetchCargo("Weapons", "_pageName=page,title,weapon_category").then(weaponCargo),
    fetchCargo("Stratagems", "_pageName=page,title,stratagem_type").then(stratCargo),
    fetchOverlay(),
  ]);
  const titles = [...weaponRows, ...stratRows].flatMap((row) => sourceNames(row.title, row.page));
  const [lang, legacy] = await Promise.all([
    fetchLang(titles),
    fetchModule("Module:Decodedata-Attacks/data.json").catch(() => ({} as LegacyDoc)),
  ]);
  const built = buildGear(weaponsDoc, stratDoc, weaponRows, stratRows, overlay.catalog, lang, legacy as LegacyDoc);
  return { gear: built.gear, aliases: overlay.aliases, version: built.version };
}

function addPiece(
  pieces: GearPiece[],
  titles: string[],
  usedIds: Set<string>,
  source: { title: string; page?: string },
  slot: Slot,
  eagleHint: boolean,
  weapons: Named<WeaponRec>[],
  stratagems: Named<StratRec>[],
  weaponsDoc: DecodedDoc,
  stratDoc: DecodedDoc,
  catalog: CatalogItem[],
  lang: Record<string, string>,
  legacy?: LegacyDoc,
): void {
  const names = sourceNames(source.title, source.page);
  const weapon = firstWithAttacks(names, weapons);
  const strat = firstWithAttacks(names, stratagems);
  const known = names.map((name) => findCatalog(name, catalog)).find((item) => item);
  const requiresCall = slot === "support" || slot === "stratagem";
  const english = known?.nameEn || source.page || source.title;
  const linked = names.map((name) => lang[name]).find((name) => name) || "";
  const name = known?.nameZh?.trim() || linked || readable(source.title);
  const model = known?.model || modelCode(source.page || source.title);
  const id = uniqueId(known?.id || slug(english), usedIds);
  const rpm = sane(weapon?.rpm) ?? sane(weapon?.beam_fire_rate);
  const cooldown = requiresCall ? sane(strat?.cooldown) : undefined;
  const built = buildAttacks(
    weapon?.attacks?.length ? weapon.attacks : strat?.attacks ?? [],
    weapon ? weaponsDoc : stratDoc,
    weaponsDoc,
    stratDoc,
    id,
    rpm,
    cooldown,
    known,
  );
  let attacks = built.attacks;
  if (attacks.length === 0) {
    const fallback = legacyAttack(names, legacy, `${id}-0`, cooldown);
    if (fallback) attacks = [fallback];
  }
  let catalogFallback = false;
  if (attacks.length === 0) {
    const exact = exactCatalog(names, catalog);
    const filled = exact ? attacksFromCatalog(exact, id, cooldown) : [];
    if (filled.length > 0) {
      attacks = filled;
      catalogFallback = true;
    }
  }
  const gear: GearPiece = {
    id,
    name,
    ...(model ? { model } : {}),
    ...(english ? { nameEn: english } : {}),
    slot,
    order: pieces.length,
    requiresCall,
    eagle: eagleHint || names.some((item) => /eagle/i.test(item)),
    attacks,
  };
  if (catalogFallback) gear.catalogFallback = true;
  if (attacks.length === 0 && built.harmless) gear.harmless = true;
  else if (attacks.length === 0) gear.missingCombatData = true;
  pieces.push(gear);
  remember(titles, source.title, source.page);
}

function sourceNames(title: string, page?: string): string[] {
  return [...new Set([page, title].map((name) => name?.trim() || "").filter((name) => name !== ""))];
}

function remember(titles: string[], title: string, page?: string): void {
  for (const name of sourceNames(title, page)) titles.push(name);
}

function firstWithAttacks<T extends { attacks?: AttackRef[] }>(names: string[], rows: Named<T>[]): T | undefined {
  let empty: T | undefined;
  for (const name of names) {
    const found = findMatch(name, rows);
    if (!found) continue;
    if (found.attacks?.length) return found;
    empty ??= found;
  }
  return empty;
}

const AMMO_ZH: Record<string, string> = {
  APHET: "穿甲高爆",
  Flak: "空爆",
  HEAT: "破甲",
  HE: "高爆",
  Guided: "制导",
  "Non-Guided": "非制导",
  Total: "全弹",
  Volley: "齐射",
};

interface Draft {
  attack: AttackProfile;
  group: string;
  underbarrel: boolean;
  overcharge: boolean;
  stun: boolean;
  proximity: boolean;
  sourceName: string;
  parentName?: string;
}

function buildAttacks(
  refs: AttackRef[],
  primary: DecodedDoc,
  weaponsDoc: DecodedDoc,
  stratDoc: DecodedDoc,
  gearId: string,
  rpm: number | undefined,
  cooldown: number | undefined,
  catalogItem?: CatalogItem,
): { attacks: AttackProfile[]; harmless: boolean } {
  let attempted = 0;
  let sequence = 0;
  const docs = primary === weaponsDoc ? [weaponsDoc, stratDoc] : [stratDoc, weaponsDoc];

  const absorb = (rows: AttackRef[], underbarrel: boolean): Draft[] => {
    const table = new Map(rows.flatMap((ref) => (ref.name ? [[ref.name, ref] as const] : [])));
    const stunParents = new Set(
      rows.flatMap((ref) => (ref.type === "status" && /stun/i.test(ref.name ?? "") && ref.parent ? [ref.parent] : [])),
    );
    const rootKey = (ref: AttackRef): string => {
      let current = ref;
      for (let guard = 0; guard < 8 && current.parent && table.has(current.parent); guard += 1) {
        current = table.get(current.parent)!;
      }
      return current.name ?? ref.name ?? "";
    };
    const backblast = (ref: AttackRef): boolean => {
      let current: AttackRef | undefined = ref;
      for (let guard = 0; guard < 8 && current; guard += 1) {
        if (/BACKBLAST/i.test(current.name ?? "")) return true;
        current = current.parent ? table.get(current.parent) : undefined;
      }
      return false;
    };
    const drafts: Draft[] = [];
    for (const ref of rows) {
      if (!ref.type || !ref.name || ref.type === "status" || backblast(ref)) continue;
      if (ref.type === "weapons") {
        if (underbarrel) continue;
        const child = weaponsDoc.weapons?.[ref.name] ?? stratDoc.weapons?.[ref.name];
        drafts.push(...absorb(child?.attacks ?? [], true));
        continue;
      }
      attempted += 1;
      const attack = toAttack(ref, primary, weaponsDoc, stratDoc, `${gearId}-${sequence}`, rpm, cooldown);
      sequence += 1;
      if (!attack) continue;
      const projectile = ref.type === "projectile" ? lookupTable(docs, "projectile", ref.name) : undefined;
      const root = rootKey(ref);
      attack.sourceName = ref.name;
      attack.parentName = ref.parent;
      drafts.push({
        attack,
        group: underbarrel ? `under:${root}` : root,
        underbarrel,
        overcharge: /overcharge/i.test(`${ref.name} ${root}`),
        stun: stunParents.has(ref.name) || stunParents.has(root),
        proximity: (projectile?.explode_proximity ?? 0) > 0,
        sourceName: ref.name,
        parentName: ref.parent,
      });
    }
    return drafts;
  };

  const grouped: { drafts: Draft[] }[] = [];
  const at = new Map<string, number>();
  for (const draft of absorb(refs, false)) {
    const index = at.get(draft.group);
    if (index === undefined) {
      at.set(draft.group, grouped.length);
      grouped.push({ drafts: [draft] });
    } else grouped[index].drafts.push(draft);
  }
  const kept: { drafts: Draft[] }[] = [];
  const seen = new Set<string>();
  for (const group of grouped) {
    const signature = groupSignature(group.drafts);
    if (seen.has(signature)) continue;
    seen.add(signature);
    kept.push(group);
  }
  for (const group of kept) markFragments(group.drafts);
  if (kept.length >= 2) assignModes(kept, catalogItem);
  return {
    attacks: kept.flatMap((group) => group.drafts.map((draft) => draft.attack)),
    harmless: attempted > 0 && kept.length === 0,
  };
}

function markFragments(drafts: Draft[]): void {
  const byName = new Map(drafts.map((draft) => [draft.sourceName, draft]));
  const roots = new Set(drafts.flatMap((draft) => (draft.attack.shrapnelName ? [draft.attack.shrapnelName] : [])));
  const memo = new Map<string, boolean>();
  const isFragment = (name: string, guard = 0): boolean => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    if (guard > 6) return false;
    const parent = byName.get(name)?.parentName;
    const yes = roots.has(name) || (!!parent && byName.has(parent) && isFragment(parent, guard + 1));
    memo.set(name, yes);
    return yes;
  };
  for (const draft of drafts) {
    if (isFragment(draft.sourceName)) draft.attack.fragment = true;
  }
}

function groupSignature(drafts: Draft[]): string {
  return drafts
    .map((draft) => [
      draft.attack.kind,
      draft.attack.standardDamage,
      draft.attack.ap.front,
      draft.attack.ap.slight ?? "",
      draft.attack.ap.large ?? "",
      draft.attack.ap.extreme ?? "",
      draft.proximity ? 1 : 0,
      draft.stun ? 1 : 0,
      draft.underbarrel ? 1 : 0,
      draft.overcharge ? 1 : 0,
      draft.attack.explosion?.innerRadius ?? "",
      draft.attack.explosion?.outerRadius ?? "",
    ].join(":"))
    .sort()
    .join("|");
}

function assignModes(groups: { drafts: Draft[] }[], catalogItem: CatalogItem | undefined): void {
  const catalogNames = catalogAmmo(catalogItem);
  const labels = groups.map((group) => modeLabel(group.drafts, catalogNames));
  const tallied = tally(labels);
  const named = labels.map((label, index) => (
    (tallied.get(label) ?? 0) > 1 ? `${label} · ${primaryDraft(groups[index].drafts).attack.standardDamage}` : label
  ));
  const still = tally(named);
  const seen = new Map<string, number>();
  named.forEach((label, index) => {
    let text = label;
    if ((still.get(label) ?? 0) > 1) {
      const count = (seen.get(label) ?? 0) + 1;
      seen.set(label, count);
      text = `${label} ${count}`;
    }
    for (const draft of groups[index].drafts) draft.attack.mode = text;
  });
}

function modeLabel(drafts: Draft[], catalogNames: { damage: number; ap: number; zh: string }[]): string {
  if (drafts.some((draft) => draft.underbarrel)) return "下挂";
  if (drafts.some((draft) => draft.overcharge)) return "过载";
  const shot = primaryDraft(drafts);
  const named = catalogNames.filter((entry) => entry.damage === shot.attack.standardDamage);
  if (named.length === 1) return named[0].zh;
  const exact = named.filter((entry) => entry.ap === shot.attack.ap.front);
  if (exact.length === 1) return exact[0].zh;
  if (drafts.some((draft) => draft.stun)) return "眩晕";
  if (drafts.some((draft) => draft.proximity)) return "空爆";
  return `穿甲 ${shot.attack.ap.front}`;
}

function primaryDraft(drafts: Draft[]): Draft {
  return drafts.find((draft) => draft.attack.kind === "projectile") ?? drafts[0];
}

function catalogAmmo(item: CatalogItem | undefined): { damage: number; ap: number; zh: string }[] {
  if (!item) return [];
  const modes = (item.handling?.firingModes ?? []).filter((mode) => mode in AMMO_ZH);
  const shots = (item.combat?.components ?? []).filter((component) => (
    component.type === "projectile"
    && typeof component.fields?.standardDamage === "number"
    && typeof component.fields?.armorPenetration?.value === "number"
  ));
  if (modes.length === 0 || modes.length !== shots.length) return [];
  return shots.map((component, index) => ({
    damage: component.fields.standardDamage!,
    ap: component.fields.armorPenetration!.value,
    zh: AMMO_ZH[modes[index]],
  }));
}

function tally(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

function exactCatalog(names: string[], catalog: CatalogItem[]): CatalogItem | undefined {
  for (const name of names) {
    for (const item of catalog) {
      if (item.productKind === "body-armor") continue;
      const candidates = [item.nameEn, `${item.model ?? ""} ${item.nameEn ?? ""}`.trim()];
      if (candidates.some((candidate) => catalogScore(name, candidate) === 0)) return item;
    }
  }
  return undefined;
}

function attacksFromCatalog(item: CatalogItem, id: string, cooldown: number | undefined): AttackProfile[] {
  const rpm = sane(item.handling?.fireRate);
  const attacks: AttackProfile[] = [];
  for (const component of item.combat?.components ?? []) {
    const damage = component.fields?.standardDamage;
    const ap = component.fields?.armorPenetration?.value;
    if (typeof damage !== "number" || damage <= 0 || typeof ap !== "number") continue;
    const kind = component.type === "explosion" ? "explosion" : component.type === "beam" ? "beam" : "projectile";
    attacks.push({
      id: `${id}-cat-${attacks.length}`,
      label: component.label,
      kind,
      aimed: kind !== "explosion",
      ap: { front: ap },
      standardDamage: damage,
      ...(typeof component.fields?.durableDamage === "number" ? { durableDamage: component.fields.durableDamage } : {}),
      heat: kind === "beam" || /laser|heat|fire/i.test(component.label),
      ...(kind !== "explosion" && rpm !== undefined ? { roundsPerMinute: rpm } : {}),
      ...(cooldown !== undefined ? { cooldownSeconds: cooldown } : {}),
    });
  }
  if (attacks.length >= 2) {
    const labels = attacks.map((attack) => `穿甲 ${attack.ap.front}`);
    const counts = tally(labels);
    const named = labels.map((label, index) => (
      (counts.get(label) ?? 0) > 1 ? `${label} · ${attacks[index].standardDamage}` : label
    ));
    const still = tally(named);
    const seen = new Map<string, number>();
    named.forEach((label, index) => {
      let text = label;
      if ((still.get(label) ?? 0) > 1) {
        const count = (seen.get(label) ?? 0) + 1;
        seen.set(label, count);
        text = `${label} ${count}`;
      }
      attacks[index].mode = text;
    });
  }
  return attacks;
}

function toAttack(
  ref: AttackRef,
  primary: DecodedDoc,
  weaponsDoc: DecodedDoc,
  stratDoc: DecodedDoc,
  id: string,
  rpm: number | undefined,
  cooldown: number | undefined,
): AttackProfile | undefined {
  const type = ref.type ?? "";
  const name = ref.name ?? "";
  const docs = primary === weaponsDoc ? [weaponsDoc, stratDoc] : [stratDoc, weaponsDoc];
  const damage = lookupDamage(type, name, docs);
  if (!damage || typeof damage.dmg !== "number" || damage.dmg <= 0 || typeof damage.ap1 !== "number") return undefined;
  const kind = type === "explosion" ? "explosion" : type === "beam" ? "beam" : "projectile";
  const projectile = kind === "projectile" ? lookupTable(docs, "projectile", name) : undefined;
  const explosion = kind === "explosion" ? lookupTable(docs, "explosion", name) : undefined;
  const beam = kind === "beam" ? lookupTable(docs, "beam", name) : undefined;
  const ballistics = ballisticsOf(projectile);
  const radii = radiiOf(explosion);
  const beamProfile = beamOf(beam);
  const ap: AttackProfile["ap"] = { front: damage.ap1 };
  if (typeof damage.ap2 === "number") ap.slight = damage.ap2;
  if (typeof damage.ap3 === "number") ap.large = damage.ap3;
  if (typeof damage.ap4 === "number") ap.extreme = damage.ap4;
  return {
    id,
    label: labelOf(type, name, damage),
    kind,
    aimed: kind !== "explosion",
    ap,
    standardDamage: damage.dmg,
    ...(typeof damage.dmg2 === "number" ? { durableDamage: damage.dmg2 } : {}),
    heat: type === "beam" || /fire|laser|heat|beam/i.test(`${damage.element_name ?? ""} ${damage.element_name_sub ?? ""}`),
    ...(kind !== "explosion" && rpm !== undefined ? { roundsPerMinute: rpm } : {}),
    ...(cooldown !== undefined ? { cooldownSeconds: cooldown } : {}),
    ...(ballistics ? { ballistics } : {}),
    ...(radii ? { explosion: radii } : {}),
    ...(beamProfile ? { beam: beamProfile } : {}),
    ...(kind === "explosion" && explosion?.shrapnel && typeof explosion.shrapnel_count === "number" && explosion.shrapnel_count > 0
      ? { shrapnelCount: explosion.shrapnel_count, shrapnelName: explosion.shrapnel }
      : {}),
  };
}

function lookupDamage(type: string, name: string, docs: DecodedDoc[]): DamageRec | undefined {
  if (type === "damage") return docs.map((doc) => doc.damage?.[name]).find((row) => row);
  const table = type === "explosion" ? "explosion" : type === "beam" ? "beam" : type === "arc" ? "arc" : type === "spray" ? "spray" : "projectile";
  const record = lookupTable(docs, table, name);
  const damageId = record?.damage_id;
  if (!damageId) return undefined;
  return docs.map((doc) => doc.damage?.[damageId]).find((row) => row);
}

function lookupTable(
  docs: DecodedDoc[],
  table: "projectile" | "explosion" | "beam" | "arc" | "spray",
  name: string,
): (ProjectileRec & ExplosionRec & BeamRec & ArcRec) | undefined {
  return docs.map((doc) => doc[table]?.[name]).find((row) => row);
}

function ballisticsOf(record: ProjectileRec | undefined): AttackProfile["ballistics"] | undefined {
  if (!record || typeof record.caliber !== "number" || typeof record.mass !== "number" || typeof record.drag !== "number") return undefined;
  return { sizeMm: record.caliber, massG: record.mass, drag: record.drag };
}

function radiiOf(record: ExplosionRec | undefined): AttackProfile["explosion"] | undefined {
  if (!record || typeof record.r1 !== "number") return undefined;
  const outer = typeof record.r2 === "number" && record.r2 > record.r1
    ? record.r2
    : typeof record.r3 === "number" && record.r3 > record.r1
      ? record.r3
      : undefined;
  if (outer === undefined) return undefined;
  return { innerRadius: record.r1, outerRadius: outer, falloff: "quick" };
}

function beamOf(record: BeamRec | undefined): AttackProfile["beam"] | undefined {
  if (!record || typeof record.range !== "number" || record.range <= 0) return undefined;
  return {
    falloffStart: typeof record.falloff_reverse_start === "number" ? record.falloff_reverse_start : 0,
    range: record.range,
    maxFalloff: typeof record.falloff === "number" ? record.falloff : 1,
  };
}

function labelOf(type: string, name: string, damage: DamageRec): string {
  if (type === "explosion" && /_IE$/i.test(name)) return "Impact Explosion";
  if (type === "damage") return "Melee";
  const sub = (damage.element_name_sub || "").trim();
  if (sub && sub.toLowerCase() !== "none") return sub.charAt(0).toUpperCase() + sub.slice(1);
  const element = (damage.element_name || "").trim();
  if (element && element.toLowerCase() !== "none") return element.charAt(0).toUpperCase() + element.slice(1);
  if (type === "explosion") return "Explosion";
  if (type === "beam") return "Beam";
  if (type === "arc") return "Arc";
  if (type === "spray") return "spray";
  return "projectile";
}

function namedWeapons(weaponsDoc: DecodedDoc, stratDoc: DecodedDoc): Named<WeaponRec>[] {
  const rows: Named<WeaponRec>[] = [];
  for (const doc of [weaponsDoc, stratDoc]) {
    for (const [name, value] of Object.entries(doc.weapons ?? {})) {
      rows.push({ name, value, internal: isInternal(name) });
    }
  }
  return rows;
}

function namedStratagems(stratDoc: DecodedDoc, weaponsDoc: DecodedDoc): Named<StratRec>[] {
  const rows: Named<StratRec>[] = [];
  for (const doc of [stratDoc, weaponsDoc]) {
    for (const [name, value] of Object.entries(doc.stratagems ?? {})) rows.push({ name, value, internal: false });
  }
  return rows;
}

function findMatch<T>(label: string, rows: Named<T>[]): T | undefined {
  let best: { value: T; score: number; internal: boolean; length: number } | undefined;
  for (const row of rows) {
    const score = matchScore(label, row.name);
    if (score === undefined) continue;
    const length = tokens(row.name).length;
    if (
      !best
      || score < best.score
      || (score === best.score && best.internal && !row.internal)
      || (score === best.score && best.internal === row.internal && length > best.length)
    ) {
      best = { value: row.value, score, internal: row.internal, length };
    }
  }
  return best?.value;
}

function findCatalog(label: string, catalog: CatalogItem[]): CatalogItem | undefined {
  let best: { item: CatalogItem; score: number } | undefined;
  for (const item of catalog) {
    if (item.productKind === "body-armor") continue;
    const score = catalogScore(label, `${item.model ?? ""} ${item.nameEn ?? ""}`.trim());
    if (score === undefined) continue;
    if (!best || score < best.score) best = { item, score };
  }
  return best?.item;
}

function catalogScore(label: string, candidate: string): number | undefined {
  const extras = alignedExtras(label, candidate);
  if (!extras || !extras.every(codeLike)) return undefined;
  return extras.length;
}

function covered(name: string, titles: string[]): boolean {
  return titles.some((title) => matchScore(name, title) !== undefined);
}

function matchScore(label: string, candidate: string): number | undefined {
  const extras = alignedExtras(label, candidate);
  return extras ? extras.length : undefined;
}

function alignedExtras(label: string, candidate: string): string[] | undefined {
  const a = tokens(label);
  const b = tokens(candidate);
  const inB = indexOfSlice(b, a);
  if (inB >= 0) return [...b.slice(0, inB), ...b.slice(inB + a.length)];
  const inA = indexOfSlice(a, b);
  if (inA >= 0) return [...a.slice(0, inA), ...a.slice(inA + b.length)];
  return undefined;
}

function indexOfSlice(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    if (needle.every((token, offset) => hay[index + offset] === token)) return index;
  }
  return -1;
}

function tokens(value: string): string[] {
  return value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
}

function codeLike(token: string): boolean {
  return token.length <= 3 || /\d/.test(token);
}

function isInternal(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.startsWith("UNDERBARREL") || upper.startsWith("BACKPACK_") || /DR\s*0$/.test(upper);
}

function slotFromCategory(category: string): Slot | undefined {
  if (category === "Primary Weapons") return "primary";
  if (category === "Secondary Weapons") return "secondary";
  if (category === "Throwables") return "grenade";
  if (category === "Support Weapons") return "support";
  return undefined;
}

function guessSlot(name: string): Slot {
  if (/^(G|K)-/i.test(name)) return "grenade";
  if (/^(P|GP|CQC)-/i.test(name)) return "secondary";
  return "primary";
}

function readable(title: string): string {
  if (title !== title.toUpperCase()) return title;
  return title
    .replace(/TANKII/g, "TANK II")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bIi\b/g, "II")
    .replace(/\bKg\b/g, "kg")
    .replace(/\bMm\b/g, "mm");
}

function modelCode(title: string): string | undefined {
  const match = title.match(/^([A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)*)/);
  if (!match || !/\d/.test(match[1])) return undefined;
  return match[1];
}

function versionText(weaponsDoc: DecodedDoc, stratDoc: DecodedDoc): string {
  const weapon = weaponsDoc.wep_version?.trim() || "";
  const strat = stratDoc.strat_version?.trim() || "";
  if (weapon && strat && weapon !== strat) return `${weapon} / ${strat}`;
  return weapon || strat;
}

function sane(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 0 && value < 10000 ? value : undefined;
}

function slug(value: string): string {
  const id = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return id || "gear";
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base || "gear";
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

async function fetchModule(title: string): Promise<DecodedDoc> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    titles: title,
  });
  const data = await readJson<WikiQuery>(`/wiki-api/api.php?${params}`);
  for (const page of Object.values(data.query?.pages ?? {})) {
    const slot = page.revisions?.[0]?.slots?.main;
    const body = slot?.["*"] ?? slot?.content ?? "";
    if (body.trim().startsWith("{")) return JSON.parse(body) as DecodedDoc;
  }
  throw new Error(title);
}

async function fetchCargo(table: string, fields: string): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    tables: table,
    fields,
    limit: "500",
  });
  const data = await readJson<{ cargoquery?: { title?: Record<string, string> }[] }>(`/wiki-api/api.php?${params}`);
  return (data.cargoquery ?? []).flatMap((item) => item.title ? [item.title] : []);
}

function weaponCargo(rows: Record<string, string>[]): CargoWeapon[] {
  return rows.flatMap((row) => {
    const title = (row.title || "").trim();
    const page = (row.page || "").trim();
    if (!title) return [];
    return [{ title, ...(page && page !== title ? { page } : {}), category: row["weapon category"] || row.weapon_category || "" }];
  });
}

function stratCargo(rows: Record<string, string>[]): CargoStratagem[] {
  return rows.flatMap((row) => {
    const title = (row.title || "").trim();
    const page = (row.page || "").trim();
    if (!title) return [];
    return [{ title, ...(page && page !== title ? { page } : {}), type: row["stratagem type"] || row.stratagem_type || "" }];
  });
}

const LEGACY_STOP = new Set(["EXPLOSION", "PROJECTILE", "ARC", "BEAM", "TURRET", "TOWER", "GRENADE", "HAND", "THE", "ORBITAL"]);

function legacyAttack(labels: string[], legacy: LegacyDoc | undefined, id: string, cooldown: number | undefined): AttackProfile | undefined {
  if (!legacy) return undefined;
  const labelTokens = new Set(labels.flatMap(tokens));
  let best: { count: number; attack: AttackProfile } | undefined;
  let tied = false;
  for (const table of ["explosion", "projectile", "beam", "arc"] as const) {
    for (const [key, record] of Object.entries(legacy[table] ?? {})) {
      const recordName = record.name || key;
      if (/bug|illuminate|cyborg|terminid|automaton|hulk|charger/i.test(`${key} ${recordName}`)) continue;
      const marks = tokens(recordName).filter((token) => token.length >= 5 && !LEGACY_STOP.has(token));
      if (marks.length === 0 || !marks.every((token) => labelTokens.has(token))) continue;
      const damage = record.damageid ? legacy.damage?.[record.damageid] : undefined;
      if (!damage || typeof damage.dmg !== "number" || damage.dmg <= 0 || typeof damage.ap1 !== "number") continue;
      const damageTokens = tokens(`${damage.name ?? ""} ${record.damageid ?? ""}`);
      if (!marks.some((token) => damageTokens.includes(token))) continue;
      const attack = legacyProfile(table, record, damage, id, cooldown);
      if (!best || marks.length > best.count) {
        best = { count: marks.length, attack };
        tied = false;
      } else if (marks.length === best.count) tied = true;
    }
  }
  return best && !tied ? best.attack : undefined;
}

function legacyProfile(
  table: "explosion" | "projectile" | "beam" | "arc",
  record: LegacyRecord,
  damage: LegacyDamage,
  id: string,
  cooldown: number | undefined,
): AttackProfile {
  const kind = table === "explosion" ? "explosion" : table === "beam" ? "beam" : "projectile";
  const ap: AttackProfile["ap"] = { front: damage.ap1 ?? 0 };
  if (typeof damage.ap2 === "number") ap.slight = damage.ap2;
  if (typeof damage.ap3 === "number") ap.large = damage.ap3;
  if (typeof damage.ap4 === "number") ap.extreme = damage.ap4;
  const radii = table === "explosion" ? radiiOf(record) : undefined;
  const ballistics = table === "projectile" ? ballisticsOf(record) : undefined;
  const beam = table === "beam" ? beamOf(record) : undefined;
  return {
    id,
    label: table === "explosion" ? "Explosion" : table === "arc" ? "Arc" : table === "beam" ? "Beam" : labelOf(table, "", damage),
    kind,
    aimed: kind !== "explosion",
    ap,
    standardDamage: damage.dmg ?? 0,
    ...(typeof damage.dmg2 === "number" ? { durableDamage: damage.dmg2 } : {}),
    heat: table === "beam" || /fire|laser|heat|beam/i.test(`${damage.element_name ?? ""} ${damage.element_name_sub ?? ""}`),
    ...(cooldown !== undefined ? { cooldownSeconds: cooldown } : {}),
    ...(ballistics ? { ballistics } : {}),
    ...(radii ? { explosion: radii } : {}),
    ...(beam ? { beam } : {}),
  };
}

async function fetchLang(titles: string[]): Promise<Record<string, string>> {
  const lang: Record<string, string> = {};
  const unique = [...new Set(titles.map((title) => title.trim()).filter((title) => title !== ""))];
  for (let index = 0; index < unique.length; index += 40) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "langlinks",
      lllang: "zh",
      lllimit: "500",
      titles: unique.slice(index, index + 40).join("|"),
    });
    const data = await readJson<LangQuery>(`/wiki-api/api.php?${params}`);
    for (const page of Object.values(data.query?.pages ?? {})) {
      const link = page.langlinks?.find((item) => item.lang === "zh");
      const text = link?.["*"] ?? link?.title ?? "";
      if (page.title && text) lang[page.title] = text;
    }
  }
  return lang;
}

async function fetchOverlay(): Promise<{ catalog: CatalogItem[]; aliases: Record<string, string[]> }> {
  try {
    const [catalog, aliasFile] = await Promise.all([
      readJson<CatalogItem[] | { items?: CatalogItem[] }>("/hd2-data/catalog.json"),
      readJson<unknown>("/hd2-data/community-aliases.json"),
    ]);
    const items = Array.isArray(catalog) ? catalog : catalog.items ?? [];
    return { catalog: items, aliases: aliasMap(aliasFile) };
  } catch {
    return { catalog: [], aliases: {} };
  }
}

function aliasMap(data: unknown): Record<string, string[]> {
  if (!data || typeof data !== "object") return {};
  const entries = (data as { entries?: { equipmentId?: string; aliases?: unknown }[] }).entries;
  if (!Array.isArray(entries)) return data as Record<string, string[]>;
  const aliases: Record<string, string[]> = {};
  for (const entry of entries) {
    if (!entry.equipmentId || !Array.isArray(entry.aliases)) continue;
    aliases[entry.equipmentId] = entry.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim() !== "");
  }
  return aliases;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  return response.json() as Promise<T>;
}
