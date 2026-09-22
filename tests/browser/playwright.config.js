import {defineConfig,devices} from '@playwright/test';
const baseURL=`http://127.0.0.1:${process.env.MAIMAI_TEST_PORT||8766}`;
export default defineConfig({
  testDir:'.',testMatch:['player-ranges.spec.js','player-results.spec.js','player-maishift-pilot.spec.js','player-maishift-browser.spec.js','player-maishift.spec.js','player-sources.spec.js','share-site.spec.js','localization.spec.js','standalone.spec.js','community.spec.js','analytics.spec.js','cloudflare-analytics.spec.js','stripe-support.spec.js','mai-notes.spec.js','performance.spec.js','progressive.spec.js','player-history.spec.js','player-sorting.spec.js','comparison-search.spec.js','registry.spec.js'],fullyParallel:true,workers:3,
  use:{baseURL,trace:'retain-on-failure'},
  webServer:process.env.MAIMAI_TEST_SERVER === '1' ? undefined : {command:`"${process.env.PYTHON || 'python'}" server.py`,url:baseURL,reuseExistingServer:false},
  projects:[{name:'player-chrome',testMatch:['player-ranges.spec.js','player-results.spec.js','player-maishift-pilot.spec.js','player-maishift-browser.spec.js','player-maishift.spec.js','player-sources.spec.js'],use:{...devices['Desktop Chrome'],channel:'chrome'}},
    {name:'player-edge',testMatch:['player-ranges.spec.js','player-results.spec.js','player-maishift-pilot.spec.js','player-maishift-browser.spec.js','player-maishift.spec.js','player-sources.spec.js'],use:{...devices['Desktop Edge'],channel:'msedge'}},
    {name:'player-firefox',testMatch:['player-ranges.spec.js','player-results.spec.js','player-maishift-pilot.spec.js','player-maishift-browser.spec.js','player-maishift.spec.js','player-sources.spec.js'],use:{...devices['Desktop Firefox']}},
    {name:'player-webkit',testMatch:['player-ranges.spec.js','player-results.spec.js','player-maishift-pilot.spec.js','player-maishift-browser.spec.js','player-maishift.spec.js','player-sources.spec.js'],use:{...devices['Desktop Safari']}},{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},
    {name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
    {name:'narrow',use:{...devices['Desktop Chrome'],viewport:{width:320,height:800}}},
    {name:'webkit-comparison',testMatch:['share-site.spec.js','localization.spec.js','comparison-search.spec.js','registry.spec.js'],use:{...devices['iPhone 13']}}],
});
