# Результат: CI/CD через GitHub Actions

Внедряется поэтапно по `cicd.plan.md`. Здесь фиксируется фактически сделанное.

## Этап 1. CI: тесты и typecheck — ✅ выполнено

### Что сделано

- **Создан `.github/workflows/ci.yml`** с двумя job'ами:
  - `test`: checkout → setup-node (22) → `npm ci` → `tsc` → тесты `env`/`sqliteStore`/`integration` → `npm audit --audit-level=high`.
  - `e2e`: checkout → setup-node → `npm ci` → `playwright install --with-deps chrome` → `npm run test:playwright`, с загрузкой артефактов (`test-results/`, `playwright-report/`) при падении.
  - Триггеры: `push` (все ветки) + `pull_request` в `main`.
  - `concurrency: ci-${{ github.ref }}` с `cancel-in-progress` — отмена устаревших запусков.
  - `permissions: contents: read` по умолчанию.
- **Поправлен `playwright.config.ts`** — режим браузера завязан на `process.env.CI`
  (GitHub Actions выставляет `CI=true` сам):
  - локально → `headless: false` + `--ozone-platform=x11` (headed, как было);
  - в CI → `headless: true`, без X11-флага.
- **Устранены уязвимости зависимостей.** `npm audit --audit-level=high` падал (exit 1):
  2 high (`jws` — проверка HMAC-подписи, критично для web-push; `path-to-regexp` — DoS)
  + 3 moderate (`qs`, `body-parser`, `bn.js`). Все транзитивные, починены `npm audit fix`
  (в пределах semver, без `--force`). `package.json` не менялся — обновился только
  `package-lock.json`. После фикса — `0 vulnerabilities`.

### Отклонения от плана (план писался до миграции на SQLite)

- Добавлен прогон `npm run test:sqliteStore` — скрипта не было на момент написания плана.
- `node-version: "22"` вместо `22.18` — совпадает с сервером (v22.20) и `engines >= 22.18`.
- `playwright install` ставит `chrome`, а не `chromium` — config использует `channel: "chrome"`
  (брендированный Google Chrome ≠ открытый chromium).
- Actions запинены по тегу (`@v4`), а не по SHA — pin-by-SHA отложен до этапа 4
  (вместе с Dependabot, который будет их обновлять; SHA без Dependabot = ручной ад).

### Проверка

Локально прогнаны (зелёные): `tsc`, `test:env` (2), `test:sqliteStore` (8),
`test:integration` (5), `npm audit` (0 vuln).
Job `e2e` локально не гонялся (нужен headed Chrome + реальный FCM) — проверяется на самом CI.

### Техдолг (выявлен и закрыт при внедрении)

Обнаружено: `createTestApp()` (tests/tools.ts) собирал приложение на `createJsonStore`, тогда
как прод работает на `createSqliteStore`. Корень — миграция на SQLite (коммит `32ae0e0`)
переключила прод и добавила sqlite-тесты, но `tests/tools.ts` не тронула: тестовую инфру
просто забыли домигрировать.

Исправлено: `createTestApp` переведён на `createSqliteStore(":memory:")` (изолированная
in-memory БД на каждый тест, без файлов и cleanup). Удалена связка `testFile`/`cleanupTestFile`
из tools.ts и трёх тестов. Осиротевший `jsonStore` удалён целиком: `src/jsonStore`,
`tests/jsonStore`, скрипт `test:jsonStore`. Теперь integration/e2e проверяют тот же сторадж,
что и прод.

### Первый прогон CI — поймал реальный баг

При первом push в `main` job `test` упал на шаге Typecheck: `typescript` не был объявлен в
`package.json`. Локально `tsc` работал из глобального nvm-окружения, а в чистом CI `npx tsc`
тащил из реестра чужой пакет-пустышку `tsc@2.0.4` и падал. Фикс — `npm install -D typescript`.
Ровно та проблема «работает у меня на машине», ради которой CI и заводился.

Job `e2e` (Playwright headless + реальный FCM) при этом прошёл успешно — главный риск
флакающего e2e в CI пока не подтвердился.

### Риск к наблюдению

Playwright-тест ходит на реальный FCM (Google Push Service) — возможна flakiness в CI.
Если поплывёт — по плану выносим e2e в отдельный label-триггер.

## Этапы 2–5 — не начаты

Деплой (systemd, SSH, CD-workflow), Dependabot, CodeQL, branch protection, документация —
ждут отдельной итерации и ответов на открытые вопросы A–E из `cicd.plan.md`.
