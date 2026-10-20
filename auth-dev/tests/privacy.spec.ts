import { test, expect } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`public privacy page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy.html");
    await expect(page.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
    await expect(page.getByText("There is no automatic seven-day deletion job.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/privacy-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "TriageDesk", exact: true }).click();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy.html");
  });
}
