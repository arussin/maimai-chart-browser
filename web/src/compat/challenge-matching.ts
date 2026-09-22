import {createChallengeMatching} from '../views/challenge-matching.js';
const facade=globalThis as unknown as Record<string,unknown>;
Object.assign(globalThis,{maimaiChallengeMatching:createChallengeMatching({})});
