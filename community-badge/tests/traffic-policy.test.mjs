import test from 'node:test';
import assert from 'node:assert/strict';
import {automationExclusions, AUTOMATION_EXACT, AUTOMATION_PATTERNS} from '../traffic-policy.mjs';
const filter = automationExclusions();
const accepts = ua => filter.every(c => c.userAgent_neq !== undefined ? ua !== c.userAgent_neq :
  !new RegExp('^' + c.userAgent_notlike.split('%').map(RegExp.escape).join('.*') + '$').test(ua));

test('self-identifying crawlers, test browsers and probes are excluded; browsers remain', () => {
  const excluded = [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 (compatible; Googlebot/2.1)', 'bingbot/2.0', 'NewCrawler/1.0',
    'Bytespider', 'NEWBOT/8.0', 'Mozilla/5.0 HeadlessChrome/153.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible;Cloudflare-Healthchecks/1.0; healthcheck-id: replacement-id)',
    'Adam-Tidbyt-Suite/0.2 (read-only)', 'Maimai-Verification/1.0', 'Maimai-Test/1.0',
    'node', 'undici', 'curl/8.0', 'python-requests/2.32', 'Wget/1.1',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)', 'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; ChatGPT-User/1.0)', 'Playwright/1.0', 'Uptime-Kuma/1.0',
  ];
  for (const ua of excluded) assert.equal(accepts(ua), false, ua);
  for (const ua of ['', 'Unknown/Others', 'ordinary browser',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 Firefox/145.0', 'Mozilla/5.0 SamsungBrowser/28.0', 'node-browser/1.0',
  ]) assert.equal(accepts(ua), true, ua);
  assert.equal(new Set(AUTOMATION_EXACT).size, AUTOMATION_EXACT.length);
  assert.equal(new Set(AUTOMATION_PATTERNS).size, AUTOMATION_PATTERNS.length);
  assert.equal(filter.length, AUTOMATION_EXACT.length + AUTOMATION_PATTERNS.length);
});
