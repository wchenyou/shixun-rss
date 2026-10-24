import { test, expect } from "@playwright/test";
import fs from "node:fs";
const config = JSON.parse(fs.readFileSync("src/public-config.json", "utf8"));

test("anonymous reading, bookmark persistence and tracking", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.TEST_ALLOW_WRITES !== "1",
    "Opt in to reversible live workspace verification",
  );
  const headers = { apikey: config.supabasePublishableKey };
  const rest = config.supabaseUrl + "/rest/v1/";
  const title = "免登入驗證-" + crypto.randomUUID();
  const errors: string[] = [];
  const authCalls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/")) authCalls.push(r.url());
  });
  const sourceName = title + "-排程來源";
  let articleId: string | undefined;
  let originalSaved = false;
  try {
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "分析摘要卡片" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^閱讀報告：/ })
      .first()
      .click();
    await expect(
      page.getByRole("article", { name: "方向分析報告" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^延續追蹤：/ })
      .first()
      .click();
    await page.getByLabel("追蹤名稱", { exact: true }).fill(title);
    await page
      .getByLabel("想持續關注的問題")
      .fill(title + "：確認能保留原始引用");
    await page.getByRole("button", { name: "開始追蹤", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: /延續追蹤/ })
      .first()
      .click();
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByLabel("追蹤狀態")).toHaveValue("active");
    await expect(page.getByLabel("我的筆記")).toHaveValue(
      /來自報告：[\s\S]*原始摘要：[\s\S]*引用來源：/,
    );
    await page.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("button", { name: "◫ 閱讀", exact: true }).click();
    await page.getByLabel("閱讀內容").selectOption("sources");
    const articleResponse = await request.get(
      rest +
        "articles?select=id&title=eq." +
        encodeURIComponent(
          await page.locator(".article-title").first().innerText(),
        ),
      { headers },
    );
    articleId = (await articleResponse.json())[0].id;
    const stateResponse = await request.get(
      rest + "article_states?select=saved&article_id=eq." + articleId,
      { headers },
    );
    originalSaved = (await stateResponse.json())[0]?.saved || false;
    const bookmark = page
      .getByRole("button", {
        name: originalSaved ? "取消收藏" : "收藏文章",
        exact: true,
      })
      .first();
    // Resolve the displayed article explicitly; collection timestamps may tie.
    await bookmark.click();
    await expect(
      page
        .locator(".article")
        .first()
        .getByRole("button", {
          name: originalSaved ? "收藏文章" : "取消收藏",
          exact: true,
        }),
    ).toBeVisible();
    const changedResponse = await request.get(
      rest + "article_states?select=saved&article_id=eq." + articleId,
      { headers },
    );
    expect((await changedResponse.json())[0].saved).toBe(!originalSaved);
    await page.reload();
    await page
      .getByRole("button", { name: /^閱讀報告：/ })
      .first()
      .click();
    await expect(
      page.getByRole("article", { name: "方向分析報告" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.getByRole("button", { name: "回到頂端", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: "test-results/public-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: /方向與來源/ }).click();
    await page
      .locator(".settings-section")
      .filter({
        has: page.getByRole("heading", { name: "RSS 來源", exact: true }),
      })
      .getByRole("button", { name: /新增/ })
      .click();
    await page.getByLabel("名稱", { exact: true }).fill(sourceName);
    await page
      .getByLabel("RSS / Atom 網址")
      .fill("https://example.com/verification-feed");
    await page.getByLabel("每日觸發時間（台北）").fill("23:58");
    await page.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /方向與來源/ }).click();
    const sourceCard = page
      .locator(".setting-item")
      .filter({ hasText: sourceName });
    await expect(sourceCard).toContainText("每日 23:58");
    expect(errors).toEqual([]);
    expect(authCalls).toEqual([]);
  } finally {
    expect(
      (
        await request.delete(
          rest + "sources?name=eq." + encodeURIComponent(sourceName),
          { headers },
        )
      ).ok(),
    ).toBeTruthy();
    if (articleId)
      await request.post(rest + "rpc/set_article_state", {
        headers,
        data: { p_article_id: articleId, p_saved: originalSaved },
      });
    const response = await request.get(
      rest + "tracks?select=id&title=eq." + encodeURIComponent(title),
      { headers },
    );
    for (const track of await response.json()) {
      expect(
        (
          await request.delete(rest + "track_notes?track_id=eq." + track.id, {
            headers,
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await request.delete(rest + "tracks?id=eq." + track.id, { headers })
        ).ok(),
      ).toBeTruthy();
    }
  }
});
