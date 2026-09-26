import { createSupportStripe, type SupportLocalization } from '../views/support-stripe.js';
import { historyPort } from '../runtime/history';
import type { SupportClient } from '../views/support-client';
const facade = globalThis as unknown as {
  maimaiI18n?: SupportLocalization;
  maimaiSupportClient?: SupportClient;
};
createSupportStripe({
  root: document.body,
  localization: facade.maimaiI18n,
  supportClient: facade.maimaiSupportClient,
  historyPort,
});
