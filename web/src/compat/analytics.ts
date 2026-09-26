import { historyPort } from '../runtime/history';
import { createAnalytics, type AnalyticsPorts } from '../views/analytics';
const facade = globalThis as unknown as {
  maimaiI18n: AnalyticsPorts['localization'];
  maimaiSettings: AnalyticsPorts['settings'];
};
createAnalytics({
  root: document.body,
  historyPort,
  localization: facade.maimaiI18n ?? {
    text: (node, value) => {
      node.textContent = String(value);
    },
  },
  settings: facade.maimaiSettings,
});
