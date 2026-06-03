import { fileURLToPath } from "node:url";

import webpush from "web-push";

import { createApp } from "../src/app.ts";
import { createRouter } from "../src/router/router.ts";
import { createNotificationScheduler } from "../src/scheduler/scheduler.ts";
import { createSqliteStore } from "../src/sqliteStore/store.ts";
import { createWebPusher } from "../src/pusher/pusher.ts";

import type { NotificationEntity } from "../src/types.ts";
import type { Logger } from "../src/logger/types.ts";

export const createFakeNotification = (
  datetime: string = "2025-01-01T00:00",
): NotificationEntity => {
  return {
    id: dumbUUID(),
    datetime,
    payload: {},
    subscription: {},
  };
};

export const createTestNotification = (
  datetime?: string,
): NotificationEntity => {
  return {
    id: dumbUUID(),
    payload: { title: "Test Notification", body: "Hello from test!" },
    datetime: datetime || new Date(Date.now() + 60000).toISOString(), // +1 min
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: {
        p256dh: "test-p256dh-key",
        auth: "test-auth-key",
      },
    },
  };
};

export const dumbUUID = (): string =>
  `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

export const createTestApp = () => {
  const vapidKeys = webpush.generateVAPIDKeys();

  const testLogger: Logger = {
    log: () => {},
    error: () => {},
  };

  // In-memory БД: изолирована на каждый тест, не оставляет файлов.
  const store = createSqliteStore(":memory:");
  const pusher = createWebPusher(
    {
      vapidDetails: {
        subject: "mailto:test@example.com",
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey,
      },
    },
    testLogger,
  );
  const scheduler = createNotificationScheduler(store, pusher, testLogger, {
    intervalMs: 2000,
  });
  const router = createRouter(scheduler, pusher, testLogger);

  const pathToClient = fileURLToPath(new URL("../src/client", import.meta.url));
  const app = createApp(0, router, scheduler, testLogger, pathToClient);

  return { app, vapidKeys };
};
