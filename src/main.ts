import { assess, type KillCard } from "./assess";
import type { Enemy, GearPiece, Gloom, Situation, Slot, Weather } from "./model";
import { mapPlanet } from "./planets";

const SELECTION_KEY = "hd2-kill-selection";
const PLANET_KEY = "hd2-kill-planets";

const WEATHERS: { id: Weather; label: string }[] = [
  { id: "acid-storms", label: "酸雨" },
  { id: "blizzards", label: "暴风雪" },
  { id: "extreme-cold", label: "严寒" },
  { id: "fire-tornados", label: "火焰龙卷" },
  { id: "intense-heat", label: "酷热" },
  { id: "ion-storms", label: "离子风暴" },
  { id: "meteor-storms", label: "陨石" },
  { id: "rainstorms", label: "暴雨" },
  { id: "sandstorms", label: "沙尘暴" },
  { id: "thick-fog", label: "浓雾" },
  { id: "tremors", label: "地震" },
  { id: "volcanic-activity", label: "火山活动" },
];

const GLOOMS: { id: Gloom; label: string }[] = [
  { id: "none", label: "无" },
  { id: "light", label: "轻" },
  { id: "moderate", label: "中" },
  { id: "heavy", label: "重" },
  { id: "source", label: "源头" },
];

const DAMAGE_WORD: Record<KillCard["damageTypes"][number]["type"], string> = {
  fire: "火焰",
  arc: "电弧",
  acid: "酸液",
  gas: "气体",
};

const WEAPON_ROWS: { id: string; label: string; slot: Slot }[] = [
  { id: "primary", label: "主武器", slot: "primary" },
  { id: "secondary", label: "副武器", slot: "secondary" },
  { id: "grenade", label: "手雷", slot: "grenade" },
  { id: "support", label: "支援武器", slot: "support" },
];

interface EnvironmentTables {
  hazards: Record<string, string>;
  gloom: Record<string, "light" | "moderate" | "heavy" | "source">;
}

interface MetaFile {
  importedAt?: string;
  conflicts?: string[];
}

interface PlanetRecord {
  name: string;
  hazards: { name: string }[];
}

interface PlanetCache {
  fetchedAt: string;
  planets: PlanetRecord[];
}

interface Selection {
  primary: string;
  secondary: string;
  grenade: string;
  support: string;
  stratagems: string[];
  enemyId: string;
  weather: Weather[];
  gloom: Gloom;
}

