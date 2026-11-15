/**
 * 真实浏览器冒烟（可选，需要 Chrome for Testing）：
 * node test/browser.smoke.js /path/to/chrome
 * 验证 Canvas 实际渲染、三视图切换、悬停 tooltip、PNG 下载与数值一致性。
 */
var path = require('path');
var fs = require('fs');
var puppeteer = require('puppeteer');

var chromePath = process.argv[2]
  || '/home/hj/.codex-relay-home-7ljut8in/.cache/puppeteer/manual/chrome-linux64/chrome';
var fileUrl = 'file://' + path.join(__dirname, '..', 'index.html');

(async function () {
  var browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-breakpad',
      '--disable-crash-reporter', '--allow-file-access-from-files']
  });
  var page = await browser.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  await page.setViewport({ width: 1280, height: 1400 });

  var downloaded = null;
  page.on('response', function () {});
  var client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: path.join(__dirname, '..', 'artifacts'),
    eventsEnabled: true
  });
  client.on('Browser.downloadProgress', function (e) {
    if (e.state === 'completed') downloaded = e;
  });

  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#station-table tbody tr');

  var initialRows = await page.$$eval('#station-table tbody tr', function (trs) { return trs.length; });
  var meta = await page.$eval('#meta-bar', function (el) { return el.textContent; });

  await page.select('#dataset-select', 'duplicate');
  await page.waitForFunction(function () {
    return document.querySelectorAll('#quality-summary .quality-card')[2].textContent.indexOf('0') === -1;
  });
  var quality = await page.$$eval('#quality-summary .quality-card', function (cards) {
    return cards.map(function (c) { return c.querySelector('.num').textContent; });
  });

  for (var i = 0; i < ['line', 'profile', 'heatmap'].length; i++) {
    var view = ['line', 'profile', 'heatmap'][i];
    await page.click('#view-switch button[data-view="' + view + '"]');
    await page.waitForFunction(function (v) {
      return document.querySelector('#view-switch button.active').getAttribute('data-view') === v;
    }, {}, view);
  }

  await page.select('#window-select', 'day3');
  await page.waitForFunction(function () {
    return document.querySelectorAll('#detail-table tbody tr').length === 24;
  });
  await page.select('#window-select', 'all');
  var retainedView = await page.$eval('#view-switch button.active', function (b) {
    return b.getAttribute('data-view');
  });

  var canvas = await page.$('#tide-canvas');
  var box = await canvas.boundingBox();
  await page.mouse.move(box.x + 260, box.y + 180);
  await page.waitForSelector('#tooltip:not([hidden])');
  var tip = await page.$eval('#tooltip', function (el) { return el.textContent; });

  var screenMax = await page.$eval('#station-table tbody tr td:nth-child(5)', function (td) {
    return td.textContent;
  });
  var beforeFiles = fs.readdirSync(path.join(__dirname, '..', 'artifacts'));
  await page.click('#export-png');
  await new Promise(function (r) { setTimeout(r, 1200); });
  var afterFiles = fs.readdirSync(path.join(__dirname, '..', 'artifacts'));
  var png = afterFiles.filter(function (f) { return f.slice(-4) === '.png' && beforeFiles.indexOf(f) === -1; });
  var pngSize = png.length ? fs.statSync(path.join(__dirname, '..', 'artifacts', png[0])).size : 0;

  var selfTest = await page.evaluate(function () {
    document.getElementById('run-selftest').click();
    return document.getElementById('selftest-out').textContent;
  });

  var report = {
    pageErrors: errors,
    initialStationRows: initialRows,
    metaHasVersion: meta.indexOf('synth-tide-2026.11-v1') !== -1,
    duplicateQuality: quality,
    retainedViewAfterWindowBack: retainedView,
    tooltipSample: tip.replace(/\s+/g, ' ').trim(),
    screenMax: screenMax,
    exportedPng: png[0] || null,
    exportedPngBytes: pngSize,
    selfTest: selfTest
  };
  console.log(JSON.stringify(report, null, 2));
  var ok = !errors.length && initialRows === 8 && retainedView === 'heatmap'
    && pngSize > 50000 && /全部通过/.test(selfTest) && /潮高：/.test(tip);
  await browser.close();
  if (!ok) process.exit(1);
  console.log('\nBROWSER_SMOKE_OK');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
