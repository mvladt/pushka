import express from "express";
import cors from "cors";
import type { Router, Express } from "express";
import type { Server } from "http";

import type { NotificationScheduler } from "./scheduler/types.ts";
import type { Logger } from "./logger/types.ts";

export const createApp = (
  port: number,
  router: Router,
  notificationScheduler: NotificationScheduler,
  logger: Logger,
  pathToClient: string,
) => {
  let server: Server;

  const app: Express = express();

  app.use(cors());
  app.use(express.json());

  // Статика должна идти до роутера.
  app.use(express.static(pathToClient));

  app.use(router);

  return {
    async start() {
      return new Promise<void>((resolve) => {
        server = app.listen(port, "127.0.0.1", () => {
          logger.log(`Server started on port ${port}.`);
          notificationScheduler.run();
          logger.log(`App started.`);
          resolve();
        });
      });
    },
    async stop() {
      if (!server) {
        throw new Error("Server is not running.");
      }

      return new Promise<void>((resolve) => {
        server.close(() => {
          notificationScheduler.stop();
          logger.log("App stopped.");
          logger.log("\n");
          resolve();
        });
      });
    },

    getPort() {
      if (!server) {
        throw new Error("Server is not running.");
      }

      return (server.address() as any).port;
    },

    // TODO: Нарушение инкапсуляции.
    express: app,
  };
};
