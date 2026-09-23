import { createApplication, type BrowserConfiguration } from './application';
import { NavigationCoordinator } from './runtime/navigation';
import type { UsageAPI } from './usage';
import type { LocalizationPort } from './runtime/contracts';
import type { PublicCatalog } from './runtime/catalog';
const usage: UsageAPI = {
  emit: () => {},
  activate: () => {},
  flush: async () => {},
  suspend: (run) => run(),
  disable: () => {},
};
let localization: LocalizationPort | undefined;
const configuration = JSON.parse(
  document.getElementById('browser-configuration')!.textContent!,
) as BrowserConfiguration;
const data = JSON.parse(document.getElementById('challenge-data')!.textContent!) as PublicCatalog;
const navigation = new NavigationCoordinator({
  usage,
  localization: () => localization,
  loadBrowser: () => application.then((value) => value.browser),
});
const application = createApplication({
  configuration,
  data,
  usage,
  navigation,
  onLocalization: (value) => {
    localization = value;
  },
});
navigation.start();
