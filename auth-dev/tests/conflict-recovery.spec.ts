import { test, expect } from "@playwright/test";

test("two browsers preserve the first save and reject a stale edit", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const visit = { id: "visit", revision: 1, bib: "CONFLICT-1", triage: "untriaged", complaint: "Dizziness", notes: "Original", source: "", eta: "", medical_started_at: null, dispositioned_at: null };
  const revisions: number[] = [];
  try {
    const pages = [];
    for (const context of contexts) {
      await context.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token: "token", refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "user" } })));
      await context.route("**/rest/v1/rpc/my_races", route => route.fulfill({ json: [{ id: "race", name: "Conflict Test", role: "owner", state: "active" }] }));
      await context.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ json: { pods: [], visits: [visit], placements: [], turnovers: [] } }));
      await context.route("**/rest/v1/rpc/save_patient", async route => {
        const body = route.request().postDataJSON();
        revisions.push(body.p_revision);
        if (body.p_revision !== visit.revision) return route.fulfill({ status: 409, json: { message: "Stale revision" } });
        visit.notes = body.p_details.notes;
        visit.revision++;
        await route.fulfill({ json: visit.id });
      });
      const page = await context.newPage();
      pages.push(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Open board" }).click();
      await page.getByRole("button", { name: /Incoming \(1\)/ }).click();
      await page.getByRole("button", { name: "Edit patient CONFLICT-1", exact: true }).click();
    }
    if (!pages[0] || !pages[1]) throw new Error("Both test browsers must be open");
    await pages[0].getByRole("dialog").getByLabel("Notes", { exact: true }).fill("First browser saved");
    await pages[1].getByRole("dialog").getByLabel("Notes", { exact: true }).fill("Second browser draft");
    await pages[0].getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(pages[0].getByRole("dialog")).toHaveCount(0);
    await pages[1].getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(pages[1].getByText(/Save not confirmed/)).toBeVisible();
    expect(visit.notes).toBe("First browser saved");
    expect(revisions).toEqual([1, 1]);
    await expect(pages[1].getByRole("dialog").getByLabel("Notes", { exact: true })).toHaveValue("Second browser draft");
    await pages[1].reload();
    await pages[1].getByRole("button", { name: "Open board" }).click();
    await pages[1].getByRole("button", { name: /Incoming \(1\)/ }).click();
    await pages[1].getByRole("button", { name: "Edit patient CONFLICT-1", exact: true }).click();
    await expect(pages[1].getByRole("dialog").getByLabel("Notes", { exact: true })).toHaveValue("First browser saved");
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test("offline board blocks interaction and recovers without replaying writes", async ({ page, context }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token: "token", refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "user" } })));
  let disconnected = false;
  let writes = 0;
  await page.route("**/rest/v1/rpc/**", route => {
    const endpoint = route.request().url().split("/").pop();
    if (endpoint === "my_races") return route.fulfill({ json: [{ id: "race", name: "Offline Test", role: "owner", state: "active" }] });
    if (endpoint === "patient_board") return disconnected ? route.abort("internetdisconnected") : route.fulfill({ json: { pods: [], visits: [], placements: [], turnovers: [] } });
    writes++;
    return route.abort("internetdisconnected");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText(/Auto-update on/)).toBeVisible();
  disconnected = true;
  await context.setOffline(true);
  await expect(page.getByText(/Updates interrupted/)).toBeVisible({ timeout: 20000 });
  expect(await page.getByRole("button", { name: "New Patient", exact: true }).evaluate(el => Boolean(el.closest("[inert]")))).toBe(true);
  disconnected = false;
  await context.setOffline(false);
  await expect(page.getByText(/Auto-update on/)).toBeVisible({ timeout: 12000 });
  await page.getByRole("button", { name: "New Patient", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(writes).toBe(0);
});
