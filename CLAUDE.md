# CLAUDE.md

## Задачи и планы

В `docs/`:
- `<название>.task.md` — проблема, желаемое поведение, риски
- `<название>.plan.md` — шаги реализации, файлы для изменения
- `archive/` — завершённые задачи и планы

## Обзор проекта

Планировщик Web Push уведомлений на Node.js и Express. Принимает push-подписки с временем отправки, сохраняет и отправляет через Web Push Protocol.

## Команды

```bash
npm run start            # production-сервер
npm run dev              # dev-сервер с watch-режимом
npm run test:env         # unit-тесты загрузки .env
npm run test:sqliteStore # unit-тесты SQLite-хранилища
npm run test:integration # интеграционные тесты
npm run test:playwright  # e2e-тесты (Playwright)
```

## Архитектура

```
main.ts → createApp(port, router, scheduler, logger)
            ├── createRouter(scheduler, pusher, logger)
            │     ├── createNotificationRouter
            │     └── createVapidKeyRouter
            ├── createNotificationScheduler(store, pusher, logger)
            ├── createSqliteStore(filename)
            ├── createWebPusher(vapidConfig, logger)
            └── createConsoleLogger()
```

Поток данных: Клиент → Router → Scheduler.schedule() → Store → (по таймеру) → Pusher → Push Service

## Стиль кода

- **Без классов:** фабричные функции `createX(deps)`, замыкания, именованные экспорты
- **ESM-импорты:** только относительные с расширением `.ts`; сначала библиотеки, затем проект
- **Только async:** `node:fs/promises`, никаких синхронных методов

## Тестирование

`node:test` + `node:assert/strict`. Утилиты в `tests/tools.ts`: `createTestApp()` для e2e, `createFakeNotification()` для unit.

## Окружение

Node.js >= 22.6. При первом запуске `.env` создаётся автоматически с новыми VAPID-ключами. Для кастомных значений (`VAPID_SUBJECT`, `PORT`) — отредактировать `.env` после первого запуска.
