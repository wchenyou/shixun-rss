import { test, expect } from "@playwright/test";
test("private login renders on desktop and mobile without overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "歡迎回到拾訊" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "寄送登入連結 →" }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "歡迎回到拾訊" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

for (const scenario of [
  {
    code: "signup_disabled",
    status: 422,
    message: "Signups not allowed for this instance",
    expected: "此信箱尚未啟用",
  },
  {
    code: "over_email_send_rate_limit",
    status: 429,
    message: "email rate limit exceeded",
    expected: "登入信寄送次數已達上限",
  },
  { code: "", status: 200, message: "", expected: "登入信寄送請求已受理" },
]) {
  test(`login explains ${scenario.code || "successful delivery request"}`, async ({
    page,
  }) => {
    await page.route("**/auth/v1/otp**", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.email).toBe("wchenyou@gmail.com");
      expect(body.create_user).toBe(false);
      await route.fulfill({
        status: scenario.status,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(
          scenario.code ? { code: scenario.code, msg: scenario.message } : {},
        ),
      });
    });
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill("wchenyou@gmail.com");
    await page.getByRole("button", { name: "寄送登入連結 →" }).click();
    await expect(page.getByRole("status")).toContainText(scenario.expected);
    await expect(
      page.getByRole("button", { name: "寄送登入連結 →" }),
    ).toBeEnabled();
  });
}

test("login recovers from a connection timeout", async ({ page }) => {
  await page.route("**/auth/v1/otp**", () => {});
  await page.goto("/");
  await page.clock.install();
  await page.getByLabel("Email", { exact: true }).fill("wchenyou@gmail.com");
  await page.getByRole("button", { name: "寄送登入連結 →" }).click();
  await expect(page.getByRole("button", { name: "寄送中…" })).toBeDisabled();
  await page.clock.fastForward(21000);
  await expect(page.getByRole("status")).toContainText("連線未完成");
  await expect(
    page.getByRole("button", { name: "寄送登入連結 →" }),
  ).toBeEnabled();
});
