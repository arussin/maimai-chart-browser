// Identifiable automation only. Ordinary/unknown browser identities remain eligible.
// Keep this file byte-identical in the badge and Tidbyt traffic Worker.
export const TRAFFIC_POLICY = 'identified-automation-excluded-20261003';
export const AUTOMATION_EXACT = Object.freeze(['node', 'undici']);
export const AUTOMATION_PATTERNS = Object.freeze([
  '%bot%', '%Bot%', '%BOT%', '%crawler%', '%Crawler%', '%CRAWLER%',
  '%spider%', '%Spider%', '%SPIDER%',
  '%Cloudflare-Healthchecks/%', 'Adam-Tidbyt-Suite/%',
  '%HeadlessChrome/%', '%PhantomJS/%', '%Playwright%', '%playwright%',
  '%Puppeteer%', '%puppeteer%', '%Selenium%', '%selenium%',
  '%Chrome-Lighthouse%', '%Google-InspectionTool%',
  '%facebookexternalhit%', '%meta-externalagent%', '%meta-externalfetcher%',
  '%ia_archiver%', '%Slurp%', '%slurp%', '%anthropic-ai%',
  '%Claude-User%', '%ChatGPT-User%', '%Perplexity-User%',
  '%Uptime%', '%uptime%', '%Pingdom%', '%pingdom%', '%StatusCake%',
  '%Datadog%', '%Checkly%', '%checkly%',
  'Maimai-Verification/%', 'Maimai-Test/%', 'Codex-Verification/%',
  'TidbytBridgeVerification/%', 'curl/%', 'Wget/%', 'wget/%',
  'python-requests/%', 'python-httpx/%', 'Go-http-client/%', '%PowerShell/%',
]);

export function automationExclusions() {
  return [
    ...AUTOMATION_EXACT.map(userAgent_neq => ({ userAgent_neq })),
    ...AUTOMATION_PATTERNS.map(userAgent_notlike => ({ userAgent_notlike })),
  ];
}
