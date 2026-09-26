import {defineConfig, devices} from '@playwright/test';

// Explicit opt-in acceptance gate. Missing artifacts fail configuration;
// this suite must never become a silently skipped release check.
for (const key of ['MAIMAI_TRANSITION_BASELINE_ROOT', 'MAIMAI_TRANSITION_CANDIDATE_ROOT']) {
  if (!process.env[key]) throw Error(`Set ${key} to a retained, complete browser artifact root.`);
}
export default defineConfig({
  testDir: '.',
  testMatch: 'release-transition.spec.js',
  workers: 1,
  timeout: 90000,
  expect: {timeout: 15000},
  use: {trace: 'retain-on-failure'},
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome']}},
    {name: 'firefox', use: {...devices['Desktop Firefox']}},
    {name: 'webkit', use: {...devices['Desktop Safari']}},
  ],
});
