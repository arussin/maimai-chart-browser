/** Choose an actual service and method through the accessible import controls. */
export async function selectImportMethod(page, method) {
  const service = method === 'file' || method === 'report'
    ? 'session-report'
    : method.startsWith('file:') ? method.slice(5) : method;
  const toggle = page.locator(`#player-import-dialog [data-service-toggle="${service}"]`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator(`#player-import-dialog input[data-import-method="${method}"]`).check();
}
