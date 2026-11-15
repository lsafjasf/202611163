import { test, expect } from "@playwright/test";

async function openGame(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__relay));
  return errors;
}

async function state(page) {
  return page.evaluate(() => window.__relay.getState());
}

function createKeyboard(page) {
  const held = new Set();
  const set = async (key, want) => {
    if (want && !held.has(key)) {
      await page.keyboard.down(key);
      held.add(key);
    } else if (!want && held.has(key)) {
      await page.keyboard.up(key);
      held.delete(key);
    }
  };
  return {
    held,
    set,
    async releaseAll() {
      for (const key of [...held]) await page.keyboard.up(key);
      held.clear();
    },
  };
}

function chooseDrive(snapshot) {
  const gap = snapshot.cargo.x - 644;
  let desired = 54;
  if (gap < 70) desired = 27;
  if (gap < 24) desired = 16;
  if (gap < -18) desired = 10;
  return {
    w: snapshot.tension < desired - 3,
    s: snapshot.tension > desired + 3,
  };
}

function chooseGuide(snapshot) {
  const desiredX = Math.max(
    568,
    Math.min(720, 644 + Math.max(-72, Math.min(72, -snapshot.cargo.vx * 2.8))),
  );
  const desiredY = Math.max(
    278,
    Math.min(346, 312 - snapshot.wind * 1.08 - snapshot.cargo.vy * 1.5),
  );
  return {
    ArrowRight: desiredX - snapshot.guide.x > 6,
    ArrowLeft: desiredX - snapshot.guide.x < -6,
    ArrowDown: desiredY - snapshot.guide.y > 6,
    ArrowUp: desiredY - snapshot.guide.y < -6,
  };
}

async function driveMission(
  page,
  { mode = "normal", probeRetrieval = false, maxLoops = 2200 } = {},
) {
  const keyboard = createKeyboard(page);
  let recoveryStage = 0;
  let probe = null;
  let attemptedProbe = false;
  let final = null;

  await page.keyboard.press("Enter");
  await page.waitForTimeout(220);

  for (let index = 0; index < maxLoops; index += 1) {
    const snapshot = await state(page);
    final = snapshot;
    if (snapshot.phase === "won" || snapshot.phase === "lost") break;

    let drive = chooseDrive(snapshot);
    const guide =
      mode === "misguide"
        ? { ArrowDown: true, ArrowUp: false, ArrowLeft: false, ArrowRight: false }
        : chooseGuide(snapshot);

    if (mode === "recover") {
      if (!recoveryStage && snapshot.elapsed > 0.7) {
        if (snapshot.tension < 89) {
          drive = { w: true, s: false };
        } else {
          recoveryStage = 1;
        }
      }
      if (recoveryStage === 1) {
        if (snapshot.tension > 67) {
          drive = { w: false, s: true };
        } else {
          recoveryStage = 2;
        }
      }
    }

    if (snapshot.phase === "retrieving" && probeRetrieval && !attemptedProbe) {
      attemptedProbe = true;
      await keyboard.releaseAll();
      await keyboard.set("r", true);
      await page.waitForTimeout(700);
      const leftOnly = await state(page);
      await keyboard.set("r", false);
      await page.waitForTimeout(1800);
      await keyboard.set("p", true);
      await page.waitForTimeout(700);
      const rightOnly = await state(page);
      await keyboard.set("p", false);
      probe = { leftOnly, rightOnly };
    }

    await keyboard.set("w", drive.w);
    await keyboard.set("s", drive.s);
    await keyboard.set("ArrowRight", guide.ArrowRight);
    await keyboard.set("ArrowLeft", guide.ArrowLeft);
    await keyboard.set("ArrowDown", guide.ArrowDown);
    await keyboard.set("ArrowUp", guide.ArrowUp);
    const retrieving = snapshot.phase === "retrieving";
    await keyboard.set("r", retrieving);
    await keyboard.set("p", retrieving);
    await page.waitForTimeout(45);
  }

  await keyboard.releaseAll();
  await page.waitForTimeout(250);
  final = await state(page);
  return { final, probe };
}

