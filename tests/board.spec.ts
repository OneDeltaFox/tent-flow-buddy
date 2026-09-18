import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const pods = ["A", "B", "C", "D"].map((id) => ({
  id,
  name: `Pod ${id}`,
  zone: "Finish",
  note: "",
  color: "#06b6d4",
  closed: id === "C",
  capabilities: ["Cooling"],
  staff: [],
  beds: [1, 2, 3, 4].map((number) => ({
    id: `${id}${number}`,
    label: `${id}${number}`,
    status: (id === "A" && number === 1) || id === "D" ? "occupied" : "open",
    ...((id === "A" && number === 1) || id === "D"
      ? { bib: `${id}${number}00`, triage: "immediate", complaint: "Dizziness", since: "10:00" }
      : {}),
  })),
}));

async function savedPods(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tent-board-pods-v3")!));
}

async function drag(page: Page, source: Locator, target: Locator, touch: boolean, delay = 550) {
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    await page.waitForTimeout(delay);
    for (let step = 1; step <= 8; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(delay);
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }
}

test.beforeEach(async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") throw new Error(message.text());
  });
  await page.addInitScript((pods) => {
    localStorage.setItem("tent-board-pods-v3", JSON.stringify(pods));
    localStorage.setItem(
      "tent-board-incoming-v1",
      JSON.stringify([
        { id: "incoming-test", bib: "9900", triage: "untriaged", complaint: "Head Pain" },
      ]),
    );
    localStorage.setItem("tent-board-dispositions-v1", "[]");
  }, pods);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Edit Pod A", exact: true })).toBeVisible();
});

