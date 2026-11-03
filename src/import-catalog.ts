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

function toAttack(item: CatalogItem, component: CatalogComponent, extra: WikiExtra | undefined): AttackProfile | undefined {
  const standardDamage = component.fields?.standardDamage;
  const penetration = component.fields?.armorPenetration?.value;
  const ap = extra?.ap ?? (penetration == null ? undefined : { front: penetration });
  if (standardDamage == null || ap == null) return undefined;

  const kind = component.type === "explosion" ? "explosion" : component.type === "beam" ? "beam" : "projectile";
  return {
    id: component.id,
    label: component.label,
    kind,
    aimed: component.type !== "explosion",
    ap,
    standardDamage,
    ...(component.fields?.durableDamage != null ? { durableDamage: component.fields.durableDamage } : {}),
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
