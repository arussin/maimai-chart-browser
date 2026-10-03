import { createPlayerDataCore } from '../views/player-data-core.js';
const facade = globalThis as unknown as Record<string, unknown>;
Object.assign(globalThis, { maimaiPlayerData: createPlayerDataCore({}) });
