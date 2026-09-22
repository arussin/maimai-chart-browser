import {createSettingsMenu} from '../views/settings-menu.js';
const facade=globalThis as unknown as Record<string,unknown>;
Object.assign(globalThis,{maimaiSettings:createSettingsMenu({localization:facade.maimaiI18n,usage:undefined})});
