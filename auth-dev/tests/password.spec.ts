import { test, expect } from "@playwright/test";

test("password login and email fallback remain separate", async ({ page }) => {
  await page.route("https://authtest.supabase.co/**", async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Invalid login credentials" }) });
  });
  await page.goto("/");
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to sign in");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("button", { name: "Send sign-in link", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("button", { name: "Send password reset link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
