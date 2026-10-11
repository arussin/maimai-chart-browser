/** Verified official artwork choices for this image, independent of imported player data. */
export const scoreExportPartners = [
  { key: 'derakkuma', name: 'でらっくま' },
  { key: 'lime-lemon', name: 'らいむっくま＆れもんっくま' },
  { key: 'ras', name: 'ラズ' },
  { key: 'chiffon', name: 'シフォン' },
  { key: 'salt', name: 'ソルト' },
  { key: 'otohime', name: '乙姫' },
  { key: 'milk-chibimilk', name: 'みるく／ちびみるく' },
  { key: 'shama', name: 'しゃま' },
  { key: 'derakkuma-magical', name: 'でらっくま (MAGiCAL)' },
  { key: 'kanadera-magical', name: 'カナデラ (MAGiCAL)' },
  { key: 'ras-festival', name: 'ラズ (FESTiVAL)' },
  { key: 'ras-festival-plus', name: 'ラズ (FESTiVAL PLUS)' },
  { key: 'ras-buddies', name: 'ラズ (BUDDiES)' },
  { key: 'ras-buddies-plus', name: 'ラズ (BUDDiES PLUS)' },
  { key: 'chiffon-festival', name: 'シフォン (FESTiVAL)' },
  { key: 'chiffon-festival-plus', name: 'シフォン (FESTiVAL PLUS)' },
  { key: 'chiffon-circle-plus', name: 'シフォン (CiRCLE PLUS)' },
  { key: 'salt-festival', name: 'ソルト (FESTiVAL)' },
  { key: 'salt-festival-plus', name: 'ソルト (FESTiVAL PLUS)' },
  { key: 'milk-universe', name: 'みるく (UNiVERSE)' },
  { key: 'shama-universe', name: 'しゃま (UNiVERSE)' },
  { key: 'shama-circle-plus', name: 'しゃま (CiRCLE PLUS)' },
  { key: 'otohime-splash', name: '乙姫 (Splash)' },
  { key: 'otohime-buddies', name: '乙姫 (BUDDiES)' },
  { key: 'otohime-buddies-plus', name: '乙姫 (BUDDiES PLUS)' },
] as const;

export type ScoreExportPartnerKey = 'none' | (typeof scoreExportPartners)[number]['key'];
export const defaultScoreExportPartner: ScoreExportPartnerKey = 'none';
