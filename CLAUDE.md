# CLAUDE.md

## Задачи и планы

В `agents/`:
- `<название>.task.md` — проблема, желаемое поведение, риски
- `<название>.plan.md` — шаги реализации, файлы для изменения
- `done/` — завершённые задачи и планы

## Обзор проекта

Планировщик Web Push уведомлений на Node.js и Express. Принимает push-подписки с временем отправки, сохраняет и отправляет через Web Push Protocol.

## Команды

```bash
npm run start           # production-сервер
npm run dev             # dev-сервер с watch-режимом
npm run test:jsonStore  # unit-тесты JSON-хранилища
npm run test:integration # интеграционные тесты
```

## Архитектура

```
main.ts → createApp(port, router, scheduler, logger)
            ├── createRouter(scheduler, pusher, logger)
            │     ├── createNotificationRouter
            │     └── createVapidKeyRouter
            ├── createNotificationScheduler(store, pusher, logger)
            ├── createJsonStore(filename)
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
