# Результат: CI/CD через GitHub Actions

Внедряется поэтапно по `cicd-plan.md`. Здесь фиксируется фактически сделанное.

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
вопросы F–G в `cicd-plan.md`). Что сделано фактически:

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

## Этап 4. Безопасность и автоматизация — выполнено

### Сделано

- **4.1 Dependabot** — `.github/dependabot.yml` работает (npm + github-actions, weekly). Очередь
  накопившихся PR разобрана 2026-08-04, см. «Разбор очереди Dependabot» ниже.
- **4.3 Branch protection на `main`** — настроена (см. обновлённый `cicd-plan.md`, 4.3): required
  status check `test` (strict), запрет force-push и удаления ветки. PR-review не обязателен
  (`enforce_admins: false`). Изначально план откладывал этот пункт, аргументируя тем, что в
  проекте нет PR-флоу — с тех пор проект перешёл на issue-driven работу (branch + PR вместо
  прямого push в `main`, см. память агента), поэтому status checks теперь реально блокируют
  слияние, а не только защищают историю.
- **4.4 GitHub Environment** — осознанно не заводили (см. план).
- **4.2 CodeQL** — решено не подключать (не отложено, а закрыто как «не делаем»). Низкий ROI для
  проекта такого размера, дополнительно подтверждено ручным security-review
  (`security-review-result.md`): дефолтный taint-tracking CodeQL не отслеживает поток через
  границу персистентности в БД, то есть реальные находки того ревью он бы не поймал.

- **4.5 Pin actions by SHA** — выполнено. Все `uses:` в `ci.yml`/`deploy.yml` закреплены по
  полному SHA с комментарием версии. Детали — `docs/archive/pin-actions-by-sha-result.md`.

Единственное открытое было процедурным, не техническим: зависшие Dependabot-PR. Разобраны
2026-08-04, см. раздел ниже.

## Этап 5. Документация и удобство — выполнено (кроме PR-template, который решили не делать)

- **5.1 README** — бейджи CI/Deploy и раздел «Деплой» добавлены.
- **5.2 PR-template** — сознательно не делаем, обоснование не изменилось (issue-driven флоу всё
  же использует PR, но шаблон для одиночного автора признан лишним).
- **5.3 CLAUDE.md** — раздел «CI/CD» добавлен. Пункт про `npm run typecheck` как отдельный скрипт
  — опционален, не сделан.

## Разбор очереди Dependabot (2026-08-04)

Очередь стояла с 8 июля и упёрлась в `open-pull-requests-limit: 5` — Dependabot перестал
создавать новые PR, включая потенциальные security-обновления. Разобрано так:

| PR  | Обновление                  | Решение   | Почему                                                              |
| --- | --------------------------- | --------- | ------------------------------------------------------------------- |
| #5  | cors 2.8.5 → 2.8.6          | смержен   | Нулевая рантайм-дельта: только доки и чистка tarball                |
| #8  | express 5.1.0 → 5.2.1       | смержен   | Breaking из 5.2.0 откачен, `req.query`/`res.redirect` не используем |
| #14 | eslint 10.7.0 → 10.8.0      | смержен   | Минор линтера, рантайма не касается                                 |
| #9  | typescript 5.9.3 → 7.0.2    | закрыт    | typescript-eslint 8.66.0 держит peer `typescript <6.1.0`            |
| #15 | @types/node 24.6.2 → 26.1.2 | закрыт    | Типы не должны обгонять рантайм: Node у нас 24                      |

### Побочная находка: CI был красным на всех ветках

При первом же прогоне выяснилось, что падает не проверяемый PR, а шаг «Аудит зависимостей» —
и одинаково на всех ветках, включая `main`. Причина — два свежих адвайзори в транзитивных
зависимостях: `brace-expansion` 5.0.8 (**high**, GHSA-rgw5-rvv9-x895) и `body-parser` 2.2.2
(low, GHSA-v422-hmwv-36x6). Починено в PR #19 через `npm audit fix --package-lock-only`
(`package.json` не менялся, обновления укладываются в существующие semver-диапазоны).

Пока `main` был красным, strict-проверка не пропускала ни один PR — поэтому фикс аудита пришлось
влить первым, до мержей.

### Правило для @types/node

В `dependabot.yml` добавлен `ignore` на мажорные обновления `@types/node` (PR #19). Типы должны
совпадать по мажору с рантаймом: иначе `tsc` пропустит вызов API, которого в Node 24 нет, и
падение случится уже в проде. Патчи и миноры в пределах 24.x продолжают приходить — Dependabot
сразу подтвердил это, предложив 24.6.2 → 24.13.3 вместо мажора. Снять игнор при переезде на
следующий мажор Node.

## Что осталось

- **Дубли прогонов CI.** `ci.yml` триггерится и на `push` (без фильтра веток), и на
  `pull_request`, поэтому каждый PR гоняет `test` и `e2e` дважды. `concurrency` их не схлопывает:
  группа завязана на `github.ref`, а он различается — `refs/heads/<ветка>` против
  `refs/pull/N/merge`. Учитывая, что `e2e` ходит в реальный FCM, это вдвое больше минут Actions
  на ровном месте. Лечится добавлением `branches: [main]` в `push:` — заведено как issue #23.
- **Два новых PR** после разблокировки лимита: #20 (`@types/node` 24.6.2 → 24.13.3) и #21
  (`@playwright/test` 1.61.1 → 1.62.1) — не разбирались.

Эпик закрыт: `cicd-plan.md`, `cicd-task.md` и этот результат перенесены в `docs/archive/`,
ссылки в корневом `CLAUDE.md`, `docs/decisions.md` и `docs/terminal-api-plan.md` поправлены.
