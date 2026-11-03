import type { AttackProfile, Enemy, GearPiece, Slot } from "./model";

export interface CatalogComponent {
  id: string;
  type: string;
  label: string;
  fields: {
    standardDamage?: number;
    durableDamage?: number;
    armorPenetration?: { value: number };
  };
}

export interface CatalogItem {
  id: string;
  productKind: string;
  model: string;
  nameZh: string;
  nameEn: string;
  weaponType?: string;
  wiki?: string;
  combat?: { components: CatalogComponent[] };
  handling?: { fireRate?: number };
  deployment?: { cooldownSeconds?: number; type?: string };
}

export interface WikiExtra {
  ap?: AttackProfile["ap"];
  standardDamage?: number;
  durableDamage?: number;
  ballistics?: AttackProfile["ballistics"];
  explosion?: AttackProfile["explosion"];
  beam?: AttackProfile["beam"];
  conflicts?: string[];
}

function placement(productKind: string): { slot: Slot; requiresCall: boolean } {
  switch (productKind) {
    case "primary-weapon":
      return { slot: "primary", requiresCall: false };
    case "secondary-weapon":
      return { slot: "secondary", requiresCall: false };
    case "grenade":
      return { slot: "grenade", requiresCall: false };
    case "support-weapon":
      return { slot: "support", requiresCall: true };
    default:
      return { slot: "stratagem", requiresCall: true };
  }
}

function catalogPenetration(component: CatalogComponent): number | undefined {
  return component.fields?.armorPenetration?.value;
}

function attackAp(component: CatalogComponent, extra: WikiExtra | undefined): AttackProfile["ap"] | undefined {
  const penetration = catalogPenetration(component);
  return extra?.ap ?? (penetration == null ? undefined : { front: penetration });
}

function attackDamage(component: CatalogComponent, extra: WikiExtra | undefined): number | undefined {
  return extra?.standardDamage ?? component.fields?.standardDamage;
}

function attackDurable(component: CatalogComponent, extra: WikiExtra | undefined): number | undefined {
  return extra?.durableDamage ?? component.fields?.durableDamage;
}

function toAttack(item: CatalogItem, component: CatalogComponent, extra: WikiExtra | undefined): AttackProfile | undefined {
  const standardDamage = attackDamage(component, extra);
  const ap = attackAp(component, extra);
  if (standardDamage == null || ap == null) return undefined;
  const durableDamage = attackDurable(component, extra);

  const kind = component.type === "explosion" ? "explosion" : component.type === "beam" ? "beam" : "projectile";
  return {
    id: component.id,
    label: component.label,
    kind,
    aimed: component.type !== "explosion",
    ap,
    standardDamage,
    ...(durableDamage != null ? { durableDamage } : {}),
    heat: (item.weaponType != null && /energy|laser|heat/i.test(item.weaponType)) || component.type === "beam",
    ...(item.handling?.fireRate != null ? { roundsPerMinute: item.handling.fireRate } : {}),
    ...(item.deployment?.cooldownSeconds != null ? { cooldownSeconds: item.deployment.cooldownSeconds } : {}),
    ...(extra?.ballistics ? { ballistics: extra.ballistics } : {}),
    ...(extra?.explosion ? { explosion: extra.explosion } : {}),
    ...(extra?.beam ? { beam: extra.beam } : {}),
  };
}

export function toGear(
  items: CatalogItem[],
  extras: Record<string, WikiExtra>,
  aliases: Record<string, string[]>,
): GearPiece[] {
  void aliases;
  return items.map((item, order) => {
    const attacks = (item.combat?.components ?? []).flatMap((component) => {
      const attack = toAttack(item, component, extras[item.id]);
      return attack ? [attack] : [];
    });
    const placed = placement(item.productKind);
    const gear: GearPiece = {
      id: item.id,
      name: item.nameZh || item.nameEn,
      ...(item.model ? { model: item.model } : {}),
      ...(item.nameEn ? { nameEn: item.nameEn } : {}),
      slot: placed.slot,
      order,
      requiresCall: placed.requiresCall,
      eagle: /eagle/i.test(item.nameEn) || /eagle/i.test(item.deployment?.type ?? ""),
      attacks,
    };
    if (attacks.length === 0) gear.missingCombatData = true;
    return gear;
  });
}

export function filterEnemies(enemies: Enemy[]): Enemy[] {
  return enemies.filter((enemy) => enemy.faction !== "Cyborg Legion");
}

function conflictFields(component: CatalogComponent, extra: WikiExtra): { label: string; catalog: number; wiki: number }[] {
  const pairs: { label: string; catalog: number | undefined; wiki: number | undefined }[] = [
    { label: "穿甲", catalog: catalogPenetration(component), wiki: extra.ap?.front },
    { label: "标准伤害", catalog: component.fields?.standardDamage, wiki: extra.standardDamage },
    { label: "耐久伤害", catalog: component.fields?.durableDamage, wiki: extra.durableDamage },
  ];
  return pairs.flatMap((pair) => {
    if (pair.catalog == null || pair.wiki == null || pair.catalog === pair.wiki) return [];
    return [{ label: pair.label, catalog: pair.catalog, wiki: pair.wiki }];
  });
}

export function listConflicts(items: CatalogItem[], extras: Record<string, WikiExtra>): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const extra = extras[item.id];
    if (!extra) continue;
    const components = item.combat?.components ?? [];
    const several = components.length > 1;
    for (const component of components) {
      if (attackDamage(component, extra) == null || attackAp(component, extra) == null) continue;
      for (const field of conflictFields(component, extra)) {
        const prefix = several ? `${item.id}:${component.id}` : item.id;
        lines.push(`${prefix}:${field.label}:目录${field.catalog}:wiki${field.wiki}`);
      }
    }
  }
  return lines;
}
