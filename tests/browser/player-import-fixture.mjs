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
  {
    const back = page.locator('[data-import-back]');
    if (await back.isVisible()) await back.click();
    const choice = method === 'report' ? 'help' : method === 'file' || method.startsWith('file:') ? 'file' : 'tracker';
    await page.locator(`[data-import-choice="${choice}"]`).click();
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const radio = page.locator(
    `#player-import-dialog input[data-import-method="${method}"]`,
  );
  if (await radio.isVisible()) await radio.check();
}
