import {createCollector} from './collector';
// Separately built staging entry; bind only the reviewed staging database.
export default createCollector('https://maimai-party-staging.pages.dev');
