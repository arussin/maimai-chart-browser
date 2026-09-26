/** Staging-only transport. Access protects this route before Pages invokes it. */
const origin = "https://maimai-party-staging.pages.dev";
const permittedHeaders = ["Content-Type", "Origin", "DNT", "Sec-GPC"];
const refused = (status: number) =>
  new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const onRequest: PagesFunction<StagingPagesEnv> = async ({
  request,
  env,
}) => {
  const url = new URL(request.url);
  if (
    url.origin !== origin ||
    url.pathname !== "/__usage" ||
    request.url.includes("?")
  )
    return refused(404);
  if (!env.USAGE_COLLECTOR) return refused(503);
  const headers = new Headers();
  for (const name of permittedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    // A fresh request deliberately excludes cookies, Access JWTs, identity and cf metadata.
    // The shared collector retains all method, payload, privacy and D1 decisions.
    const response = await env.USAGE_COLLECTOR.fetch(
      new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }),
    );
    // The pinned edge runtime supports manual/follow, not the browser's error mode.
    // A private service must never redirect a client or forward this request elsewhere.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return refused(503);
    }
    return response;
  } catch {
    return refused(503);
  }
};
