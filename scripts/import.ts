import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const items = readJson<CatalogItem[]>(catalogPath);
const extras = existsSync(extrasPath) ? readJson<Record<string, WikiExtra>>(extrasPath) : {};
const aliases = existsSync(aliasesPath) ? readJson<Record<string, string[]>>(aliasesPath) : {};
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
