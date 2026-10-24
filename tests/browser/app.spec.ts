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

test("summary cards replace labels and open full reports with preserved search", async ({
  page,
}) => {
  const purpose = {
    id: "p1",
    name: "測試 AI 監控",
    enabled: true,
    version: 1,
    daily_time: "09:00",
  };
  const report = {
    purpose_id: "p1",
    title: "測試：工具更新的實際影響",
    overview: "先看關鍵變化與實務影響，完整證據留在詳情。",
    sections: [
      {
        heading: "實際影響",
        paragraphs: ["詳情段落：這是測試內容。"],
        bullets: [],
        tables: [],
        evidence_ids: ["a1"],
      },
    ],
    conclusion: "測試結論。",
    next_steps: [],
    limitations: [],
    evidence_ids: ["a1"],
  };
  const run = {
    id: "r2",
    published_at: "2026-10-24T01:00:00Z",
    data_cutoff: "2026-10-24T00:00:00Z",
    config_snapshot: { purposes: [purpose], purpose_reports: [report] },
  };
  const data: Record<string, unknown> = {
    workspace_access: { owner_id: "00000000-0000-0000-0000-000000000001" },
    purposes: [purpose, { ...purpose, id: "p2", name: "測試國際新聞" }],
    runs: [
      run,
      {
        ...run,
        id: "r1",
        published_at: "2026-10-23T01:00:00Z",
        config_snapshot: {
          purposes: [purpose],
          purpose_reports: [{ ...report, title: "測試：昨日報告" }],
        },
      },
      {
        ...run,
        id: "r3",
        config_snapshot: {
          purposes: [{ ...purpose, id: "p2", name: "測試國際新聞" }],
          purpose_reports: [
            { ...report, purpose_id: "p2", title: "測試：國際新聞脈絡" },
          ],
        },
      },
    ],
    articles: [
      {
        id: "a1",
        source_name: "測試來源",
        title: "測試原文",
        url: "https://example.com/test",
        content: "測試原文內容",
        collected_at: "2026-10-24T00:00:00Z",
        published_at: null,
      },
    ],
  };
  await page.route("**/rest/v1/**", (route) => {
    const table = new URL(route.request().url()).pathname.split("/").pop()!;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data[table] || []),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".report-card")).toHaveCount(2);
  await expect(page.getByRole("article", { name: "方向分析報告" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("YOUR DAILY SIGNAL", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "資料狀態" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "選擇報告方向" })).toHaveCount(
    0,
  );
  expect(
    await page
      .locator(".report-card")
      .first()
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeLessThan(450);
  await page.screenshot({
    path: "test-results/cards-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("搜尋方向與報告").fill("AI");
  await expect(page.locator(".report-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "閱讀報告：測試 AI 監控", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: report.title, exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("詳情段落：這是測試內容。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "測試原文 ↗" })).toHaveAttribute(
    "href",
    "https://example.com/test",
  );
  await expect(page.getByLabel("報告版本").locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "← 返回摘要", exact: true }).click();
  await expect(page.getByLabel("搜尋方向與報告")).toHaveValue("AI");
  await expect(
    page.getByRole("button", { name: "閱讀報告：測試 AI 監控", exact: true }),
  ).toBeFocused();
  await page.getByLabel("搜尋方向與報告").fill("沒有符合的內容");
  await expect(page.locator(".report-card")).toHaveCount(0);
  await expect(
    page.getByText("沒有符合的摘要。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: /方向與來源/ }).click();
  await expect(
    page.getByText("為你的好奇，設定方向。", { exact: true }),
  ).toHaveCount(0);
});