test("simultaneous controls update both sides, shared state and audio", async ({ page }) => {
  const errors = await openGame(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const before = await state(page);

  await page.keyboard.down("w");
  await page.waitForTimeout(650);
  const driveOnly = await state(page);
  await page.keyboard.up("w");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const driveFrozen = await state(page);
  await expect(page.locator("#rightPanel [data-bind='mirrorTensionRow']")).toHaveText(
    `${Math.round(driveFrozen.displayTension)}%`,
  );
  await expect(page.locator("#leftPanel [data-bind='mirrorProgress']")).toHaveText(
    await page.locator("#rightPanel [data-bind='mirrorProgress']").textContent(),
  );
  await expect(page.locator("#leftPanel [data-bind='mirrorRope']")).toHaveText(
    `${Math.round(driveOnly.ropeIntegrity)}%`,
  );
  expect(driveOnly.audio.frequency).toBeGreaterThan(before.audio.frequency);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);

  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(650);
  const guideOnly = await state(page);
  await page.keyboard.up("ArrowDown");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const guideFrozen = await state(page);
  const guideError = (
    Math.hypot(guideFrozen.cargo.x - 644, guideFrozen.cargo.y - 312) / 23
  ).toFixed(1);
  await expect(page.locator("#leftPanel [data-bind='mirrorError']")).toHaveText(
    `${guideError} m`,
  );
  await expect(page.locator("#rightPanel [data-bind='mirrorCargo']")).toHaveText(
    `${Math.round(guideFrozen.cargoIntegrity)}%`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);

  await page.keyboard.down("w");
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(650);
  const during = await state(page);
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowDown");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const frozen = await state(page);

  expect(frozen.guide.y).toBeGreaterThan(guideFrozen.guide.y);
  expect(frozen.cargo.x).toBeLessThan(guideFrozen.cargo.x - 8);
  expect(during.audio.initialized).toBe(true);
  expect(during.audio.tensionGain).toBeGreaterThan(before.audio.tensionGain);

  await expect(page.locator("#leftPanel [data-bind='mirrorError']")).not.toHaveText("16.0 m");
  await expect(page.locator("#rightPanel [data-bind='mirrorTensionRow']")).toHaveText(
    `${Math.round(frozen.displayTension)}%`,
  );
  await expect(page.locator("#rightPanel [data-bind='mirrorProgress']")).toHaveText(
    await page.locator("#leftPanel [data-bind='mirrorProgress']").textContent(),
  );
  expect(errors.filter((message) => !message.includes("favicon"))).toEqual([]);
});

test("co-op completion requires both retrieval controls and saves a full replay", async ({
  page,
}) => {
  await openGame(page);
  const { final, probe } = await driveMission(page, { probeRetrieval: true });

  expect(probe).not.toBeNull();
  expect(probe.leftOnly.retrieve.left).toBeGreaterThan(20);
  expect(probe.leftOnly.retrieve.right).toBe(0);
  expect(probe.leftOnly.retrieve.progress).toBe(0);
  expect(probe.rightOnly.retrieve.right).toBeGreaterThan(20);
  expect(probe.rightOnly.retrieve.left).toBe(0);
  expect(probe.rightOnly.retrieve.progress).toBe(0);
  expect(final.phase).toBe("won");
  expect(final.progress).toBe(100);
  expect(final.retrieve.progress).toBe(100);
  expect(final.playerActions.P1).toBeGreaterThan(0);
  expect(final.playerActions.P2).toBeGreaterThan(0);
  await expect(page.locator("#resultOverlay")).toBeVisible();
  await expect(page.locator("#resultTitle")).toHaveText("物资已送达");

  const replay = await page.evaluate((id) => window.__relay.getReplay(id), final.lastReplayId);
  expect(replay.outcome).toBe("success");
  expect(replay.snapshots.length).toBeGreaterThan(50);
  expect(replay.conflicts).toBeGreaterThanOrEqual(2);
  expect(replay.events.some((event) => event.type === "landed")).toBe(true);
  expect(replay.events.some((event) => event.type === "complete")).toBe(true);
  expect(replay.events.some((event) => event.conflict)).toBe(true);
});

