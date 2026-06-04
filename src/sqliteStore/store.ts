import Database from "better-sqlite3";

import { validateDatetime } from "../validateDatetime.ts";
import type { NotificationEntity, NotificationStore } from "../types.ts";

type Row = {
  id: string;
  payload: string; // JSON
  datetime: string; // Канонический UTC-ISO.
  subscription: string; // JSON
};

export const createSqliteStore = (
  filename: string = "notifications.db"
): NotificationStore => {
  const db = new Database(filename);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      datetime TEXT NOT NULL,
      subscription TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_datetime
      ON notifications(datetime);
  `);

  const insertOne = db.prepare(
    `INSERT OR REPLACE INTO notifications (id, payload, datetime, subscription)
     VALUES (@id, @payload, @datetime, @subscription)`
  );
  const deleteOne = db.prepare(`DELETE FROM notifications WHERE id = ?`);
  const selectOne = db.prepare(`SELECT * FROM notifications WHERE id = ?`);
  const selectDue = db.prepare(
    `SELECT * FROM notifications WHERE datetime <= ?`
  );

  const deleteMany = db.transaction((ids: string[]) => {
    for (const id of ids) deleteOne.run(id);
  });

  const rowToEntity = (row: Row): NotificationEntity => ({
    id: row.id,
    payload: JSON.parse(row.payload),
    datetime: row.datetime,
    subscription: JSON.parse(row.subscription),
  });

  const store: NotificationStore = {
    async saveOne(notification) {
      validateDatetime(notification.datetime);
      insertOne.run({
        id: notification.id,
        payload: JSON.stringify(notification.payload),
        // Нормализуем в канонический UTC-ISO, чтобы лексикографическое
        // сравнение в SQL совпадало с хронологическим.
        datetime: new Date(notification.datetime).toISOString(),
        subscription: JSON.stringify(notification.subscription),
      });
    },
    async removeOne(notification) {
      deleteOne.run(notification.id);
    },
    async removeMany(notifications) {
      deleteMany(notifications.map((n) => n.id));
    },
    async getOneById(notificationId) {
      const row = selectOne.get(notificationId) as Row | undefined;
      return row ? rowToEntity(row) : (undefined as unknown as NotificationEntity);
    },
    async getAllForNow() {
      // Все уведомления, чьё время уже наступило (datetime <= now).
      // Решение об отправке/отбрасывании просроченных принимает планировщик.
      const now = new Date().toISOString();
      const rows = selectDue.all(now) as Row[];
      return rows.map(rowToEntity);
    },
  };

  return store;
};
