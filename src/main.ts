import { assess, type KillCard } from "./assess";
import type { Enemy, GearPiece, Gloom, Situation, Slot, Weather } from "./model";
import { mapPlanet } from "./planets";
import { fetchWikiEnemies } from "./wiki-enemies";
import { fetchWikiGear } from "./wiki-gear";

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

interface Choice {
  value: string;
  label: string;
  hint: string;
  search: string;
}

interface Picker {
  input: HTMLInputElement;
  list: HTMLDivElement;
  value: string;
  active: number;
  options: () => Choice[];
  onChange: () => void;
}

interface GearRow {
  id: string;
  slot: Slot;
  picker: Picker;
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

const pickers: Picker[] = [];
const gearRows: GearRow[] = WEAPON_ROWS.map((row) => addGearRow(loadoutSection, row.label, row.slot, row.id));
const stratagemRows: GearRow[] = [0, 1, 2, 3].map((index) => (
  addGearRow(loadoutSection, `战略 ${index + 1}`, "stratagem", `stratagem-${index}`)
));
const enemyPicker = createPicker(enemySection, "敌人", "enemy", "输入名称或 id", enemyOptions, () => {
  saveSelection();
  renderCard();
});

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
let loadNote = "";
let planetCache: PlanetCache | null = null;
let boundPlanet = "";
let unknownHazards: string[] = [];
let cachedAt: string | undefined;
let quiet = false;

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
  card.textContent = "正在读取武器和敌人";
  const [gearResult, enemyResult, tables] = await Promise.all([
    loadGear(),
    fetchWikiEnemies().then((rows) => ({ rows, error: "" })).catch(() => ({ rows: [] as Enemy[], error: "敌人没有读到" })),
    readJson<EnvironmentTables>("/data/environment.json").catch(() => ({ hazards: {}, gloom: {} })),
  ]);
  equipment = gearResult.gear;
  aliases = gearResult.aliases;
  enemies = enemyResult.rows;
  environment = tables;
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  meta = {
    importedAt: gearResult.version
      ? `武器数据 ${gearResult.version}。爆炸外圈按线性衰减，维基没有给出衰减曲线。`
      : date,
    conflicts: [],
  };
  loadNote = [gearResult.error, enemyResult.error].filter((line) => line !== "").join("。");
  planetCache = readPlanetCache();
  fillPlanets();
  restoreSelection();
  renderCard();
}

async function loadGear(): Promise<{ gear: GearPiece[]; aliases: Record<string, string[]>; version: string; error: string }> {
  try {
    const result = await fetchWikiGear();
    return { ...result, error: "" };
  } catch {
    return { gear: [], aliases: {}, version: "", error: "武器没有读到" };
  }
}

function addGearRow(parent: HTMLElement, label: string, slot: Slot, id: string): GearRow {
  const picker = createPicker(parent, label, id, "输入名称、型号、英文名或别名", () => gearOptions(slot), () => {
    saveSelection();
    renderCard();
  });
  return { id, slot, picker };
}

function field(label: string, ...controls: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  const labelled = controls.find((control): control is HTMLInputElement | HTMLSelectElement => (
    control instanceof HTMLInputElement || control instanceof HTMLSelectElement
  ));
  if (labelled) {
    name.id = `${labelled.id}-label`;
    labelled.setAttribute("aria-labelledby", name.id);
  }
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

function gearText(piece: GearPiece): string {
  if (piece.model && !piece.name.includes(piece.model)) return `${piece.name} ${piece.model}`;
  return piece.name;
}

function gearHint(piece: GearPiece): string {
  const label = gearText(piece);
  const bits = [piece.model ?? "", piece.nameEn ?? "", ...aliasList(piece.id)];
  return [...new Set(bits.filter((bit) => bit !== "" && bit !== piece.name && !label.includes(bit)))].join(" · ");
}

function gearOptions(slot: Slot): Choice[] {
  return equipment
    .filter((piece) => piece.slot === slot)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"))
    .map((piece) => ({
      value: piece.id,
      label: gearText(piece),
      hint: gearHint(piece),
      search: [piece.name, piece.model ?? "", piece.nameEn ?? "", ...aliasList(piece.id)].join(" ").toLowerCase(),
    }));
}

function enemyOptions(): Choice[] {
  return enemies
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "zh"))
    .map((enemy) => {
      const english = enemy.nameEn && enemy.nameEn !== enemy.name ? enemy.nameEn : "";
      const faction = enemy.factionZh || enemy.faction;
      return {
        value: enemy.id,
        label: enemy.name,
        hint: [english, faction].filter((part) => part !== "").join(" · "),
        search: [enemy.name, enemy.nameEn ?? "", enemy.id, enemy.faction, enemy.factionZh ?? "", ...(enemy.aliases ?? [])].join(" ").toLowerCase(),
      };
    });
}

function createPicker(
  parent: HTMLElement,
  label: string,
  id: string,
  placeholder: string,
  options: () => Choice[],
  onChange: () => void,
): Picker {
  const input = document.createElement("input");
  input.type = "text";
  input.id = `search-${id}`;
  input.autocomplete = "off";
  input.placeholder = placeholder;
  input.role = "combobox";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "results";
  list.id = `results-${id}`;
  list.hidden = true;
  list.role = "listbox";
  input.setAttribute("aria-controls", list.id);
  const picker: Picker = { input, list, value: "", active: -1, options, onChange };
  input.addEventListener("focus", () => {
    openPicker(picker);
    input.select();
  });
  input.addEventListener("click", () => {
    if (picker.list.hidden) openPicker(picker);
  });
  input.addEventListener("input", () => {
    picker.active = -1;
    openPicker(picker);
  });
  input.addEventListener("blur", () => closePicker(picker, true));
  input.addEventListener("keydown", (event) => onPickerKey(picker, event));
  parent.append(field(label, input, list));
  pickers.push(picker);
  return picker;
}

