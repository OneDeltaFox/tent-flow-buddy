import { test, expect } from "@playwright/test";

for (const width of [390, 1280]) test(`Report-free reset and next day at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token: "token", refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "owner" } })));
  await page.route("**/rest/v1/rpc/my_race_invitations", r => r.fulfill({ json: [] }));
  await page.route("**/rest/v1/rpc/my_races", r => r.fulfill({ json: [{ id: "race", name: "Fictional Reset Test", role: "owner", state: "active" }] }));
  await page.route("**/rest/v1/rpc/patient_board", r => r.fulfill({ json: { pods: [], visits: [], placements: [], turnovers: [] } }));
  let ended = false, writes = 0, starts = 0;
  const reporting: string[] = [];
  page.on("request", request => { if (/race_daily_reports|send-race-report/.test(request.url())) reporting.push(request.url()); });
  await page.route("**/rest/v1/rpc/end_race_preview", r => r.fulfill({ json: { report_free: true, token: "preview", generation: 0, total: 3, active: 1, state: ended ? "closed" : "active", last_reset_id: ended ? "receipt" : null } }));
  await page.route("**/rest/v1/rpc/end_race", async r => {
    expect(r.request().postDataJSON()).toMatchObject({ p_confirm: "END RACE", p_allow_active: true, p_token: "preview", p_generation: 0 });
    writes++; ended = true; await r.fulfill({ json: "receipt" });
  });
  await page.route("**/rest/v1/rpc/start_next_race_day", async r => {
    expect(r.request().postDataJSON()).toEqual({ p_race: "race", p_report: "receipt" });
    starts++; await r.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  await page.getByRole("button", { name: "End Race", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const end = dialog.getByRole("button", { name: "End Race and Delete Patient Data" });
  await expect(end).toBeDisabled();
  await dialog.getByLabel("Type END RACE to confirm").fill("END RACE");
  await expect(end).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(end).toBeEnabled();
  await expect(dialog.getByRole("button", { name: /Email Report/ })).toHaveCount(0);
  await page.screenshot({ path: `test-results/report-free-reset-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await end.click();
  await expect(dialog.getByRole("status")).toContainText("Patient data cleared");
  expect(writes).toBe(1);
  await dialog.getByRole("button", { name: "Start Next Day With This Layout" }).click();
  expect(starts).toBe(1);
  expect(reporting).toEqual([]);
});
