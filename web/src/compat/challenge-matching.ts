import * as matching from '../domain/challenge-matching';
const facade = globalThis as unknown as Record<string, unknown>;
Object.assign(globalThis, { maimaiChallengeMatching: Object.freeze(matching) });
