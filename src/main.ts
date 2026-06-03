import { fileURLToPath } from "node:url";

import { loadEnv } from "./env.ts";
import { createRouter } from "./router/router.ts";
import { createNotificationScheduler } from "./scheduler/scheduler.ts";
import { createSqliteStore } from "./sqliteStore/store.ts";
import { createWebPusher } from "./pusher/pusher.ts";
import { createApp } from "./app.ts";
import { createConsoleLogger } from "./logger/logger.ts";

const { port, vapidSubject, vapidPublicKey, vapidPrivateKey } = await loadEnv();

const logger = createConsoleLogger();

const store = createSqliteStore("notifications.db");

const pusher = createWebPusher(
  {
    vapidDetails: {
      subject: vapidSubject,
      privateKey: vapidPrivateKey,
      publicKey: vapidPublicKey,
    },
  },
  logger
);

const scheduler = createNotificationScheduler(store, pusher, logger, {
  intervalMs: 2000,
});

const router = createRouter(scheduler, pusher, logger);

const pathToClient = fileURLToPath(new URL("./client", import.meta.url));

const app = createApp(port, router, scheduler, logger, pathToClient);

await app.start();

process.on("SIGINT", () => app.stop().then(() => process.exit(0)));
process.on("SIGTERM", () => app.stop().then(() => process.exit(0)));
