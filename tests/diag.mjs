import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('response', r => console.log(r.status(), r.url()));
p.on('pageerror', e => console.log('[pageerror]', e.message, e.stack));
await p.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await b.close();
