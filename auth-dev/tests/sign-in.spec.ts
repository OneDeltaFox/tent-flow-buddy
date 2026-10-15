import { expect, test } from "@playwright/test";

test("requests an existing-account link without allowing signup", async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    expect(route.request().url()).toContain("/otp");
    expect(route.request().postDataJSON()).toMatchObject({ email: "tester@example.com", create_user: false });
    await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("tester@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
});

test("failed request keeps the form available", async ({ page }) => {
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 429, json: { msg: "Rate limited" } }));
  await page.goto("/");
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
  await expect(page.getByText("tester@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Development Test Race", { exact: true })).toBeVisible();
  await expect(page.getByText("owner · active", { exact: true })).toBeVisible();
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
  await page.getByText("Race Settings", { exact: true }).click();
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
  await expect(page.getByText("2 pods added.", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ json: { pods: [], visits: [], placements: [], turnovers: [] } }));
  await page.getByRole("button", { name: "Refresh board" }).click();
  await expect(page.getByText("No pods have been added to this race.", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({ status: 403, json: { message: "Access denied" } }));
  await page.getByRole("button", { name: "Refresh board" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load patient records");
  await page.getByRole("button", { name: "Sign out" }).click();
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
  await page.route("**/rest/v1/rpc/race_layout", route => route.fulfill({ json: [
    { id: "pod", name: "Pod 1", color: "#ffcc00", kind: "regular", closed: false, capabilities: [],
      beds: [{ id: "bed", label: "1-1", status: "occupied" }] },
  ] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText("1/1 occupied", { exact: false })).toBeVisible();
  await expect(page.getByText("Race Settings", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Pod 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Patient" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/connected-board-phone.png", fullPage: true });
  await page.getByRole("button", { name: /^Pod 1 / }).click();
  await expect(page.getByRole("dialog")).toContainText("occupied");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => localStorage.getItem("tent-board-pods-v3"))).toBe("demo-sentinel");
});

test("fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/auth-phone.png" });
});

test("expired callback shows a recoverable error and clears the URL", async ({ page }) => {
  await page.goto("/#error=access_denied&error_code=otp_expired&error_description=Expired");
  await expect(page.getByRole("alert")).toContainText("Request a new link");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:8084/");
});
