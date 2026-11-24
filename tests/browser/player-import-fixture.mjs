import { expect } from './fixtures.js';

/** Open Settings' import dialog and optionally expand a service and select its method. */
export async function openImport(page, method) {
  await page.locator('#settings-toggle').click();
  await page.locator('#player-import').click();
  await expect(page.locator('#player-import-dialog')).toBeVisible();
  if (method) await selectImportMethod(page, method);
}

/** Choose an actual service and method through the accessible import controls. */
export async function selectImportMethod(page, method) {
  const service =
    method === "file" || method === "report"
      ? "session-report"
      : method === "file:tachi"
        ? "tachi"
        : method.startsWith("file:")
          ? method.slice(5)
          : method;
  const toggle = page.locator(
    `#player-import-dialog [data-service-toggle="${service}"]`,
  );
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#player-service-body-${service}`)).toBeVisible();
  const radio = page.locator(
    `#player-import-dialog input[data-import-method="${method}"]`,
  );
  // Single-method services have no radio. Multi-method services must expose
  // the requested method; never silently skip a hidden, outdated selection.
  if (await radio.count()) {
    await expect(radio).toBeVisible();
    await radio.check();
    await expect(radio).toBeChecked();
  }
}
