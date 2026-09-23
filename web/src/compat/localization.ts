import { createLocalization } from '../views/localization.js';
declare const __MAIMAI_MESSAGES__: unknown;
declare const __MAIMAI_FLAGS__: unknown;
Object.assign(globalThis, {
  maimaiI18n: createLocalization({
    configuration: { messages: __MAIMAI_MESSAGES__, flags: __MAIMAI_FLAGS__ },
  }),
});
