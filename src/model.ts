export type AngleBand = "front" | "slight" | "large" | "extreme";
export type Slot = "primary" | "secondary" | "grenade" | "support" | "stratagem";
export type Weather =
  | "acid-storms"
  | "blizzards"
  | "extreme-cold"
  | "fire-tornados"
  | "intense-heat"
  | "ion-storms"
  | "meteor-storms"
  | "rainstorms"
  | "sandstorms"
  | "thick-fog"
  | "tremors"
  | "volcanic-activity";
export type Gloom = "none" | "light" | "moderate" | "heavy" | "source";

export interface AttackProfile {
  id: string;
  label: string;
  kind: "projectile" | "explosion" | "beam";
  aimed: boolean;
  ap: { front: number; slight?: number; large?: number; extreme?: number };
  standardDamage: number;
  durableDamage?: number;
  heat: boolean;
  roundsPerMinute?: number;
  cooldownSeconds?: number;
  ballistics?: { sizeMm: number; massG: number; drag: number };
  explosion?: { innerRadius: number; outerRadius: number; falloff: "slow" | "quick" };
  beam?: { falloffStart: number; range: number; maxFalloff: number };
  mode?: string;
  fragment?: boolean;
  shrapnelCount?: number;
  shrapnelName?: string;
  sourceName?: string;
  parentName?: string;
}

export interface GearPiece {
  id: string;
  name: string;
  model?: string;
  nameEn?: string;
  slot: Slot;
  order: number;
  requiresCall: boolean;
  eagle: boolean;
  attacks: AttackProfile[];
  missingCombatData?: boolean;
  harmless?: boolean;
  catalogFallback?: boolean;
}

export interface Part {
  id: string;
  name: string;
  armor: number;
  health?: number;
  durability?: number;
  fatal: boolean;
  breakable: boolean;
  behindId?: string;
  percentToMain?: number;
  bleed?: number;
  bleedPerSecond?: number;
  explosionResist?: number;
}

export interface Enemy {
  id: string;
  name: string;
  nameEn?: string;
  aliases?: string[];
  faction: string;
  factionZh?: string;
  health?: number;
  wikiUrl?: string;
  multipliers: { fire?: number; arc?: number; acid?: number; gas?: number };
  parts: Part[];
}

export interface Situation {
  weather: Weather[];
  gloom: Gloom;
  unknownHazards?: string[];
  cachedAt?: string;
}

export interface ShotContext {
  angle: AngleBand;
  distanceM: number;
  zone: "inner" | "outer";
  acid: boolean;
}

export interface ShotResult {
  damage: number;
  penetrates: boolean;
  apUsed: number;
  armorUsed: number;
  falloff: number;
  missingBallistics: boolean;
  explosionImmune?: boolean;
  explosionResist?: number;
}
