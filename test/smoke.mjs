// Browser smoke test: load the app, exercise views/exports, screenshot.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nf');
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(800);

const shot = (n) => page.screenshot({ path: `artifacts/${n}.png` });
await shot('smoke-flat-default');

// switch texture types
await page.click('#seg-type button[data-type="fabric"]');
await page.waitForTimeout(400);
await page.click('#seg-type button[data-type="wood"]');
await page.waitForTimeout(400);

// model view
await page.click('#seg-view button[data-view="model"]');
await page.waitForTimeout(600);
await shot('smoke-model-sphere');
await page.click('#seg-model button[data-model="cube"]');
await page.waitForTimeout(600);
await shot('smoke-model-cube');
await page.click('#seg-view button[data-view="flat"]');
await page.waitForTimeout(300);

// brush a repair stroke near the left edge of the center tile
const box = await page.locator('#stage').boundingBox();
const cx = box.x + box.width / 3 + 8; // center tile starts at 1/3
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 30, cy + 10, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
await shot('smoke-repair');

// undo the repair
await page.click('#btn-undo');
await page.waitForTimeout(200);

// save + reload roundtrip
await page.click('#btn-save');
await page.click('#p-scale', { force: true });
await page.click('#btn-reload');
await page.waitForTimeout(400);

// export PNG 512 (expect download)
const dl = page.waitForEvent('download', { timeout: 10000 });
await page.click('#btn-png512');
const download = await dl;
console.log('download:', download.suggestedFilename());

// boundary case: load template, expect validation toast, export blocked
await page.click('#btn-tpl-boundary');
await page.waitForTimeout(500);
const toastVisible = await page.locator('#toast').isVisible();
console.log('boundary toast visible:', toastVisible);
await shot('smoke-boundary');
await page.click('#btn-png1024');
await page.waitForTimeout(300);
const toast2 = await page.locator('#toast').textContent();
console.log('export blocked with guidance:', /请/.test(toast2 || ''));

// SVG export on default template
await page.click('#btn-tpl-default');
await page.waitForTimeout(400);
const dl2 = page.waitForEvent('download', { timeout: 10000 });
await page.click('#btn-svg');
const svgDl = await dl2;
console.log('download:', svgDl.suggestedFilename());

if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
} else {
  console.log('no page errors');
}
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
