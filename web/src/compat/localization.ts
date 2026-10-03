import { createLocalization, type LocalizationConfiguration } from '../views/localization.js';
declare const __MAIMAI_MESSAGES__: unknown;
declare const __MAIMAI_FLAGS__: unknown;
Object.assign(globalThis, {
  maimaiI18n: createLocalization({
    root: document.body,
    configuration: {
      messages: __MAIMAI_MESSAGES__ as LocalizationConfiguration['messages'],
      flags: __MAIMAI_FLAGS__ as LocalizationConfiguration['flags'],
    },
  }),
});