interface GearRow {
  id: string;
  slot: Slot;
  search: HTMLInputElement;
  select: HTMLSelectElement;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("缺少 #app");

const title = document.createElement("h1");
title.textContent = "击杀卡";
const loadoutSection = document.createElement("section");
const loadoutHeading = document.createElement("h2");
loadoutHeading.textContent = "配装";
loadoutSection.append(loadoutHeading);
const enemySection = document.createElement("section");
const enemyHeading = document.createElement("h2");
enemyHeading.textContent = "敌人";
enemySection.append(enemyHeading);
const environmentSection = document.createElement("section");
const environmentHeading = document.createElement("h2");
environmentHeading.textContent = "环境";
environmentSection.append(environmentHeading);
const card = document.createElement("section");
card.id = "card";
card.textContent = "先选一个敌人";
app.append(title, loadoutSection, enemySection, environmentSection, card);

const gearRows: GearRow[] = WEAPON_ROWS.map((row) => addGearRow(loadoutSection, row.label, row.slot, row.id));
const stratagemRows: GearRow[] = [0, 1, 2, 3].map((index) => (
  addGearRow(loadoutSection, `战略 ${index + 1}`, "stratagem", `stratagem-${index}`)
));
const enemySearch = document.createElement("input");
enemySearch.type = "text";
enemySearch.id = "enemy-search";
enemySearch.autocomplete = "off";
enemySearch.placeholder = "搜索名称或 id";
const enemySelect = document.createElement("select");
enemySelect.id = "enemy";
const enemyField = field("敌人", enemySearch, enemySelect);
enemySection.append(enemyField);

const planetRow = document.createElement("div");
planetRow.className = "planet-row";
const loadPlanetsButton = document.createElement("button");
loadPlanetsButton.type = "button";
loadPlanetsButton.id = "load-planets";
loadPlanetsButton.textContent = "读取星球";
const planetStatus = document.createElement("span");
planetStatus.id = "planet-status";
planetRow.append(loadPlanetsButton, planetStatus);
const planetSelect = document.createElement("select");
planetSelect.id = "planet";
const checks = document.createElement("div");
checks.className = "checks";
const weatherBoxes = WEATHERS.map((weather) => {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = `weather-${weather.id}`;
  box.value = weather.id;
  const label = document.createElement("label");
  label.append(box, document.createTextNode(weather.label));
  checks.append(label);
  return box;
});
const gloomSelect = document.createElement("select");
gloomSelect.id = "gloom";
for (const gloom of GLOOMS) gloomSelect.append(option(gloom.id, gloom.label));
const unknownHazardsLine = document.createElement("p");
unknownHazardsLine.id = "unknown-hazards";
environmentSection.append(planetRow, field("星球", planetSelect), checks, field("阴霾", gloomSelect), unknownHazardsLine);

let equipment: GearPiece[] = [];
let enemies: Enemy[] = [];
let aliases: Record<string, string[]> = {};
let environment: EnvironmentTables = { hazards: {}, gloom: {} };
let meta: MetaFile = {};
let planetCache: PlanetCache | null = null;
let boundPlanet = "";
let unknownHazards: string[] = [];
let cachedAt: string | undefined;
let quiet = false;

enemySearch.addEventListener("input", () => fillEnemySelect());
enemySelect.addEventListener("change", () => {
  if (quiet) return;
  saveSelection();
  renderCard();
});
for (const box of weatherBoxes) box.addEventListener("change", onManualEnvironment);
gloomSelect.addEventListener("change", onManualEnvironment);
planetSelect.addEventListener("change", () => {
  if (quiet) return;
  if (planetSelect.value === "") clearPlanetBinding();
  else applyPlanet(planetSelect.value);
  saveSelection();
  renderCard();
});
loadPlanetsButton.addEventListener("click", () => {
  void refreshPlanets();
});

void boot();

async function boot(): Promise<void> {
  try {
    const [gear, enemyRows, aliasRows, tables, metaFile] = await Promise.all([
      readJson<GearPiece[]>("/data/equipment.json"),
      readJson<Enemy[]>("/data/enemies.json"),
      readJson<Record<string, string[]>>("/data/aliases.json"),
      readJson<EnvironmentTables>("/data/environment.json"),
      readJson<MetaFile>("/data/meta.json"),
    ]);
    equipment = gear;
    enemies = enemyRows;
    aliases = aliasRows;
    environment = tables;
    meta = metaFile;
    planetCache = readPlanetCache();
    fillPlanets();
    restoreSelection();
    renderCard();
  } catch {
    card.textContent = "数据没有读到";
  }
}

function addGearRow(parent: HTMLElement, label: string, slot: Slot, id: string): GearRow {
  const search = document.createElement("input");
  search.type = "text";
  search.id = `search-${id}`;
  search.autocomplete = "off";
  search.placeholder = "搜索名称、型号、英文名或别名";
  const select = document.createElement("select");
  select.id = `gear-${id}`;
  const row: GearRow = { id, slot, search, select };
  search.addEventListener("input", () => fillGearSelect(row));
  select.addEventListener("change", () => {
    if (quiet) return;
    saveSelection();
    renderCard();
  });
  parent.append(field(label, search, select));
  return row;
}

function field(label: string, ...controls: HTMLElement[]): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  wrap.append(name, ...controls);
  return wrap;
}

function option(value: string, label: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  return response.json() as Promise<T>;
}

