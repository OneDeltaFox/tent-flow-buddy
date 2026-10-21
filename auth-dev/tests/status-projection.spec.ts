import { expect, test } from "@playwright/test";

test("projection board fits race numbers and compact pods on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({
    access_token: "test", refresh_token: "test", token_type: "bearer",
    expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "viewer" },
  })));
  const pods = Array.from({ length: 20 }, (_, index) => ({
    id: `pod-${index}`, name: index < 16 ? `Pod ${index+1}` : `Pool ${index-15}`,
    kind: index < 16 ? "regular" : "pool", color: index < 8 ? "#f97316" : "#eab308",
    closed: false, capabilities: [], beds: Array.from({ length: index < 16 ? 4 : 1 }, (_, n) => ({
      id: `bed-${index}-${n}`, label: `${index+1}-${n+1}`, status: n < 2 ? "occupied" : "open",
    })),
  }));
  const beds = pods.flatMap((pod, index) => pod.beds.filter((_, n) => n < 2).map((bed, n) => ({
    bed_id: bed.id, bib: index === 0 && n === 0 ? "12345678" : String(21000+index*4+n),
    triage: ["immediate","delayed","minor","untriaged"][index%4], complaint: "Hidden complaint",
    medical_started_at: new Date(Date.now()-900000).toISOString(),
    pool_started_at: index >= 16 ? new Date(Date.now()-120000).toISOString() : null,
  })));
  await page.route("**/rest/v1/rpc/my_races", route => route.fulfill({ json: [{ id: "race", name: "Projection Preview", role: "viewer", state: "active" }] }));
  await page.route("**/rest/v1/rpc/viewer_status", route => route.fulfill({ json: { pods, beds, metrics: { census: 36, incoming: 2, seen: 48, discharged: 9, ems: 2, other: 1 } } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  const board = page.getByTestId("status-board");
  await expect(board).toBeVisible();
  await expect(board.locator("main > section").first()).toHaveCSS("background-color", "rgb(249, 115, 22)");
  await expect(board.locator("main > section").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(board.locator('main > section').nth(8)).toHaveCSS("background-color", "rgb(234, 179, 8)");
  await expect(board.getByText("Hidden complaint")).toHaveCount(0);
  for (const [width, height, name] of [[1920,1080,"desktop"], [375,812,"phone"]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => board.locator(".status-race-number").evaluateAll(elements =>
      elements.every(element => element.scrollWidth <= element.clientWidth+1))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/projection-${name}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
