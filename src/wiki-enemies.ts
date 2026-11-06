import type { Enemy, Part } from "./model";

interface CargoTitle {
  page?: string;
  title?: string;
  faction?: string;
  health?: string;
  "fire mult"?: string;
  "arc mult"?: string;
  "acid mult"?: string;
  "gas mult"?: string;
}

const CYBORG = "生化人军团";

export function parseAnatomy(wikitext: string, mainHealth: number | undefined): Part[] {
  const parts: Part[] = [];
  const used = new Set<string>();
  for (const row of wikitext.split(/\{\{Anatomy Row/i).slice(1)) {
    const fields = parseFields(row.split("}}")[0] ?? "");
    const name = cleanName(fields.part_name ?? "");
    const armor = leadingInt(fields.av ?? "");
    if (!name || armor === undefined || armor < 0 || armor > 10) continue;
    const health = parseHealth(fields.health ?? "", mainHealth);
    const durability = parseDurability(fields.durability ?? "");
    const percentToMain = parsePercent(fields.percent_to_main ?? "");
    const bleed = parseBleed(fields.bleed ?? "");
    const explosionResist = parseExdr(fields.exdr ?? "");
    const id = uniqueId(name, parts.length, used);
    used.add(id);
    parts.push({
      id,
      name,
      armor,
      ...(health !== undefined ? { health } : {}),
      ...(durability !== undefined ? { durability } : {}),
      fatal: isFatal(fields.fatal ?? ""),
      breakable: false,
      ...(percentToMain !== undefined ? { percentToMain } : {}),
      ...(bleed ? { bleed: bleed.amount, bleedPerSecond: bleed.perSecond } : {}),
      ...(explosionResist !== undefined ? { explosionResist } : {}),
    });
  }
  return dedupeParts(parts);
}

export function enemyFromWiki(row: CargoTitle, wikitext: string): Enemy | null {
  const page = (row.page || row.title || "").trim();
  const name = (row.title || row.page || "").trim();
  if (!page || !name || (row.faction ?? "").trim() === CYBORG) return null;
  const health = leadingInt((row.health ?? "").replace(/,/g, ""));
  const nameEn = englishName(wikitext);
  const id = slug(nameEn) || page;
  return {
    id,
    name,
    ...(nameEn ? { nameEn } : {}),
    faction: (row.faction ?? "").trim(),
    ...(health !== undefined ? { health } : {}),
    wikiUrl: `https://helldivers.wiki.gg/zh/${encodeURIComponent(page.replace(/ /g, "_"))}`,
    multipliers: multipliers(row),
    parts: parseAnatomy(wikitext, health),
  };
}

export async function fetchWikiEnemies(): Promise<Enemy[]> {
  const rows = await cargoEnemies();
  const text = await fetchWikitext(rows.map((row) => (row.page || row.title || "").trim()).filter((page) => page !== ""));
  const enemies: Enemy[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const page = (row.page || row.title || "").trim();
    const enemy = enemyFromWiki(row, text.get(page) ?? "");
    if (!enemy) continue;
    let id = enemy.id;
    let n = 2;
    while (used.has(id)) id = `${enemy.id}-${n++}`;
    used.add(id);
    enemies.push(id === enemy.id ? enemy : { ...enemy, id });
  }
  return enemies;
}

async function cargoEnemies(): Promise<CargoTitle[]> {
  const params = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    tables: "Enemies",
    fields: "_pageName=page,title,faction,health,fire_mult,arc_mult,acid_mult,gas_mult",
    where: 'game="Helldivers 2"',
    limit: "500",
    order_by: "_pageName",
  });
  const data = await readJson<{ cargoquery?: { title?: CargoTitle }[] }>(`/wiki-api/zh/api.php?${params}`);
  return (data.cargoquery ?? []).flatMap((item) => item.title ? [item.title] : []);
}

interface WikiRevision {
  slots?: { main?: { content?: string } & Record<string, string | undefined> };
}

interface WikiQuery {
  query?: { pages?: Record<string, { title?: string; revisions?: WikiRevision[] }> };
}

