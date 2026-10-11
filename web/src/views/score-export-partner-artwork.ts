import type { ScoreExportPartnerKey } from './score-export-partners';

/** Explicit imports keep every reviewed illustration separate on hosted pages. */
const partnerArtwork = {
  'derakkuma-magical': () =>
    import('./score-export-partner-artwork/score-export-partner-derakkuma-magical.json'),
  'kanadera-magical': () =>
    import('./score-export-partner-artwork/score-export-partner-kanadera-magical.json'),
  salt: () => import('./score-export-partner-artwork/score-export-partner-salt.json'),
  'milk-chibimilk': () =>
    import('./score-export-partner-artwork/score-export-partner-milk-chibimilk.json'),
  shama: () => import('./score-export-partner-artwork/score-export-partner-shama.json'),
  ras: () => import('./score-export-partner-artwork/score-export-partner-ras.json'),
  otohime: () => import('./score-export-partner-artwork/score-export-partner-otohime.json'),
  chiffon: () => import('./score-export-partner-artwork/score-export-partner-chiffon.json'),
  derakkuma: () => import('./score-export-partner-artwork/score-export-partner-derakkuma.json'),
  'lime-lemon': () => import('./score-export-partner-artwork/score-export-partner-lime-lemon.json'),
  'ras-festival': () =>
    import('./score-export-partner-artwork/score-export-partner-ras-festival.json'),
  'ras-festival-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-ras-festival-plus.json'),
  'ras-buddies': () =>
    import('./score-export-partner-artwork/score-export-partner-ras-buddies.json'),
  'ras-buddies-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-ras-buddies-plus.json'),
  'chiffon-festival': () =>
    import('./score-export-partner-artwork/score-export-partner-chiffon-festival.json'),
  'chiffon-festival-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-chiffon-festival-plus.json'),
  'chiffon-circle-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-chiffon-circle-plus.json'),
  'salt-festival': () =>
    import('./score-export-partner-artwork/score-export-partner-salt-festival.json'),
  'salt-festival-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-salt-festival-plus.json'),
  'milk-universe': () =>
    import('./score-export-partner-artwork/score-export-partner-milk-universe.json'),
  'shama-universe': () =>
    import('./score-export-partner-artwork/score-export-partner-shama-universe.json'),
  'shama-circle-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-shama-circle-plus.json'),
  'otohime-splash': () =>
    import('./score-export-partner-artwork/score-export-partner-otohime-splash.json'),
  'otohime-buddies': () =>
    import('./score-export-partner-artwork/score-export-partner-otohime-buddies.json'),
  'otohime-buddies-plus': () =>
    import('./score-export-partner-artwork/score-export-partner-otohime-buddies-plus.json'),
} satisfies Record<Exclude<ScoreExportPartnerKey, 'none'>, () => Promise<{ default: string }>>;

/** No provider URLs or inferred partner choices are accepted here. */
export async function loadScoreExportPartnerArtwork(key?: string): Promise<Record<string, string>> {
  if (!key || !Object.hasOwn(partnerArtwork, key)) return {};
  try {
    const image = await partnerArtwork[key as keyof typeof partnerArtwork]();
    return { ['partner:' + key]: image.default };
  } catch {
    // An unavailable optional illustration must not discard the other result artwork.
    return {};
  }
}