function aliasList(id: string): string[] {
  const value = aliases[id];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function matches(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function gearMatches(piece: GearPiece, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const fields = [piece.name, piece.model ?? "", piece.nameEn ?? "", ...aliasList(piece.id)];
  return fields.some((fieldText) => matches(fieldText, needle));
}

function enemyMatches(enemy: Enemy, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return matches(enemy.name, needle) || matches(enemy.id, needle);
}

function gearText(piece: GearPiece): string {
  const parts = [piece.name];
  if (piece.model && piece.model !== piece.name) parts.push(piece.model);
  if (piece.nameEn && piece.nameEn !== piece.name && piece.nameEn !== piece.model) parts.push(piece.nameEn);
  return parts.join(" ");
}

function fillGearSelect(row: GearRow): void {
  const selected = row.select.value;
  const pieces = equipment
    .filter((piece) => piece.slot === row.slot)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
  quiet = true;
  try {
    row.select.replaceChildren(option("", "空"));
    for (const piece of pieces) {
      if (piece.id !== selected && !gearMatches(piece, row.search.value)) continue;
      row.select.append(option(piece.id, gearText(piece)));
    }
    row.select.value = pieces.some((piece) => piece.id === selected) ? selected : "";
  } finally {
    quiet = false;
  }
}

function fillEnemySelect(): void {
  const selected = enemySelect.value;
  const rows = enemies.slice().sort((a, b) => a.name.localeCompare(b.name, "zh"));
  quiet = true;
  try {
    enemySelect.replaceChildren(option("", "空"));
    for (const enemy of rows) {
      if (enemy.id !== selected && !enemyMatches(enemy, enemySearch.value)) continue;
      enemySelect.append(option(enemy.id, enemy.name));
    }
    enemySelect.value = rows.some((enemy) => enemy.id === selected) ? selected : "";
  } finally {
    quiet = false;
  }
}

function fillPlanets(): void {
  const selected = planetSelect.value;
  quiet = true;
  let stillThere = false;
  try {
    planetSelect.replaceChildren(option("", "不指定"));
    for (const planet of planetCache?.planets ?? []) {
      planetSelect.append(option(planet.name, planet.name));
    }
    stillThere = [...planetSelect.options].some((item) => item.value === selected);
    planetSelect.value = stillThere ? selected : "";
  } finally {
    quiet = false;
  }
  if (!stillThere) clearPlanetBinding();
}

function knownWeather(value: string): value is Weather {
  return WEATHERS.some((weather) => weather.id === value);
}

function knownGloom(value: string): value is Gloom {
  return GLOOMS.some((gloom) => gloom.id === value);
}

function emptySelection(): Selection {
  return {
    primary: "",
    secondary: "",
    grenade: "",
    support: "",
    stratagems: ["", "", "", ""],
    enemyId: "",
    weather: [],
    gloom: "none",
  };
}

function readSelection(): Selection {
  const fallback = emptySelection();
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Selection>;
    const stratagems = Array.isArray(parsed.stratagems) ? parsed.stratagems.filter((id): id is string => typeof id === "string") : [];
    while (stratagems.length < 4) stratagems.push("");
    return {
      primary: typeof parsed.primary === "string" ? parsed.primary : "",
      secondary: typeof parsed.secondary === "string" ? parsed.secondary : "",
      grenade: typeof parsed.grenade === "string" ? parsed.grenade : "",
      support: typeof parsed.support === "string" ? parsed.support : "",
      stratagems: stratagems.slice(0, 4),
      enemyId: typeof parsed.enemyId === "string" ? parsed.enemyId : "",
      weather: Array.isArray(parsed.weather) ? parsed.weather.filter((item): item is Weather => typeof item === "string" && knownWeather(item)) : [],
      gloom: typeof parsed.gloom === "string" && knownGloom(parsed.gloom) ? parsed.gloom : "none",
    };
  } catch {
    return fallback;
  }
}

function gearById(id: string): GearPiece | undefined {
  return equipment.find((piece) => piece.id === id);
}

function restoreSelection(): void {
  const saved = readSelection();
  const slots: Record<"primary" | "secondary" | "grenade" | "support", GearRow> = {
    primary: gearRows[0],
    secondary: gearRows[1],
    grenade: gearRows[2],
    support: gearRows[3],
  };
  for (const row of [...gearRows, ...stratagemRows]) fillGearSelect(row);
  fillEnemySelect();
  for (const key of ["primary", "secondary", "grenade", "support"] as const) {
    const piece = gearById(saved[key]);
    if (piece && piece.slot === slots[key].slot) slots[key].select.value = piece.id;
  }
  stratagemRows.forEach((row, index) => {
    const piece = gearById(saved.stratagems[index] ?? "");
    if (piece && piece.slot === "stratagem") row.select.value = piece.id;
  });
  if (enemies.some((enemy) => enemy.id === saved.enemyId)) enemySelect.value = saved.enemyId;
  for (const box of weatherBoxes) box.checked = saved.weather.includes(box.value as Weather);
  gloomSelect.value = saved.gloom;
}

function saveSelection(): void {
  const selection: Selection = {
    primary: gearRows[0].select.value,
    secondary: gearRows[1].select.value,
    grenade: gearRows[2].select.value,
    support: gearRows[3].select.value,
    stratagems: stratagemRows.map((row) => row.select.value),
    enemyId: enemySelect.value,
    weather: weatherBoxes.filter((box) => box.checked).map((box) => box.value as Weather),
    gloom: knownGloom(gloomSelect.value) ? gloomSelect.value : "none",
  };
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    planetStatus.textContent = "选择没有写入本地";
  }
}

