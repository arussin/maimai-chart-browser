import { createPlayerMaishift } from '../views/player-maishift.js';
const facade = globalThis as unknown as Record<string, unknown>;
Object.assign(globalThis, {
  maimaiPlayerMaishift: createPlayerMaishift({ playerCore: facade.maimaiPlayerData }),
});
