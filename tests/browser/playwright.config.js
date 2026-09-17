import {defineConfig,devices} from '@playwright/test';
const baseURL=`http://127.0.0.1:${process.env.MAIMAI_TEST_PORT||8766}`;
export default defineConfig({
  testDir:'.',testMatch:['standalone.spec.js','community.spec.js','analytics.spec.js','cloudflare-analytics.spec.js','support.spec.js','mai-notes.spec.js','performance.spec.js','progressive.spec.js','player-history.spec.js','player-sorting.spec.js','comparison-search.spec.js','registry.spec.js'],fullyParallel:true,workers:3,
  use:{baseURL,trace:'retain-on-failure'},
  webServer:process.env.MAIMAI_TEST_SERVER === '1' ? undefined : {command:`"${process.env.PYTHON || 'python'}" server.py`,url:baseURL,reuseExistingServer:false},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},
    {name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
    {name:'narrow',use:{...devices['Desktop Chrome'],viewport:{width:320,height:800}}},
    {name:'webkit-comparison',testMatch:['comparison-search.spec.js','registry.spec.js'],use:{...devices['iPhone 13']}}],
});
