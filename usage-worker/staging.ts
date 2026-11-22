import {createCollector} from './collector';
// Separately built staging entry; bind only the reviewed staging database.
// Access gates the Pages bridge, which deliberately strips client addresses.
export default createCollector('https://maimai-party-staging.pages.dev', {requireLimiter:false});
