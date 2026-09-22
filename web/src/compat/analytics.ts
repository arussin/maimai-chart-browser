import {historyPort} from '../runtime/history';
import {createAnalytics} from '../views/analytics.js';
const facade=globalThis as unknown as Record<string,unknown>;
createAnalytics({historyPort,localization:facade.maimaiI18n,settings:facade.maimaiSettings});
