import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<h1>ok</h1>');
console.log('TITLE:', await page.textContent('h1'));
await browser.close();