function choiceLabel(picker: Picker): string {
  if (picker.value === "") return "";
  return picker.options().find((choice) => choice.value === picker.value)?.label ?? "";
}

function visibleChoices(picker: Picker): Choice[] {
  const typed = picker.input.value.trim().toLowerCase();
  const current = choiceLabel(picker).toLowerCase();
  const needle = typed === "" || typed === current ? "" : typed;
  const matches = picker.options().filter((choice) => needle === "" || choice.search.includes(needle) || choice.label.toLowerCase().includes(needle));
  if (picker.value !== "") matches.unshift({ value: "", label: "清空", hint: "", search: "" });
  return matches;
}

function paintPicker(picker: Picker): void {
  const choices = visibleChoices(picker);
  picker.list.replaceChildren();
  if (choices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配";
    picker.list.append(empty);
    return;
  }
  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "option";
    button.setAttribute("aria-selected", index === picker.active ? "true" : "false");
    const title = document.createElement("span");
    title.textContent = choice.label;
    button.append(title);
    if (choice.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = choice.hint;
      button.append(hint);
    }
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      commitPicker(picker, choice.value);
    });
    picker.list.append(button);
  });
  const typed = picker.input.value.trim().toLowerCase();
  const current = choiceLabel(picker).toLowerCase();
  if (typed !== "" && typed !== current && choices.every((choice) => choice.label === "清空")) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配";
    picker.list.append(empty);
  }
  const active = picker.list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
  if (!active) return;
  const top = active.offsetTop;
  const bottom = top + active.offsetHeight;
  if (top < picker.list.scrollTop) picker.list.scrollTop = top;
  else if (bottom > picker.list.scrollTop + picker.list.clientHeight) picker.list.scrollTop = bottom - picker.list.clientHeight;
}

function openPicker(picker: Picker): void {
  for (const other of pickers) {
    if (other !== picker) closePicker(other, true);
  }
  picker.list.hidden = false;
  picker.input.setAttribute("aria-expanded", "true");
  paintPicker(picker);
}

function closePicker(picker: Picker, restore: boolean): void {
  picker.list.hidden = true;
  picker.input.setAttribute("aria-expanded", "false");
  picker.active = -1;
  if (!restore) return;
  if (picker.input.value.trim() === "") {
    const had = picker.value !== "";
    picker.value = "";
    picker.input.value = "";
    if (had && !quiet) picker.onChange();
    return;
  }
  picker.input.value = choiceLabel(picker);
}

function commitPicker(picker: Picker, value: string): void {
  picker.value = value;
  picker.input.value = choiceLabel(picker);
  closePicker(picker, false);
  if (!quiet) picker.onChange();
}

function setPickerValue(picker: Picker, value: string): void {
  picker.value = picker.options().some((choice) => choice.value === value) ? value : "";
  picker.input.value = choiceLabel(picker);
}

function onPickerKey(picker: Picker, event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (picker.list.hidden) openPicker(picker);
    const last = visibleChoices(picker).length - 1;
    if (last < 0) return;
    picker.active = event.key === "ArrowDown" ? Math.min(picker.active + 1, last) : Math.max(picker.active - 1, 0);
    paintPicker(picker);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const choices = visibleChoices(picker);
    const concrete = choices.filter((choice) => choice.label !== "清空");
    const choice = picker.active >= 0 ? choices[picker.active] : concrete.length === 1 ? concrete[0] : undefined;
    if (choice) commitPicker(picker, choice.value);
    return;
  }
  if (event.key === "Escape") {
    picker.input.value = choiceLabel(picker);
    closePicker(picker, false);
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
  quiet = true;
  try {
    for (const key of ["primary", "secondary", "grenade", "support"] as const) {
      const piece = gearById(saved[key]);
      setPickerValue(slots[key].picker, piece && piece.slot === slots[key].slot ? piece.id : "");
    }
    stratagemRows.forEach((row, index) => {
      const piece = gearById(saved.stratagems[index] ?? "");
      setPickerValue(row.picker, piece && piece.slot === "stratagem" ? piece.id : "");
    });
    setPickerValue(enemyPicker, enemies.some((enemy) => enemy.id === saved.enemyId) ? saved.enemyId : "");
  } finally {
    quiet = false;
  }
  for (const box of weatherBoxes) box.checked = saved.weather.includes(box.value as Weather);
  gloomSelect.value = saved.gloom;
}

function saveSelection(): void {
  const selection: Selection = {
    primary: gearRows[0].picker.value,
    secondary: gearRows[1].picker.value,
    grenade: gearRows[2].picker.value,
    support: gearRows[3].picker.value,
    stratagems: stratagemRows.map((row) => row.picker.value),
    enemyId: enemyPicker.value,
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
  const ids = [...gearRows, ...stratagemRows].map((row) => row.picker.value).filter((id) => id !== "");
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
  const enemy = enemies.find((item) => item.id === enemyPicker.value);
  card.replaceChildren();
  if (!enemy) {
    card.textContent = loadNote || "先选一个敌人";
    return;
  }
  if (loadNote) addParagraph(card, loadNote);
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
  if (result.locations.length > 0) {
    addLines(card, "部位", result.locations.map((item) => `${item.name}：${item.detail}`));
  }
  if (result.gear.length > 0) {
    addLines(card, "你的装备", result.gear.map(formatGear));
    if (result.blockedCount > 0) addParagraph(card, `打不穿：${result.blockedCount}`);
  } else if (result.blockedCount > 0) {
    addParagraph(card, `打不穿：${result.blockedCount}`);
  }
  const details = basisDetails(result);
  if (details) card.append(details);
}
