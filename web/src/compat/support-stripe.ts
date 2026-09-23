import { createSupportStripe } from '../views/support-stripe.js';
import { historyPort } from '../runtime/history';
const facade = globalThis as unknown as { maimaiI18n: unknown; maimaiSupportClient: unknown };
createSupportStripe({
  localization: facade.maimaiI18n,
  supportClient: facade.maimaiSupportClient,
  historyPort,
});
