import {chromium} from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.goto('http://127.0.0.1:8765');
await page.locator('#explore-search').waitFor();
await page.screenshot({path:'output/preview-desktop.png',fullPage:true});
console.log(JSON.stringify({title:await page.title(),charts:await page.locator('#explore-count').innerText(),errors}));
await browser.close();
