# CLAUDE.md

Этот файл содержит инструкции для Claude Code (claude.ai/code) при работе с данным репозиторием.

## Содержание

- [Задачи и планы](#задачи-и-планы)
- [Обзор проекта](#обзор-проекта)
- [Команды](#команды)
- [Архитектура](#архитектура)
- [Правила стиля кода](#правила-стиля-кода)
- [Тестирование](#тестирование)
- [Окружение](#окружение)

## Задачи и планы

Постановки задач и планы реализации хранятся в `agents/` в формате:
- `<название>.task.md` — постановка задачи (проблема, желаемое поведение, риски)
- `<название>.plan.md` — план реализации (шаги, файлы для изменения)

## Обзор проекта

Планировщик Web Push уведомлений на Node.js и Express. Принимает push-подписки с указанием времени отправки и содержимого, сохраняет их и отправляет уведомления в нужный момент через Web Push Protocol.

## Команды

```bash
npm run setup        # Установить зависимости и сгенерировать VAPID-ключи
npm run start        # Запустить production-сервер
npm run dev          # Запустить dev-сервер с watch-режимом
npm run test:jsonStore  # Запустить unit-тесты JSON-хранилища
npm run test:e2e     # Запустить end-to-end тесты
```

Запуск одного тестового файла:
```bash
node --test tests/jsonStore/store.test.ts
```

## Архитектура

Внедрение зависимостей через фабричные функции в `main.ts`:

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

**Основные модули:**
- `scheduler/` — опрашивает хранилище по таймеру, отправляет подошедшие уведомления через pusher
- `jsonStore/` — файловое хранилище уведомлений, реализует интерфейс `NotificationStore`
- `pusher/` — обёртка над библиотекой `web-push` для отправки уведомлений
- `router/` — Express-роуты: `POST /api/notifications`, `GET /api/key`, `GET /api/health`

**Поток данных:** Клиент → Router → Scheduler.schedule() → Store → (по таймеру) → Pusher → Push Service

## Правила стиля кода

**Без классов:** использовать фабричные функции (`createX(deps) => { ...methods }`), чистые функции, модули с именованными экспортами и замыкания.

**ESM-импорты:**
- Только относительные импорты (`./`, `../`) — никаких алиасов и path mapping
- Всегда указывать расширение файла (`.ts`)
- Порядок: сначала импорты библиотек, затем пустая строка, затем импорты проекта

**Только async:** использовать исключительно `node:fs/promises`. Никаких синхронных методов (`readFileSync`, `existsSync` и т.д.).

**Git-коммиты:** сообщения коммитов на русском языке, одно предложение, глагол в прошедшем времени от первого лица — описывает выполненное действие (например: «Добавил браузерный клиент для Web Push»).

## Тестирование

Тесты используют встроенный test runner Node.js (`node:test`) с `node:assert/strict`. Утилиты в `tests/tools.ts` предоставляют `createTestApp()` для e2e-тестов и `createFakeNotification()` для unit-тестов.

## Окружение

Требуется Node.js >= 22.6. Переменные окружения в `.env` (см. `.env.example`):
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — генерируются через `npm run setup`
- `VAPID_SUBJECT` — формат: `mailto:email` или `https://domain`
- `PORT` — порт сервера (по умолчанию: 3001)
