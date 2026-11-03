const TABLE: Record<number, [number, number, number]> = {
  0: [2, 3, 4],
  1: [4, 5, 5],
};

function band(durability: number): 0 | 1 | 2 {
  if (durability <= 0.24) return 0;
  if (durability <= 0.75) return 1;
  return 2;
}

export function cleaveThrough(armor: number, durability: number | undefined, ap: number): number | null {
  if (durability === undefined) return null;
  const row = TABLE[armor];
  if (!row) return null;
  const index = band(durability);
  if (ap < row[index]) return null;
  return ap - [2, 3, 4][index];
}

export function sameShotThroughPlating(armor: number, durability: number | undefined, ap: number): boolean {
  return ap >= armor * 3 && cleaveThrough(armor, durability, ap) !== null;
}
