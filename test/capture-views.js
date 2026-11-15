var path = require('path');
var puppeteer = require('puppeteer');
var chromePath = process.argv[2]
  || '/home/hj/.codex-relay-home-7ljut8in/.cache/puppeteer/manual/chrome-linux64/chrome';
var fileUrl = 'file://' + path.join(__dirname, '..', 'index.html');

(async function () {
  var browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-breakpad', '--allow-file-access-from-files']
  });
  var page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.select('#dataset-select', 'duplicate');
  await page.waitForSelector('#station-table tbody tr');
  for (var i = 0; i < ['heatmap', 'line', 'profile'].length; i++) {
    var view = ['heatmap', 'line', 'profile'][i];
    await page.click('#view-switch button[data-view="' + view + '"]');
    await new Promise(function (r) { setTimeout(r, 300); });
    await page.screenshot({
      path: path.join(__dirname, '..', 'artifacts', 'view-' + view + '.png'),
      clip: { x: 0, y: 0, width: 1280, height: 620 }
    });
  }
  await browser.close();
  console.log('CAPTURED');
})().catch(function (e) { console.error(e); process.exit(1); });