function hazardNames(value: unknown): { name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hazard) => {
    if (typeof hazard === "string") return [{ name: hazard }];
    if (hazard && typeof hazard === "object" && typeof (hazard as { name?: unknown }).name === "string") {
      return [{ name: (hazard as { name: string }).name }];
    }
    return [];
  });
}

function normalizePlanets(payload: unknown): PlanetRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { planets?: unknown }).planets)
      ? (payload as { planets: unknown[] }).planets
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || typeof (row as { name?: unknown }).name !== "string") return [];
    const name = (row as { name: string }).name;
    if (name.trim() === "") return [];
    const hazards = hazardNames((row as { hazards?: unknown }).hazards)
      .filter((hazard) => hazard.name.trim().toLowerCase() !== "none");
    return [{ name, hazards }];
  });
}

function readPlanetCache(): PlanetCache | null {
  try {
    const raw = localStorage.getItem(PLANET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlanetCache>;
    if (!Array.isArray(parsed.planets)) return null;
    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      planets: normalizePlanets(parsed.planets),
    };
  } catch {
    return null;
  }
}

function showUnknown(): void {
  unknownHazardsLine.textContent = boundPlanet && unknownHazards.length > 0 ? unknownHazards.join("、") : "";
}

function clearPlanetBinding(): void {
  boundPlanet = "";
  unknownHazards = [];
  cachedAt = undefined;
  showUnknown();
}

function applyPlanet(name: string): void {
  const planet = planetCache?.planets.find((item) => item.name === name);
  if (!planet) {
    clearPlanetBinding();
    return;
  }
  const mapped = mapPlanet(planet, environment);
  for (const box of weatherBoxes) box.checked = mapped.weather.includes(box.value as Weather);
  gloomSelect.value = mapped.gloom;
  boundPlanet = planet.name;
  unknownHazards = mapped.unknownHazards;
  cachedAt = planetCache?.fetchedAt;
  showUnknown();
}

function onManualEnvironment(): void {
  if (planetSelect.value !== "") planetSelect.value = "";
  clearPlanetBinding();
  saveSelection();
  renderCard();
}

async function refreshPlanets(): Promise<void> {
  loadPlanetsButton.disabled = true;
  planetStatus.textContent = "读取中";
  const previous = planetSelect.value;
  try {
    const response = await fetch("/hd2-api/api/v1/planets", {
      headers: { "X-Super-Client": "hd2-kill-card", "X-Super-Contact": "hd2-kill-card@local" },
    });
    if (!response.ok) throw new Error(String(response.status));
    const planets = normalizePlanets(await response.json());
    if (planets.length === 0) throw new Error("empty");
    const stored: PlanetCache = { fetchedAt: new Date().toISOString(), planets };
    planetCache = stored;
    let storedLocally = true;
    try {
      localStorage.setItem(PLANET_KEY, JSON.stringify(stored));
    } catch {
      storedLocally = false;
    }
    fillPlanets();
    if (previous && planetSelect.value === previous) applyPlanet(previous);
    planetStatus.textContent = storedLocally ? "已更新星球" : "星球没有写入本地";
    saveSelection();
    renderCard();
  } catch {
    planetCache = readPlanetCache();
    fillPlanets();
    if (previous && planetSelect.value === previous) applyPlanet(previous);
    planetStatus.textContent = planetCache && planetCache.planets.length > 0 ? "读取失败，改用上次的星球" : "读取失败，请手动设置环境";
    saveSelection();
    renderCard();
  } finally {
    loadPlanetsButton.disabled = false;
  }
}

