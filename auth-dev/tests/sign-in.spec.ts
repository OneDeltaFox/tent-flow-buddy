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
  await page.route("**/rest/v1/rpc/race_layout", route => route.fulfill({ json: [
    { id: "pod", name: "Pod 1", color: "#ffcc00", kind: "regular", closed: false, capabilities: ["Cooling"],
      beds: [{ id: "bed", label: "1-1", status: "cleaning" }] },
  ] }));
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText("Pod 1", { exact: true })).toBeVisible();
  await expect(page.getByText("1-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Turnover", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/race_layout", route => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Refresh layout" }).click();
  await expect(page.getByRole("status")).toHaveText("No pods have been added to this race.");
  await page.route("**/rest/v1/rpc/race_layout", route => route.fulfill({ status: 403, json: { message: "Access denied" } }));
  await page.getByRole("button", { name: "Refresh layout" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load this race");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Development Test Race", { exact: true })).not.toBeVisible();
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