async function fetchWikitext(pages: string[]): Promise<Map<string, string>> {
  const text = new Map<string, string>();
  for (let index = 0; index < pages.length; index += 20) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: pages.slice(index, index + 20).join("|"),
    });
    const data = await readJson<WikiQuery>(`/wiki-api/zh/api.php?${params}`);
    for (const page of Object.values(data.query?.pages ?? {})) {
      const slot = page.revisions?.[0]?.slots?.main;
      const body = slot?.["*"] ?? slot?.content ?? "";
      if (page.title) text.set(page.title, body);
    }
  }
  return text;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  return response.json() as Promise<T>;
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*\|\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function cleanName(value: string): string {
  return stripTags(value).replace(/\s*\(\d+\)\s*$/, "").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

function leadingInt(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/-?\d+/);
  if (!match) return undefined;
  return Number(match[0]);
}

function parseHealth(value: string, mainHealth: number | undefined): number | undefined {
  if (/^main$/i.test(value.trim())) return mainHealth;
  return leadingInt(value);
}

function isFatal(value: string): boolean {
  const text = stripTags(value);
  if (/非致死|否|^no\b/i.test(text)) return false;
  return /致死|^yes\b|^是/i.test(text);
}

function parseExdr(value: string): number | undefined {
  const text = stripTags(value).trim();
  if (text === "" || text === "-" || text === "—" || /^none$/i.test(text) || text === "无" || /^no$/i.test(text) || text === "否") return undefined;
  if (/^yes$/i.test(text) || text === "是") return 1;
  const ratio = parsePercent(text);
  if (ratio === undefined || ratio <= 0) return undefined;
  return ratio;
}

function parsePercent(value: string): number | undefined {
  const text = value.trim();
  if (text === "" || text === "-" || text === "—" || /^none$/i.test(text) || text.includes("无")) return undefined;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return undefined;
  const ratio = Number(match[1]) / 100;
  if (ratio < 0 || ratio > 1) return undefined;
  return ratio;
}

function parseBleed(value: string): { amount: number; perSecond: number } | undefined {
  const text = stripTags(value).replace(/,/g, "");
  if (text === "" || text === "-" || text === "—" || /none|无/i.test(text)) return undefined;
  const amount = text.match(/(\d+(?:\.\d+)?)/);
  if (!amount) return undefined;
  const rate = text.match(/\[\s*(\d+(?:\.\d+)?)\s*\/s\s*\]/i);
  return { amount: Number(amount[1]), perSecond: rate ? Number(rate[1]) : 0 };
}

function dedupeParts(parts: Part[]): Part[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const name = part.name.replace(/\s*[（(][^）)]*[）)]/g, "").trim();
    const key = [name, part.armor, part.health ?? "", part.durability ?? "", part.fatal, part.percentToMain ?? "", part.bleed ?? "", part.explosionResist ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDurability(value: string): number | undefined {
  const text = value.trim();
  if (text === "" || text === "-" || /^none$/i.test(text)) return undefined;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!match) return undefined;
  const number = Number(match[1]);
  const ratio = text.includes("%") || number > 1 ? number / 100 : number;
  if (ratio < 0 || ratio > 1) return undefined;
  return ratio;
}

function uniqueId(name: string, index: number, used: Set<string>): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = ascii || `part-${index + 1}`;
  if (!used.has(base)) return base;
  return `${base}-${index + 1}`;
}

function englishName(wikitext: string): string {
  const match = wikitext.match(/\|\s*image\s*=\s*([^\n|]+)/);
  if (!match) return "";
  return match[1]
    .replace(/_/g, " ")
    .replace(/\.(png|webp|jpg)\s*$/i, "")
    .replace(/\s+enemy icon(?: render)?\s*$/i, "")
    .replace(/\s+image icon\s*$/i, "")
    .trim();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function multipliers(row: CargoTitle): Enemy["multipliers"] {
  const multipliers: Enemy["multipliers"] = {};
  const fire = numberOrEmpty(row["fire mult"]);
  const arc = numberOrEmpty(row["arc mult"]);
  const acid = numberOrEmpty(row["acid mult"]);
  const gas = numberOrEmpty(row["gas mult"]);
  if (fire !== undefined) multipliers.fire = fire;
  if (arc !== undefined) multipliers.arc = arc;
  if (acid !== undefined) multipliers.acid = acid;
  if (gas !== undefined) multipliers.gas = gas;
  return multipliers;
}

function numberOrEmpty(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
