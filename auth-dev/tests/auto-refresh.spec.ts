import { test, expect } from "@playwright/test";

test("automatic updates pause for edits and recover after read failures", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token: "token", refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "user" } })));
  const snapshot: any = { pods: [], visits: [], placements: [], turnovers: [] };
  let failed = false;
  let reads = 0;
  await page.route("**/rest/v1/rpc/my_races", route => route.fulfill({ json: [{ id: "race", name: "Sync Test", role: "owner", state: "active" }] }));
  await page.route("**/rest/v1/rpc/patient_board", route => {
    reads++;
    return failed ? route.fulfill({ status: 503, json: { message: "Unavailable" } }) : route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText(/Auto-update on/)).toBeVisible();
  snapshot.visits.push({ id: "visit", revision: 1, bib: "SYNC-1", triage: "untriaged", complaint: "Dizziness", notes: "Original", source: "", eta: "", medical_started_at: null, dispositioned_at: null });
  await expect(page.getByRole("button", { name: /Incoming \(1\)/ })).toBeVisible({ timeout: 12000 });
  await page.getByRole("button", { name: /Incoming \(1\)/ }).click();
  await page.getByRole("button", { name: "Edit patient SYNC-1", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Notes", { exact: true }).fill("Local draft");
  snapshot.visits[0].revision = 2;
  snapshot.visits[0].notes = "Remote edit";
  const before = reads;
  await page.waitForTimeout(5500);
  expect(reads).toBe(before);
  await expect(modal.getByLabel("Notes", { exact: true })).toHaveValue("Local draft");
  await page.route("**/rest/v1/rpc/save_patient", async route => {
    expect(route.request().postDataJSON().p_revision).toBe(1);
    await route.fulfill({ status: 409, json: { message: "Stale revision" } });
  });
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal.getByText(/Save not confirmed/)).toBeVisible();
  // Reload discards the test draft and exercises automatic retry independently.
  await page.reload();
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText(/Auto-update on/)).toBeVisible();
  failed = true;
  await expect(page.getByText(/Updates interrupted/)).toBeVisible({ timeout: 12000 });
  failed = false;
  await expect(page.getByText(/Auto-update on/)).toBeVisible({ timeout: 12000 });
  await page.screenshot({ path: "test-results/automatic-updates.png", fullPage: true });
});
