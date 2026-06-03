import { test as base, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserContext, Page } from "@playwright/test";

import { createTestApp } from "../tools.ts";

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ headless, channel, launchOptions, permissions }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pw-push-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless,
      args: launchOptions?.args,
      permissions,
    });

    await use(context);

    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] || (await context.newPage());
    await use(page);
  },
});

let app: ReturnType<typeof createTestApp>["app"];
let port: number;

test.beforeAll(async () => {
  const testApp = createTestApp();
  app = testApp.app;

  await app.start();
  port = app.getPort();
});

test.afterAll(async () => {
  await app.stop();
});

test("Полный цикл push-уведомления: подписка → планирование → получение", async ({
  context,
  page,
}) => {
  // 1. Открываем страницу и ждём регистрации Service Worker
  const swPromise = context.waitForEvent("serviceworker");
  await page.goto(`http://localhost:${port}`);
  await swPromise;

  // 2. Ждём успешной push-подписки (FCM может отвечать медленно)
  await expect(page.locator("#status-subscription")).toContainText("✓", {
    timeout: 60000,
  });

  // 3. Заполняем форму: заголовок, текст, время — «сейчас»
  const title = "Тестовое уведомление";
  const body = "Привет из Playwright";
  const now = new Date();
  // datetime-local формат: YYYY-MM-DDTHH:mm
  const datetime =
    [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-") +
    "T" +
    [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join(":");

  await page.fill("#input-title", title);
  await page.fill("#input-body", body);
  await page.fill("#input-datetime", datetime);

  // 4. Нажимаем «Запланировать»
  await page.click("#btn-schedule");

  // 5. Проверяем что планирование успешно
  await expect(page.locator("#success-box")).toContainText("запланировано");

  // 6. Ждём получения push-уведомления (scheduler interval ~2с, FCM доставка ~5-10с)
  await expect(page.locator("#received-list")).toContainText(title, {
    timeout: 30000,
  });
});
