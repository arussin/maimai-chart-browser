import {defineConfig,devices} from '@playwright/test';
if(!process.env.MAIMAI_VISUAL_BASELINE)throw Error('Set MAIMAI_VISUAL_BASELINE to the retained DevCache baseline directory.');
const port=process.env.MAIMAI_TEST_PORT||'8791';
export default defineConfig({
  testDir:'.',testMatch:'architecture-visual.spec.js',workers:2,
  snapshotPathTemplate:process.env.MAIMAI_VISUAL_BASELINE+'/{projectName}/{arg}{ext}',
  expect:{toHaveScreenshot:{maxDiffPixels:0,animations:'disabled',caret:'hide'}},
  use:{baseURL:'http://127.0.0.1:'+port,reducedMotion:'reduce',trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}},
  ],
  webServer:{command:'"'+process.env.PYTHON+'" server.py',url:'http://127.0.0.1:'+port,reuseExistingServer:false},
});
