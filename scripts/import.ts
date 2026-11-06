import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { filterEnemies, listConflicts, toGear } from "../src/import-catalog.ts";
import type { CatalogItem, WikiExtra } from "../src/import-catalog.ts";
import type { Enemy } from "../src/model.ts";

const catalogPath = "data/raw/catalog.json";
const extrasPath = "data/raw/extras.json";
const aliasesPath = "data/raw/aliases.json";
const enemiesPath = "data/raw/enemies.json";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readCatalog(): CatalogItem[] {
  const data = readJson<CatalogItem[] | { items?: CatalogItem[] }>(catalogPath);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  console.log(catalogPath);
  process.exit(1);
}

function readAliases(): Record<string, string[]> {
  if (!existsSync(aliasesPath)) return {};
  const data = readJson<
    Record<string, string[]> | { entries?: { equipmentId?: string; aliases?: unknown }[] }
  >(aliasesPath);
  if (!Array.isArray(data) && Array.isArray(data.entries)) {
    const aliases: Record<string, string[]> = {};
    for (const entry of data.entries) {
      if (!entry.equipmentId || !Array.isArray(entry.aliases)) continue;
      aliases[entry.equipmentId] = entry.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim() !== "");
    }
    return aliases;
  }
  return data as Record<string, string[]>;
}

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

if (!existsSync(catalogPath)) {
  console.log(catalogPath);
  process.exit(1);
}

const items = readCatalog().filter((item) => item.productKind !== "body-armor");
const extras = existsSync(extrasPath) ? readJson<Record<string, WikiExtra>>(extrasPath) : {};
const aliases = readAliases();
const gear = toGear(items, extras, aliases);
const conflicts = listConflicts(items, extras);

writeFileSync("data/equipment.json", `${JSON.stringify(gear, null, 2)}\n`);
writeFileSync("data/aliases.json", `${JSON.stringify(aliases, null, 2)}\n`);
writeFileSync("data/meta.json", `${JSON.stringify({
  importedAt: localDate(),
  conflicts,
  sources: ["HD2Tool catalog", "helldivers.wiki.gg"],
}, null, 2)}\n`);

if (existsSync(enemiesPath)) {
  writeFileSync("data/enemies.json", `${JSON.stringify(filterEnemies(readJson<Enemy[]>(enemiesPath)), null, 2)}\n`);
}

mkdirSync("public/data", { recursive: true });
for (const name of readdirSync("data")) {
  if (!name.endsWith(".json")) continue;
  copyFileSync(`data/${name}`, `public/data/${name}`);
}
