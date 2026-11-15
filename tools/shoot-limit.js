/* Screenshot the out-of-limit input guard UI. */
const puppeteer = require("/tmp/chrome-dl/node_modules/puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/tmp/chrome-dl/chrome-linux64/chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-breakpad"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });
  await page.goto("http://127.0.0.1:8123/index.html", {
    waitUntil: "networkidle0"
  });
  await page.click("#btnInject");
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({
    path: "/home/hj/userfeedback/uid740/artifacts/shot-limit-guard.png"
  });
  console.log("saved limit guard");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
