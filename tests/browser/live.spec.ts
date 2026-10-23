import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("authenticated reading, bookmark, notes, settings and mobile", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(".data/test-session.json"),
    "Run with python3 -m tests.integration",
  );
  const session = JSON.parse(
    fs.readFileSync(".data/test-session.json", "utf8"),
  );
  await page.addInitScript(
    (s) =>
      localStorage.setItem(
        "sb-waeclwzbbcvcplallpvo-auth-token",
        JSON.stringify(s),
      ),
    session,
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "測試方向整合報告" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "多來源脈絡與比較" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /測試來源：新工具公布可驗證的更新/ }),
  ).toHaveAttribute("href", "https://example.com/test");
  await expect(page.getByRole("cell", { name: "仍待驗證" })).toBeVisible();
  await page
    .getByRole("button", { name: "延續追蹤：多來源脈絡與比較", exact: true })
    .click();
  await page.getByLabel("追蹤名稱", { exact: true }).fill("從摘要追蹤實際採用");
  await page
    .getByLabel("想持續關注的問題")
    .fill("後續是否有可驗證的實際採用案例？");
  await page.getByRole("button", { name: "開始追蹤", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: /延續追蹤/, exact: false })
    .filter({ hasText: "延續追蹤" })
    .first()
    .click();
  await page.getByRole("button", { name: /從摘要追蹤實際採用/ }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("後續是否有可驗證的實際採用案例？", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("追蹤狀態")).toHaveValue("active");
  await expect(page.getByLabel("我的筆記")).toHaveValue(
    /來自報告：測試方向整合報告[\s\S]*https:\/\/example.com\/test/,
  );
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.getByRole("button", { name: "◫ 閱讀", exact: true }).click();
  await page.getByLabel("搜尋方向與報告").fill("完全不存在的查詢文字");
  await expect(page.getByRole("article", { name: "方向分析報告" })).toHaveCount(
    0,
  );
  await page.getByLabel("搜尋方向與報告").fill("");
  await page.getByRole("button", { name: "來源資料", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "測試來源：新工具公布可驗證的更新" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收藏文章", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "測試來源：新工具公布可驗證的更新" })
    .click();
  await page.getByLabel("我的筆記").fill("這份筆記由瀏覽器儲存");
  await page.getByRole("button", { name: "儲存筆記" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "已儲存",
  );
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "來源資料", exact: true }).click();
  await page
    .getByRole("button", { name: "測試來源：新工具公布可驗證的更新" })
    .click();
  await expect(page.getByLabel("我的筆記")).toHaveValue("這份筆記由瀏覽器儲存");
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.screenshot({
    path: "test-results/reading-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /方向與來源/ }).click();
  await page.getByRole("button", { name: "新增" }).first().click();
  await page.getByLabel("名稱", { exact: true }).fill("非投資用途");
  await page.getByLabel("希望理解的問題與情境").fill("研究工具的實務應用");
  await page.getByRole("button", { name: "儲存設定" }).click();
  await expect(page.getByText("非投資用途", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /延續追蹤/ }).click();
  await page.getByRole("button", { name: /技術能否落地/ }).click();
  await page.getByLabel("追蹤狀態").selectOption("active");
  await expect(page.getByLabel("追蹤狀態")).toHaveValue("active");
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "◫ 閱讀", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "測試來源：新工具公布可驗證的更新" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "方向分析報告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "測試方向整合報告" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/reading-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
