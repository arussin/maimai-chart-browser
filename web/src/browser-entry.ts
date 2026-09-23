import { catalogFailure } from './runtime/diagnostics';
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
void loadApplication()
  .then(() => {
    if (document.querySelector('body>main[data-seo-page="song"]'))
      return navigation.route(new URL(location.href));
  })
  .catch(() => {
    const root = document.querySelector<HTMLElement>('body>main[data-seo-page]') ?? document.body;
    catalogFailure(root, document.documentElement.lang);
  });