test("patient modal saves and protects unsaved changes", async ({ page }) => {
  await page.getByRole("button", { name: "Edit patient A100", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Edit Patient" });
  await expect(modal).toBeVisible();
  await modal.getByLabel("Notes").fill("Awaiting transport");
  page.once("dialog", (dialog) => dialog.dismiss());
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect((await savedPods(page))[0].beds[0].operationalStatus).toBe("Awaiting transport");
  await page.getByRole("button", { name: "Edit patient A100", exact: true }).click();
  await modal.getByLabel("Race #").fill("changed");
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  expect((await savedPods(page))[0].beds[0].bib).toBe("A100");
});

test("pod details open above the board and return after patient editing", async ({
  page,
}, testInfo) => {
  const grid = page.locator(".pod-grid");
  const before = await grid.boundingBox();
  await page.getByRole("button", { name: /^Pod A 1\/4/ }).click();
  const details = page.getByRole("dialog", { name: "Pod A", exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByText("Cooling", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Edit patient A100", exact: true }),
  ).toBeVisible();
  await expect(details.locator(".cursor-grab")).toHaveCount(0);
  expect((await grid.boundingBox())?.height).toBe(before?.height);
  const box = (await details.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: testInfo.outputPath("pod-popup.png"), animations: "disabled" });
  await details.getByRole("button", { name: "Edit patient A100", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Patient", exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Notes").fill("Resting");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(details).toBeVisible();
  await expect(details.getByText("Resting", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await grid.boundingBox())?.height).toBe(before?.height);
});

test("pod modal uses a draft and preserves active patients", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Pod A", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Edit pod", exact: true });
  await expect(modal.getByRole("button", { name: "Remove pod" })).toBeDisabled();
  await modal.getByLabel("Pod name").fill("Acute care");
  page.once("dialog", (dialog) => dialog.accept());
  await modal.getByRole("button", { name: "Cancel" }).click();
  expect((await savedPods(page))[0].name).toBe("Pod A");
  await page.getByRole("button", { name: "Edit Pod A", exact: true }).click();
  await modal.getByLabel("Pod name").fill("Acute care");
  await modal.getByLabel("New capability").fill("IV access");
  await modal.getByRole("button", { name: "Add", exact: true }).click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  const saved = (await savedPods(page))[0];
  expect(saved.name).toBe("Acute care");
  expect(saved.capabilities).toEqual(["Cooling", "IV access"]);
  expect(saved.beds[0].bib).toBe("A100");
});

test("long press moves directly between pods without opening an editor", async ({
  page,
  isMobile,
}) => {
  const source = page.getByRole("button", { name: "Edit patient A100", exact: true });
  const target = page.locator('[data-drop-target*="B1"]').first();
  await drag(page, source, target, isMobile);
  await expect.poll(async () => (await savedPods(page))[1].beds[0].bib).toBe("A100");
  const saved = await savedPods(page);
  expect(saved[0].beds[0].status).toBe("open");
  expect(saved[1].beds[0].triage).toBe("immediate");
  expect(saved[1].beds[0].since).toBe("10:00");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("closed and occupied beds reject drops", async ({ page, isMobile }) => {
  const source = page.getByRole("button", { name: "Edit patient A100", exact: true });
  const closed = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Pod C", exact: true }) });
  await drag(page, source, closed.getByText("3-1", { exact: true }), isMobile);
  expect((await savedPods(page))[0].beds[0].bib).toBe("A100");
  await page.waitForTimeout(550);
  await drag(
    page,
    source,
    page.getByRole("button", { name: "Edit patient D100", exact: true }),
    isMobile,
  );
  expect((await savedPods(page))[0].beds[0].bib).toBe("A100");
  expect((await savedPods(page))[3].beds[0].bib).toBe("D100");
});

test("incoming can be edited and assigned without drag", async ({ page }) => {
  await page.getByRole("button", { name: /Incoming \(1\)/ }).click();
  await page.getByRole("button", { name: "Edit patient 9900", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Move to pod").selectOption("B");
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  expect((await savedPods(page))[1].beds[0].bib).toBe("9900");
  expect((await savedPods(page))[1].beds[0].triage).toBe("untriaged");
});

test("screen and dialogs fit without horizontal overflow", async ({ page }, testInfo) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const tiles = page.locator(".pod-grid .patient-surface");
  for (const tile of await tiles.all()) {
    const box = (await tile.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: testInfo.outputPath("board.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "New Patient", exact: true }).click();
  const box = (await page.getByRole("dialog").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({
    path: testInfo.outputPath("new-patient.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("incoming long press assigns to an open bed", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: /Incoming \(1\)/ }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Edit patient 9900", exact: true }),
    page.locator('[data-drop-target*="B1"]').first(),
    isMobile,
  );
  await expect.poll(async () => (await savedPods(page))[1].beds[0].bib).toBe("9900");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("tent-board-incoming-v1")!)),
  ).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("disposition drop preserves cleaning and ready workflow", async ({ page, isMobile }) => {
  await drag(
    page,
    page.getByRole("button", { name: "Edit patient A100", exact: true }),
    page.locator('[data-drop-target*="discharged"]'),
    isMobile,
  );
  await expect.poll(async () => (await savedPods(page))[0].beds[0].status).toBe("cleaning");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("tent-board-dispositions-v1")!)[0].bib,
    ),
  ).toBe("A100");
  await page.getByRole("button", { name: /^Pod A 0\/4/ }).click();
  await page.getByRole("button", { name: "1-1 ready", exact: true }).click();
  expect((await savedPods(page))[0].beds[0].status).toBe("open");
});

test("movement before the hold threshold does not move patients", async ({ page, isMobile }) => {
  // Swipe vertically so the browser's horizontal history gesture is not invoked.
  const targetPod = isMobile && page.viewportSize()!.width >= 768 ? "A" : "B";
  await drag(
    page,
    page.getByRole("button", { name: "Edit patient D300", exact: true }),
    page.locator(`[data-drop-target*="${targetPod}3"]`).first(),
    isMobile,
    30,
  );
  expect((await savedPods(page))[3].beds[2].bib).toBe("D300");
  expect((await savedPods(page))[targetPod === "A" ? 0 : 1].beds[2].status).toBe("open");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("touch scroll starting on a tile remains available", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch-specific scrolling check");
  await page.setViewportSize({ width: 390, height: 600 });
  const source = page.getByRole("button", { name: "Edit patient D100", exact: true });
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const before = await page.evaluate(() => window.scrollY);
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let step = 1; step <= 6; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - step * 20, id: 1 }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  expect((await savedPods(page))[3].beds[0].bib).toBe("D100");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await client.detach();
});

test("active drag scrolls to offscreen disposition targets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch edge scrolling check");
  await page.setViewportSize({ width: 390, height: 550 });
  const source = page.getByRole("button", { name: "Edit patient A100", exact: true });
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(550);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 195, y: 540, id: 1 }],
  });
  const target = page.locator('[data-drop-target*="discharged"]');
  await expect
    .poll(async () => {
      const rect = (await target.boundingBox())!;
      return rect.y + rect.height;
    })
    .toBeLessThan(540);
  const rect = (await target.boundingBox())!;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await savedPods(page))[0].beds[0].status).toBe("cleaning");
  await client.detach();
});

test("small phones and landscape retain usable modals", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Additional phone dimensions");
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Edit Pod A", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});
