export {validateRow} from '../web/src/usage-contract';
export {dayKey} from './collector';
import {createCollector} from './collector';
// Production always uses its exact original origin; there is no runtime override.
export default createCollector('https://maimai.party');
