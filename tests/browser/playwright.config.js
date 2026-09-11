import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'.',testMatch:'standalone.spec.js',fullyParallel:true,workers:3,
  use:{baseURL:'http://127.0.0.1:8766',trace:'retain-on-failure'},
  webServer:process.env.MAIMAI_TEST_SERVER === '1' ? undefined : {command:`"${process.env.PYTHON || 'python'}" server.py`,url:'http://127.0.0.1:8766',reuseExistingServer:false},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},
    {name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
    {name:'narrow',use:{...devices['Desktop Chrome'],viewport:{width:320,height:800}}}],
});
