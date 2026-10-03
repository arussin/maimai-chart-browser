import { createSettingsMenu, type SettingsLocalization } from '../views/settings-menu.js';
const facade = globalThis as unknown as Record<string, unknown>;
Object.assign(globalThis, {
  maimaiSettings: createSettingsMenu({
    root: document.body,
    localization: facade.maimaiI18n as SettingsLocalization | undefined,
    usage: undefined,
  }),
});
