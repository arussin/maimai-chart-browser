/** Shared with the existing player profile placard's official rating frames. */
export function ratingTier(rating: number) {
  const tiers = [
    [0, 'white'],
    [1000, 'blue'],
    [2000, 'green'],
    [4000, 'yellow'],
    [7000, 'red'],
    [10000, 'purple'],
    [12000, 'bronze'],
    [13000, 'silver'],
    [14000, 'gold'],
    [14500, 'platinum'],
    [15000, 'rainbow'],
    [16000, 'rainbow-ex'],
  ] as const;
  return tiers.findLast(([minimum]) => rating >= minimum)?.[1] || 'white';
}

/** The official atlas is a four-by-four grid; keep every observed decimal digit. */
export function achievementSpriteLayout(value: number) {
  return (value / 10000)
    .toFixed(4)
    .split('')
    .map((character) => {
      const slot = character === '.' ? 13 : Number(character);
      return { character, column: slot % 4, row: Math.floor(slot / 4) };
    });
}

export function achievementPalette(value: number) {
  return value >= 970000 ? 'gold' : value >= 800000 ? 'red' : 'blue';
}
