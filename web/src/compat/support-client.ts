import {createSupportClient} from '../views/support-client.js';
import supportConfig from '../../../src/maimai_intelligence/assets/support-config.json';
Object.assign(globalThis,{maimaiSupportClient:createSupportClient({supportConfig})});
