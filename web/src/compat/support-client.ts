import { createSupportClient } from '../views/support-client.js';
import type SupportConfig from '../../../src/maimai_intelligence/assets/support-config.json';
const facade = globalThis as unknown as {
  maimaiSupportConfig?: typeof SupportConfig;
  maimaiSupportClient?: unknown;
};
if (!facade.maimaiSupportClient) {
  const supportClient = createSupportClient({ supportConfig: facade.maimaiSupportConfig });
  if (supportClient) Object.assign(globalThis, { maimaiSupportClient: supportClient });
}
