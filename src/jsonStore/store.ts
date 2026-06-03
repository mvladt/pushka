import jsonStoreTools from "./tools.ts";
import { validateDatetime } from "../validateDatetime.ts";
import type { NotificationEntity, NotificationStore } from "../types.ts";

// TODO: Написать тесты на 'getOneById'.

export const createJsonStore = (
  file: string = "data.json"
): NotificationStore => {
  const store: NotificationStore = {
    async saveOne(notification) {
      validateDatetime(notification.datetime);

      const oldArray = await jsonStoreTools.readStoreFile(file);
      const newArray = [...oldArray, notification];
      await jsonStoreTools.writeStoreFile(file, newArray);
    },
    async removeOne(notification) {
      const oldArray = await jsonStoreTools.readStoreFile(file);
      const newArray = oldArray.filter((n) => n.id !== notification.id);
      await jsonStoreTools.writeStoreFile(file, newArray);
    },
    async removeMany(notifications) {
      const oldArray = await jsonStoreTools.readStoreFile(file);
      const newArray = oldArray.filter(
        (n1) => !notifications.find((n2) => n1.id === n2.id)
      );
      await jsonStoreTools.writeStoreFile(file, newArray);
    },
    async getOneById(notificationId) {
      const oldArray = (await jsonStoreTools.readStoreFile(
        file
      )) as NotificationEntity[];
      const result = oldArray.find((n) => n.id === notificationId);
      return result;
    },
    async getAllForNow() {
      const oldArray = await jsonStoreTools.readStoreFile(file);
      const result = oldArray.filter(isNotificationForNow);
      return result;
    },
  };

  return store;
};

/**
 * Проверка, соответствует ли дата уведомления промежутку от "сейчас" до "сейчас" + 2 минуты.
 */
function isNotificationForNow(notification: NotificationEntity): boolean {
  const notificationDate = new Date(notification.datetime);
  const currentDate = new Date();

  const isDatesMatch =
    notificationDate.toISOString().split("T")[0] ===
    currentDate.toISOString().split("T")[0];
  const isTimeMatch =
    notificationDate.getHours() === currentDate.getHours() &&
    notificationDate.getMinutes() - currentDate.getMinutes() <= 2;

  const result = isDatesMatch && isTimeMatch;
  return result;
}
