import { test, expect } from "@playwright/test";

test("opens without authentication on desktop and mobile", async ({ page }) => {
  const authCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/")) authCalls.push(r.url());
  });
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: route.request().url().includes("/workspace_access")
        ? JSON.stringify({ owner_id: "00000000-0000-0000-0000-000000000001" })
        : "[]",
    }),
  );
  await page.goto("/");
  await expect(page.getByText("直接進入 · 免登入")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "方向分析報告準備中" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(authCalls).toEqual([]);
});

test("workspace load errors can be retried without login", async ({ page }) => {
  let failed = true;
  await page.route("**/rest/v1/**", (route) => {
    if (failed) return route.fulfill({ status: 403, body: "unavailable" });
    return route.fulfill({
      contentType: "application/json",
      body: route.request().url().includes("/workspace_access")
        ? JSON.stringify({ owner_id: "00000000-0000-0000-0000-000000000001" })
        : "[]",
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("無法讀取閱讀空間");
  failed = false;
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "方向分析報告準備中" }),
  ).toBeVisible();
});
