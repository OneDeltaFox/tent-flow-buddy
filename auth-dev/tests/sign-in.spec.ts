import { expect, test } from "@playwright/test";

test("requests an existing-account link without allowing signup", async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    expect(route.request().url()).toContain("/otp");
    expect(route.request().postDataJSON()).toMatchObject({ email: "tester@example.com", create_user: false });
    await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email", { exact: true }).fill("tester@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
});

test("failed request keeps the form available", async ({ page }) => {
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 429, json: { msg: "Rate limited" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email", { exact: true }).fill("tester@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to send");
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled();
});

test("restores a session without granting race access and signs out", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({
    access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "test-user", email: "tester@example.com" },
  })));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 204 }));
  await page.route("**/rest/v1/rpc/my_races", (route) => route.fulfill({ json: [
    { id: "test-race", name: "Development Test Race", role: "owner", state: "active", timezone: "America/New_York" },
  ] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText("tester@example.com", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Development Test Race", { exact: true })).toBeVisible();
  await expect(page.getByText("owner", { exact: true })).toBeVisible();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ json: { visits: [], placements: [], turnovers: [], pods: [
    { id: "pod", name: "Pod 1", color: "#ffcc00", kind: "regular", closed: false, capabilities: ["Cooling"],
      beds: [{ id: "bed", label: "1-1", status: "cleaning" }] },
  ] } }));
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText("Pod 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Pod 1 / }).click();
  await expect(page.getByRole("button", { name: "1-1 ready" })).toBeVisible();
  await expect(page.getByText("Turnover", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByText("Menu", { exact: true }).click();
  await page.route("**/rest/v1/rpc/create_pods", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ p_race: "test-race", p_pods: [
      { name: "Pool 1", kind: "pool", beds: 1, capabilities: ["Cooling"] },
      { name: "Pool 2", kind: "pool", beds: 1, capabilities: ["Cooling"] },
    ] });
    await route.fulfill({ json: 2 });
  });
  await page.getByRole("button", { name: "Add pods", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add pods" })).toBeVisible();
  await page.getByLabel("Name prefix (optional)").fill("Pool");
  await page.getByLabel("Number of pods").fill("2");
  await page.getByLabel("Pod type").selectOption("pool");
  await expect(page.getByLabel("Beds per pod")).toHaveValue("1");
  await page.getByLabel("Capability", { exact: true }).fill("Cooling");
  await page.getByRole("button", { name: "Add capability", exact: true }).click();
  await page.getByRole("button", { name: "Create pods", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ json: { pods: [], visits: [], placements: [], turnovers: [] } }));
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Refresh board" }).click();
  await expect(page.getByText("No pods have been added to this race.", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ status: 403, json: { message: "Access denied" } }));
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Refresh board" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load patient records");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Development Test Race", { exact: true })).not.toBeVisible();
});

test("shared pod tiles are read-only and never load or overwrite demo data", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    localStorage.setItem("tent-flow-dev-auth", JSON.stringify({
      access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "test-user", email: "tester@example.com" },
    }));
    localStorage.setItem("tent-board-pods-v3", "demo-sentinel");
  });
  await page.route("**/rest/v1/rpc/my_races", route => route.fulfill({ json: [
    { id: "race", name: "Test Race", role: "viewer", state: "active" },
  ] }));
  await page.route("**/rest/v1/rpc/patient_board", () => { throw new Error("Viewer must never request patient records"); });
  await page.route("**/rest/v1/rpc/viewer_status", route => route.fulfill({ json: { pods: [
    { id: "pod", name: "Pod 1", color: "#ffcc00", kind: "regular", closed: false, capabilities: [],
      beds: [{ id: "bed", label: "1-1", status: "occupied" }] },
    { id: "ten", name: "Pod 10", color: "#ffcc00", kind: "regular", beds: [] },
    { id: "two", name: "Pod 2", color: "#ffcc00", kind: "regular", beds: [] },
  ], beds: [{ bed_id: "bed", bib: "VIEW-1", triage: "immediate", complaint: "Dizziness", medical_started_at: new Date(Date.now()-60000).toISOString(), pool_started_at: new Date(Date.now()-30000).toISOString() }],
  metrics: { census: 1, incoming: 2, seen: 7, discharged: 3, ems: 2, other: 1 } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByTestId("status-board")).toBeVisible();
  await expect(page.getByText("VIEW-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Dizziness", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("status-board")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByText(/^Pool 00:/)).toBeVisible();
  await expect(page.getByTestId("status-board").getByRole("heading", { level: 2 })).toHaveText(["Pod 1", "Pod 2", "Pod 10"]);
  await expect(page.getByText("EMS Transport", { exact: true })).toBeVisible();
  await expect(page.getByText("Menu", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Pod 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Patient" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/connected-board-phone.png", fullPage: true });
  const podRects = await page.getByTestId("status-board").locator("main > section").evaluateAll(elements => elements.map(element => {
    const { x, y, width } = element.getBoundingClientRect(); return { x, y, width };
  }));
  expect(podRects[0]!.y).toBe(podRects[1]!.y);
  expect(podRects[1]!.x).toBeGreaterThan(podRects[0]!.x);
  expect(podRects[2]!.y).toBeGreaterThan(podRects[0]!.y);
  expect(podRects[2]!.x).toBe(podRects[0]!.x);
  expect(podRects[2]!.width).toBeCloseTo(podRects[0]!.width, 0);
  await expect(page.getByRole("button", { name: /Edit patient/ })).toHaveCount(0);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: "test-results/viewer-status-desktop.png", fullPage: true });
  expect(await page.evaluate(() => localStorage.getItem("tent-board-pods-v3"))).toBe("demo-sentinel");
});

test("fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/auth-phone.png" });
});

test("expired callback shows a recoverable error and clears the URL", async ({ page }) => {
  await page.goto("/#error=access_denied&error_code=otp_expired&error_description=Expired");
  await expect(page.getByRole("alert")).toContainText("Request a new link");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:8084/");
});
