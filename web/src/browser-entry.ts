import { createUsage } from './usage';
import { NavigationCoordinator } from './runtime/navigation';
import type { Application } from './application';
import type { LocalizationPort } from './runtime/contracts';
export const usage = createUsage();
let localization: LocalizationPort | undefined, application: Promise<Application> | undefined;
export function loadApplication(): Promise<Application> {
  return (application ??= import('./application').then(({ createApplication }) =>
    createApplication({
      usage,
      navigation,
      onLocalization: (value) => {
        localization = value;
      },
    }),
  ));
}
const navigation = new NavigationCoordinator({
  usage,
  localization: () => localization,
  loadBrowser: () => loadApplication().then((value) => value.browser),
});
navigation.start();
if (!document.querySelector('main[data-seo-page="song"]'))
  void loadApplication().catch((error) => {
    const status = document.getElementById('lab-status');
    if (status && !status.dataset.catalogError) status.textContent = error.message;
  });