function currentGear(): GearPiece[] {
  const ids = [...gearRows, ...stratagemRows].map((row) => row.select.value).filter((id) => id !== "");
  return ids.flatMap((id) => {
    const piece = gearById(id);
    return piece ? [piece] : [];
  });
}

function currentSituation(): Situation {
  const situation: Situation = {
    weather: weatherBoxes.filter((box) => box.checked).map((box) => box.value as Weather),
    gloom: knownGloom(gloomSelect.value) ? gloomSelect.value : "none",
  };
  if (boundPlanet) {
    situation.unknownHazards = unknownHazards;
    if (cachedAt) situation.cachedAt = cachedAt;
  }
  return situation;
}

function addLines(parent: HTMLElement, title: string, lines: string[]): void {
  if (lines.length === 0) return;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  parent.append(heading, list);
}

function addText(parent: HTMLElement, title: string, text: string): void {
  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  parent.append(heading, paragraph);
}

function addParagraph(parent: HTMLElement, text: string): void {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  parent.append(paragraph);
}

function basisDetails(result: KillCard): HTMLDetailsElement | null {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "依据";
  details.append(summary);
  for (const rule of result.rules) addParagraph(details, rule);
  addLines(details, "缺失", result.missing);
  addLines(details, "冲突", result.conflicts);
  if (result.wikiUrl) {
    const wiki = document.createElement("p");
    const link = document.createElement("a");
    link.href = result.wikiUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = result.wikiUrl;
    wiki.append(link);
    details.append(wiki);
  }
  if (result.importedAt) addParagraph(details, result.importedAt);
  return details.childElementCount > 1 ? details : null;
}

function formatWeak(point: KillCard["weakPoints"][number]): string {
  const bits = [`${point.name} 护甲 ${point.armor}`];
  if (point.fatal) bits.push("致命");
  if (point.durability !== undefined) bits.push(`耐久 ${point.durability}`);
  if (point.note) bits.push(point.note);
  return bits.join(" ");
}

function formatGear(item: KillCard["gear"][number]): string {
  const target = item.target ? `，${item.target}` : "";
  const shots = item.shots === undefined || item.reason.includes(`${item.shots} 发`) ? "" : `，${item.shots} 发`;
  return `${item.name} ${item.component}${target}：${item.reason}${shots}`;
}

function renderCard(): void {
  const enemy = enemies.find((item) => item.id === enemySelect.value);
  card.replaceChildren();
  if (!enemy) {
    card.textContent = "先选一个敌人";
    return;
  }
  const result = assess(enemy, currentGear(), currentSituation(), {
    importedAt: meta.importedAt,
    conflicts: meta.conflicts,
  });
  addText(card, "打法", result.method);
  if (result.conditions.length > 0) addLines(card, "条件", result.conditions);
  if (result.environment.length > 0) addLines(card, "环境", result.environment);
  if (result.damageTypes.length > 0) {
    addLines(card, "伤害类型", result.damageTypes.map((item) => `${DAMAGE_WORD[item.type]}：${item.label}`));
  }
  if (result.weakPoints.length > 0) addLines(card, "弱点", result.weakPoints.map(formatWeak));
  else if (enemy.parts.length === 0) addText(card, "弱点", "部位暂缺");
  if (result.gear.length > 0) {
    addLines(card, "你的装备", result.gear.map(formatGear));
    if (result.blockedCount > 0) addParagraph(card, `打不穿：${result.blockedCount}`);
  } else if (result.blockedCount > 0) {
    addParagraph(card, `打不穿：${result.blockedCount}`);
  }
  const details = basisDetails(result);
  if (details) card.append(details);
}
