import type { NotificationEntity, NotificationStore } from "../types.ts";
import type { WebPusher } from "../pusher/types.ts";
import type {
  NotificationScheduler,
  SchedulerOptions,
  SchedulerState,
} from "./types.ts";
import type { Logger } from "../logger/types.ts";

// Максимальное "терпимое" опоздание: наступившие уведомления отправляем,
// только если просрочка не больше этого порога. Сильно просроченные
// (например, накопившиеся за время простоя сервера) тихо отбрасываем —
// доставлять их с опозданием в часы бессмысленно.
const GRACE_MS = 5 * 60 * 1000;

// TODO: Вынести логгер в зависимость.
// TODO: Добавить какую-то валидацию. В частности на 'schedule' и 'cancel'.
export const createNotificationScheduler = (
  store: NotificationStore,
  pusher: WebPusher,
  logger: Logger,
  options: SchedulerOptions = { intervalMs: 1000 }
): NotificationScheduler => {
  const { intervalMs } = options;

  const state: SchedulerState = {
    isRunning: false,
  };

  /**
   * Единица работы, выполняемая за проход цикла планировщика.
   */
  const work = async (): Promise<void> => {
    const due = await store.getAllForNow();

    // Отправляем только не сильно просроченные; протухшие тихо отбрасываем
    // (они всё равно удаляются ниже, чтобы не копиться в хранилище).
    const now = Date.now();
    const fresh = due.filter(
      (n) => now - new Date(n.datetime).getTime() <= GRACE_MS
    );

    // В этом месте может быть проблема, если операции не выполнятся до следующего запуска work(), через intervalMs.
    await pusher.sendMany(fresh);
    await store.removeMany(due);

    logger.log(`Scheduler work. Time: ${new Date().toLocaleTimeString()}`);
  };

  const scheduler: NotificationScheduler = {
    async schedule(notification: NotificationEntity): Promise<void> {
      await store.saveOne(notification);
      logger.log("Notification is scheduled.");
    },

    async cancel(notification: NotificationEntity): Promise<void> {
      await store.removeOne(notification);
      logger.log("Notification is canceled.");
    },

    run() {
      if (state.isRunning) throw new Error("Scheduler is already running.");
      state.isRunning = true;
      state.timeoutId = setInterval(work, intervalMs);
      logger.log(`Scheduler is running with interval ${intervalMs}ms.`);
    },

    stop() {
      if (!state.isRunning) throw new Error("Scheduler is not running.");
      clearInterval(state.timeoutId);
      state.isRunning = false;
      logger.log("Scheduler is stopping.");
    },
  };

  return scheduler;
};
