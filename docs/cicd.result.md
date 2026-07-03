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

### Выравнивание тест/прод вскрыло баг планировщика

После перевода e2e на SQLite (тот же сторадж, что и прод) тест упал: уведомление планировалось,
но не доставлялось. Причина — `sqliteStore.getAllForNow` выбирал окно `[now, now+2min]`, тогда
как `jsonStore` (на котором e2e шёл раньше) прощал прошлое. Окно `[now, now+2min]` кривое с двух
сторон: (1) уже наступившие уведомления (просрочка хоть в секунды) не отправлялись **никогда**;
(2) будущие улетали за 2 минуты до срока. Баг был в проде, e2e на jsonStore его маскировал.

Исправлено: `getAllForNow` теперь возвращает всё наступившее (`datetime <= now`), а планировщик
(`scheduler.work`) отправляет только не сильно просроченное (порог `GRACE_MS = 5 мин`); протухшее
тихо отбрасывается, но удаляется из хранилища, чтобы не копиться. Unit-тесты `getAllForNow`
переписаны под новую семантику (раньше кодировали старое окно). Grace-фильтр планировщика
отдельным unit не покрыт (приватная `work` + `setInterval`) — happy-path проверяется e2e.

Job `e2e` (Playwright headless + реальный FCM) при этом прошёл успешно — главный риск
флакающего e2e в CI пока не подтвердился.

### Риск к наблюдению

Playwright-тест ходит на реальный FCM (Google Push Service) — возможна flakiness в CI.
Если поплывёт — по плану выносим e2e в отдельный label-триггер.

## Этапы 2–3. Деплой (сервер + CD) — ✅ выполнено

Между написанием плана и его реализацией сервер SPB был переустановлен с нуля — старые
предположения (root, `nvm`, `git reset --hard` на месте) не подтвердились на практике. План
переписан под паттерн уже работающего на этом сервере `dexity-server` (см. «Обновление плана» и
вопросы F–G в `cicd.plan.md`). Что сделано фактически:

### На сервере (SPB, 188.225.37.62)

- Системный пользователь `webpush-scheduler` (`/srv/webpush-scheduler`, без root).
- Каталоги `releases/` и `data/` — `.env` (реальные VAPID-ключи, `PORT=3002` — 3001 занят
  `dexity-server`) и `notifications.db` живут в `data/` вне релизов и симлинкуются в каждый релиз.
- `systemd`-юнит `webpush-scheduler.service`, `WorkingDirectory=/srv/webpush-scheduler/current`,
  `ExecStart=/usr/bin/node src/main.ts` (системный Node 24 через NodeSource, без `nvm`).
- nginx: новый конфиг `/etc/nginx/conf.d/webpush-scheduler.conf` (домена раньше не было вообще),
  TLS-сертификат выпущен через `certbot certonly --webroot` (истекает 2026-10-01). Nginx
  перезагружен дважды (сначала `:80`-блок для ACME, потом полный конфиг) — оба раза `nginx -t`
  проверен заранее, соседние сайты (`mvladt.ru`, `dexity.mvladt.ru`) не пострадали.
- SSH-ключ для CI (отдельный ed25519) в `authorized_keys` пользователя `webpush-scheduler`, без
  `command="..."` (деплой через `rsync`, а не через фиксированную команду).
- Узкий `sudo`: `/etc/sudoers.d/webpush-scheduler-deploy` —
  `NOPASSWD: /usr/bin/systemctl restart webpush-scheduler`, по образу `dexity-deploy`.

### В репозитории

- `.github/workflows/deploy.yml` — `workflow_dispatch`, собирает `npm ci --omit=dev`, заливает
  `src/`, `node_modules/`, `package*.json` через `rsync` в `releases/<sha>`, симлинкует
  `.env`/`notifications.db` из `data/`, переключает `current`, `sudo systemctl restart`, чистит
  старые релизы (оставляет 5), проверяет `GET /api/health` на проде.
- `deploy/webpush-scheduler.service`, `deploy/README.md`, `nginx/webpush-scheduler.conf` — по
  образцу аналогичных файлов `dexity`.
- `server-management/CLAUDE.md` — актуализирован (порт 3002, статус деплоя, снята несуществующая
  запись про SSL-сертификат).

### Первый прогон CI после пуша — поймал флак, не регрессию

После пуша `e2e`-job упал: таймаут ожидания push-уведомления через реальный FCM (ровно риск,
отмеченный в конце этапа 1). Перезапуск (`gh run rerun --failed`) прошёл зелёным — воспроизвести
не удалось, похоже на разовую задержку доставки FCM на раннере GitHub. Риск остаётся актуальным
(см. «Риск к наблюдению» выше), но это не блокировало деплой — `test`-job (typecheck + unit +
integration) был зелёным с первого раза.

### Первый деплой

Запущен вручную (`gh workflow run deploy.yml`) сразу после зелёного CI. Прошёл с первого раза:
`current` указывает на релиз коммита `f9954d2`, `systemctl status webpush-scheduler` — `active
(running)`, симлинки на `.env`/`notifications.db` в релизе на месте, `notifications.db` создан
приложением при первом старте. Внешняя проверка `https://scheduler.push.mvladt.ru/api/health` —
`200`.

## Этапы 4–5 — не начаты

Dependabot, CodeQL, branch protection, pin-by-SHA, PR-template, документация README/CLAUDE.md —
следующая итерация.
