import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTestApp, createTestNotification } from "../tools.ts";

describe("Приложенька, App", () => {
  describe("Запрос GET VAPID ключ", () => {
    it("Отрабатывает норм", async () => {
      // Arrange
      const { app, vapidKeys } = createTestApp();

      // Act
      await app.start();

      const port = app.getPort();
      const response = await fetch(`http://localhost:${port}/api/key`, {
        signal: AbortSignal.timeout(5000),
      });
      const vapidKey = await response.text();

      // Assert
      assert.equal(response.status, 200);
      assert.equal(vapidKey, vapidKeys.publicKey);

      // Clean
      await app.stop();
    });
  });

  describe("Запрос POST уведомление", () => {
    it("Создает уведомление с валидными данными", async () => {
      // Arrange
      const { app } = createTestApp();
      const notification = createTestNotification();

      // Act
      await app.start();

      const port = app.getPort();
      const response = await fetch(
        `http://localhost:${port}/api/notifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notification),
          signal: AbortSignal.timeout(5000),
        }
      );

      // Assert
      assert.equal(response.status, 201);

      // Clean
      await app.stop();
    });

    it("Возвращает 400 при пустом теле", async () => {
      // Arrange
      const { app } = createTestApp();

      // Act
      await app.start();

      const port = app.getPort();
      const response = await fetch(
        `http://localhost:${port}/api/notifications`,
        {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        }
      );
      const responseText = await response.text();

      // Assert
      assert.equal(response.status, 400);
      assert.equal(responseText, "Body is required");

      // Clean
      await app.stop();
    });
  });
});
