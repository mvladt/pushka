import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFakeNotification } from "../tools.ts";
import { createSqliteStore } from "../../src/sqliteStore/store.ts";

// Каждый стор на ":memory:" — отдельное соединение, поэтому тесты изолированы
// и не оставляют файлов на диске.

describe("sqliteStore", () => {
  describe("saveOne", () => {
    it("Базово сохраняет уведомление.", async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const notification = createFakeNotification();

      // Act
      await store.saveOne(notification);

      // Assert
      const stored = await store.getOneById(notification.id);
      assert.ok(stored);
    });

    it("Не сохраняет уведомление с пустой датой.", async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const incorrectDatetime = "";
      const notification = createFakeNotification(incorrectDatetime);

      // Act
      // Assert
      await assert.rejects(async () => {
        await store.saveOne(notification);
      });
    });

    it("Не сохраняет уведомление с некорректной датой.", async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const incorrectDatetime = "itsNotDate";
      const notification = createFakeNotification(incorrectDatetime);

      // Act
      // Assert
      await assert.rejects(async () => {
        await store.saveOne(notification);
      });
    });

    it("Сохраняет payload и subscription без потери данных.", async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const notification = createFakeNotification();
      notification.payload = { title: "Привет", body: "Тело" };
      notification.subscription = { endpoint: "https://example.com/x" };

      // Act
      await store.saveOne(notification);

      // Assert
      const stored = await store.getOneById(notification.id);
      assert.deepEqual(stored.payload, notification.payload);
      assert.deepEqual(stored.subscription, notification.subscription);
    });
  });

  it("removeOne", async () => {
    // Arrange
    const store = createSqliteStore(":memory:");
    const notification = createFakeNotification();
    await store.saveOne(notification);

    // Act
    await store.removeOne(notification);

    // Assert
    const nothing = await store.getOneById(notification.id);
    assert.equal(nothing, undefined);
  });

  it("removeMany", async () => {
    // Arrange
    const store = createSqliteStore(":memory:");
    const notification1 = createFakeNotification();
    const notification2 = createFakeNotification();
    await store.saveOne(notification1);
    await store.saveOne(notification2);

    // Act
    await store.removeMany([notification1, notification2]);

    // Assert
    const nothing1 = await store.getOneById(notification1.id);
    const nothing2 = await store.getOneById(notification2.id);
    assert.equal(nothing1, undefined);
    assert.equal(nothing2, undefined);
  });

  describe("getAllForNow", () => {
    it('Выдает уведомление с датой "сейчас плюс 1 мин."', async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const oneMinuteForward = new Date(Date.now() + 1000 * 60).toISOString();
      const notification = createFakeNotification();
      const notificationForNow = createFakeNotification(oneMinuteForward);
      await store.saveOne(notification);
      await store.saveOne(notificationForNow);

      // Act
      const notificationsForNow = await store.getAllForNow();

      // Assert
      assert.equal(notificationsForNow.length, 1);
      assert.equal(notificationsForNow[0].id, notificationForNow.id);
    });

    it("Не выдает уведомление из далёкого будущего.", async () => {
      // Arrange
      const store = createSqliteStore(":memory:");
      const farFuture = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // +1 час
      await store.saveOne(createFakeNotification(farFuture));

      // Act
      const notificationsForNow = await store.getAllForNow();

      // Assert
      assert.equal(notificationsForNow.length, 0);
    });
  });
});
