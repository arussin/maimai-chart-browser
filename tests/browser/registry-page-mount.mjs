/** Root mount for a synthetic registry page; context isolation remains its own owner. */
export async function mountRegistryPage(page, baseURL) {
  const pending = new Set();
  const failures = [];
  await page.route("**/*", (route) => {
    const operation = (async () => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) {
        await route.abort();
        return;
      }
      const response = await route.fetch({
        url: baseURL + "/registry" + url.pathname + url.search,
      });
      await route.fulfill({ response });
    })();
    pending.add(operation);
    return operation
      .catch((error) => {
        failures.push(error);
        throw error;
      })
      .finally(() => pending.delete(operation));
  });
  return {
    async close() {
      // Do not unroute a live page: its next request could lose the fixture mount.
      // The context/API client stays alive until the afterEach hook has drained.
      await page.close();
      while (pending.size) await Promise.allSettled([...pending]);
      if (failures.length)
        throw new AggregateError(failures, "Registry fixture requests failed");
    },
  };
}
