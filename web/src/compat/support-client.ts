import {createSupportClient} from '../views/support-client.js';
import defaultConfig from '../../../src/maimai_intelligence/assets/support-config.json';
const facade=globalThis as unknown as {maimaiSupportConfig?:typeof defaultConfig};
const supportConfig=facade.maimaiSupportConfig??defaultConfig;
Object.assign(globalThis,{maimaiSupportClient:createSupportClient({supportConfig})});