test("one-sided landing error fails clearly and records the conflict", async ({ page }) => {
  await openGame(page);
  const { final } = await driveMission(page, { mode: "misguide", maxLoops: 500 });

  expect(final.phase).toBe("lost");
  expect(final.result.reason).toBe("crate-lost");
  expect(final.playerActions.P1).toBeGreaterThan(0);
  expect(final.playerActions.P2).toBeGreaterThan(0);
  await expect(page.locator("#resultOverlay")).toBeVisible();
  await expect(page.locator("#resultTitle")).toHaveText("货箱坠入峡谷");
  await expect(page.locator("#resultIcon")).toHaveClass(/is-failure/);

  const replay = await page.evaluate((id) => window.__relay.getReplay(id), final.lastReplayId);
  expect(replay.outcome).toBe("failure");
  expect(replay.reason).toBe("crate-lost");
  expect(replay.conflicts).toBeGreaterThanOrEqual(3);
  expect(replay.events.some((event) => event.type === "crate-lost")).toBe(true);
});

test("sustained over-tension snaps the main rope and shows the break reason", async ({ page }) => {
  await openGame(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.down("w");
  let final;
  for (let index = 0; index < 45; index += 1) {
    await page.waitForTimeout(100);
    final = await state(page);
    if (final.phase === "lost") break;
  }
  await page.keyboard.up("w");
  await page.waitForTimeout(250);
  final = await state(page);

  expect(final.phase).toBe("lost");
  expect(final.result.reason).toBe("rope-break");
  expect(final.ropeIntegrity).toBe(0);
  expect(final.events.some((event) => event.type === "tension-critical")).toBe(true);
  expect(final.events.some((event) => event.type === "rope-break")).toBe(true);
  await expect(page.locator("#resultTitle")).toHaveText("主索断裂");
  await expect(page.locator("#resultOverlay")).toBeVisible();
});

test("tension overload can be recovered and still complete", async ({ page }) => {
  await openGame(page);
  const { final } = await driveMission(page, { mode: "recover" });

  expect(final.phase).toBe("won");
  expect(final.ropeIntegrity).toBeLessThan(100);
  expect(final.ropeIntegrity).toBeGreaterThan(0);
  expect(final.events.some((event) => event.type === "tension-critical")).toBe(true);
  expect(final.events.some((event) => event.type === "tension-recovered")).toBe(true);
  await expect(page.locator("#ropeIntegrity")).toContainText("%");
  await expect(page.locator("#taskProgress")).toHaveText("100%");
});

test("pause freezes physics and audio, restart resets both sides synchronously", async ({
  page,
}) => {
  await openGame(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(950);
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowDown");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const pausedA = await state(page);
  await page.waitForTimeout(750);
  const pausedB = await state(page);
  expect(pausedA.paused).toBe(true);
  expect(pausedB.elapsed).toBe(pausedA.elapsed);
  expect(pausedB.timeLeft).toBe(pausedA.timeLeft);
  expect(pausedA.audio.contextState).toBe("suspended");
  await expect(page.locator("#pauseOverlay")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.keyboard.press("n");
  await page.waitForTimeout(180);
  const restarted = await state(page);

  expect(restarted.phase).toBe("playing");
  expect(restarted.paused).toBe(false);
  expect(restarted.timeLeft).toBeGreaterThan(74.5);
  expect(restarted.tension).toBeGreaterThan(25);
  expect(restarted.tension).toBeLessThan(30);
  expect(restarted.guide).toEqual({ x: 644, y: 312 });
  expect(restarted.progress).toBeLessThan(2);
  expect(restarted.retrieve).toEqual({ left: 0, right: 0, progress: 0 });
  expect(restarted.ropeIntegrity).toBe(100);
  expect(restarted.audio.contextState).toBe("running");
  expect(restarted.audio.paused).toBe(false);
  expect(restarted.audio.frequency).toBeLessThan(220);
  await expect(page.locator("#pauseOverlay")).toBeHidden();
  await expect(page.locator("#leftPanel [data-bind='mirrorProgress']")).toHaveText(
    await page.locator("#rightPanel [data-bind='mirrorProgress']").textContent(),
  );
  await expect(page.locator("#ropeIntegrity")).toHaveText("100%");
});

test("side rotation gives P1 the guide side and P2 the winch side", async ({ page }) => {
  await openGame(page);
  await page.click("#swapBtn");
  await page.waitForTimeout(180);
  const swapped = await state(page);
  expect(swapped.swapped).toBe(true);
  expect(swapped.phase).toBe("ready");
  expect(swapped.assignments.left).toEqual({ player: "P2", role: "收索手" });
  expect(swapped.assignments.right).toEqual({ player: "P1", role: "引导手" });
  await expect(page.locator("#sideSwapBadge")).toBeVisible();
  await expect(page.locator("#leftPanel [data-bind='playerTag']")).toHaveText("P2");
  await expect(page.locator("#rightPanel [data-bind='playerTag']")).toHaveText("P1");

  const { final } = await driveMission(page);
  expect(final.phase).toBe("won");
  expect(final.swapped).toBe(true);
  expect(final.playerActions.P1).toBeGreaterThan(0);
  expect(final.playerActions.P2).toBeGreaterThan(0);
  const replay = await page.evaluate((id) => window.__relay.getReplay(id), final.lastReplayId);
  expect(replay.swapped).toBe(true);
  expect(replay.outcome).toBe("success");
});

test("single-player debug mode exposes both sides without official side attribution", async ({
  page,
}) => {
  await openGame(page);
  await page.keyboard.press("F2");
  await page.waitForTimeout(180);
  const debug = await state(page);
  expect(debug.singlePlayer).toBe(true);
  expect(debug.phase).toBe("ready");
  await expect(page.locator("#soloBadge")).toBeVisible();
  await expect(page.locator("#soloBtn")).toHaveClass(/is-active/);

  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(550);
  const active = await state(page);
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowUp");
  expect(active.tension).toBeGreaterThan(debug.tension);
  expect(active.guide.y).toBeLessThan(debug.guide.y);
});

test("replay archive contains a complete run and every conflict timestamp", async ({ page }) => {
  await openGame(page);
  await page.click("#replayBtn");
  await expect(page.locator("#replayDialog")).toBeVisible();
  await expect(page.locator(".replay-entry")).toHaveCount(4);
  await page.click('[data-replay-id="demo-success"]');
  await page.waitForTimeout(250);

  const replay = await page.evaluate(() => window.__relay.getReplay("demo-success"));
  expect(replay.outcome).toBe("success");
  expect(replay.snapshots.length).toBeGreaterThan(60);
  expect(replay.conflicts).toBe(replay.events.filter((event) => event.conflict).length);
  await expect(page.locator(".conflict-row")).toHaveCount(replay.conflicts);
  await expect(page.locator(".timeline-markers i")).toHaveCount(replay.conflicts);
  const firstConflict = replay.events.find((event) => event.conflict);
  await page.locator(".conflict-row").first().click();
  await expect(page.locator("#replayTimecode")).toHaveText(
    `${String(Math.floor(firstConflict.t / 60)).padStart(2, "0")}:${String(
      Math.floor(firstConflict.t % 60),
    ).padStart(2, "0")}.${Math.floor((firstConflict.t % 1) * 10)}`,
  );

  const download = page.waitForEvent("download");
  await page.click("#exportReplayBtn");
  expect((await download).suggestedFilename()).toBe("demo-success.json");
});
