/* Capture UI screenshots for the three canonical scenarios. */
const puppeteer = require("/tmp/chrome-dl/node_modules/puppeteer-core");
const fs = require("fs");

const EXEC = "/tmp/chrome-dl/chrome-linux64/chrome";
const OUT = "/home/hj/userfeedback/uid740/artifacts";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-breakpad"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });
  await page.goto("http://127.0.0.1:8123/index.html", {
    waitUntil: "networkidle0"
  });

  const shots = [
    { name: "normal", wait: 3500 },
    { name: "extreme", scenario: 1, wait: 7000 },
    { name: "unstable", scenario: 2, wait: 6000 }
  ];
  for (const shot of shots) {
    if (shot.scenario !== undefined) {
      await page.evaluate((idx) => {
        const btns = document.querySelectorAll("#scenarioBtns .btn");
        btns[idx].click();
      }, shot.scenario);
    }
    await new Promise((r) => setTimeout(r, shot.wait));
    await page.screenshot({ path: OUT + "/shot-" + shot.name + ".png" });
    console.log("saved " + shot.name);
  }
  await browser.close();
  fs.writeFileSync(OUT + "/.shots-done", "ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
