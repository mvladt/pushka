# План: внедрение CI/CD через GitHub Actions

## Содержание

- [Этап 1. CI: тесты и typecheck](#этап-1-ci-тесты-и-typecheck)
- [Этап 2. Подготовка сервера: пользователь, каталоги, systemd, nginx](#этап-2-подготовка-сервера-пользователь-каталоги-systemd-nginx)
- [Этап 3. CD: автодеплой через GitHub Actions (rsync + releases/symlink)](#этап-3-cd-автодеплой-через-github-actions-rsync--releasessymlink)
- [Этап 4. Безопасность и автоматизация](#этап-4-безопасность-и-автоматизация)
- [Этап 5. Документация и удобство](#этап-5-документация-и-удобство)
- [Файлы для создания/изменения](#файлы-для-созданияизменения)
- [Открытые вопросы](#открытые-вопросы)

---

## Этап 1. CI: тесты и typecheck

Цель — на каждый push и PR прогонять весь набор проверок в чистом окружении.

### 1.1. Создать `.github/workflows/ci.yml`

- [x] Триггеры:
  - `push` (все ветки)
  - `pull_request` (в `main`)
- [x] `concurrency` — отменять предыдущие запуски на той же ветке/PR (`group: ci-${{ github.ref }}`, `cancel-in-progress: true`).
- [x] Дефолтные `permissions: contents: read`.

### 1.2. Job `test` — шаги

- [x] `actions/checkout@v4` _(пока по тегу, не SHA — pin-by-SHA отложен до этапа 4 вместе с Dependabot)_
- [x] `actions/setup-node@v4` с `node-version: "24"` + `cache: npm` _(изначально был мажор `22`, совпадал с сервером v22.20; после перехода на `node:sqlite` и отказа от `better-sqlite3` — обновлено до `24`, `engines` теперь `>= 24.0.0`)_
- [x] `npm ci`
- [x] **Typecheck:** `npx tsc` (использует существующий `tsconfig.json` с `noEmit: true`)
- [x] **Unit-тесты env:** `npm run test:env`
- [x] ~~**Unit-тесты jsonStore:** `npm run test:jsonStore`~~ — `jsonStore` удалён: прод на SQLite, тестовая инфра переведена на `createSqliteStore(":memory:")`. См. техдолг в `cicd.result.md`.
- [x] **Unit-тесты sqliteStore:** `npm run test:sqliteStore` _(добавлено — появилось после миграции на SQLite, плана ещё не было)_
- [x] **Integration-тесты:** `npm run test:integration`
- [x] **Аудит npm:** `npm audit --audit-level=high` (не падает на low/moderate). При внедрении нашёл 2 high + 3 moderate в транзитивных зависимостях (`jws`, `path-to-regexp`, `qs`, `body-parser`, `bn.js`) — устранены через `npm audit fix`.

### 1.3. Job `e2e` (Playwright)

- [x] Запускать всегда (на push в любую ветку и PR). Если поплывёт — переедем на label-based trigger.
- [x] Шаги:
  - [x] checkout + setup-node + `npm ci`
  - [x] `npx playwright install --with-deps chrome` _(именно `chrome`, а не `chromium` — config использует `channel: "chrome"`, это брендированный Google Chrome)_
  - [x] `npm run test:playwright` _(`CI=true` GitHub Actions выставляет сам, явный `CI=1` не нужен)_
- [x] Адаптировать `playwright.config.ts`:
  ```ts
  headless: !!process.env.CI,
  launchOptions: { args: process.env.CI ? [] : ["--ozone-platform=x11"] },
  ```
- [x] При падении — загружать артефакты:
  - `actions/upload-artifact@v4` с `test-results/` и `playwright-report/`.
  - `if: failure()`.

### 1.4. Совместимость workflow с уже-настроенной средой

- [x] Тесты используют `node:test` + чистый Node — никаких трюков с tsx/ts-node не нужно.
- [x] Перед прогоном проверить: `.env` либо отсутствует (env-модуль создаст), либо подложен. В worker'е чисто — `loadEnv()` сам сгенерирует. `createTestApp()` генерирует свои VAPID-ключи, так что integration/e2e не зависят от `.env`. Гонка на запись `.env` локально не воспроизвелась.

---

## Обновление плана (сервер SPB переустановлен)

Сервер был переустановлен с нуля после того, как писались этапы 2–3 ниже в их первой версии.
Актуальное состояние (проверено вручную по SSH):

- Node ставится **системно** через NodeSource (`apt`), сейчас `/usr/bin/node` v24.18.0 —
  никакого `nvm` на сервере больше нет.
- `webpush-scheduler` на сервере отсутствует полностью: ни каталога, ни systemd-юнита, ни
  процесса. Запись «Node v22 / systemd: webpush-scheduler.service» в `server-management/CLAUDE.md`
  не соответствовала реальности.
- Порт **3001 занят** соседним проектом `dexity-server` (Fastify, systemd, `/srv/dexity`) — у
  `webpush-scheduler` и `dexity` в конфигах был прописан один и тот же порт, это конфликт. Для
  `webpush-scheduler` выбран **порт 3002**.
- У `dexity` уже есть рабочий, проверенный на этом сервере паттерн деплоя
  (`~/Projects/MyOwn/dexity/deploy/`, `.github/workflows/deploy.yml`): выделенный системный
  пользователь, immutable-артефакт из CI, `releases/<sha>` + симлинк `current`, `rsync` по SSH,
  ручной `workflow_dispatch`, узкий `sudo` только на `systemctl restart`.

Этапы 2–3 переписаны под этот же паттерн. Решения A–E из первой версии плана (root, `command=` в
SSH-ключе, job внутри `ci.yml`, `git reset --hard`, автооткат через `deploy.sh`) **не действуют** —
оставлены в конце файла для истории, с пометкой о том, чем заменены.

---

## Этап 2. Подготовка сервера: пользователь, каталоги, systemd, nginx

Цель — поднять `webpush-scheduler` на сервере с нуля, по образу уже работающего `dexity-server`.

### 2.1. Системный пользователь и каталоги (одноразово, руками на сервере)

- [x] Node уже установлен системно (NodeSource, v24.18.0) — отдельно ставить не нужно.
- [x] Создать пользователя и каталоги:
  ```sh
  mkdir -p /srv/webpush-scheduler/releases /srv/webpush-scheduler/data
  useradd --system --home /srv/webpush-scheduler --shell /bin/bash webpush-scheduler
  chown -R webpush-scheduler:webpush-scheduler /srv/webpush-scheduler
  ```
- [x] `.env` — вручную положить в `/srv/webpush-scheduler/data/.env` (владелец `webpush-scheduler`,
      права `600`), `PORT=3002` (3001 занят `dexity-server`).
- [x] **Важно:** `.env` и `notifications.db` читаются по относительному пути от `cwd` (дефолты в
      `loadEnv()` и `createSqliteStore()`) — если оставить их внутри `releases/<sha>`, каждый деплой
      будет создавать новые VAPID-ключи и пустую базу. Оба файла живут в `data/` вне `releases/` и
      симлинкуются в каждый релиз (см. 3.3).

### 2.2. Создать `/etc/systemd/system/webpush-scheduler.service`

По образу `dexity/deploy/dexity-server.service`. Файл сначала кладём в репозиторий
(`deploy/webpush-scheduler.service`, см. 2.4), на сервер копируем при первичной настройке:

```ini
[Unit]
Description=Webpush Scheduler
After=network.target

[Service]
Type=simple
User=webpush-scheduler
WorkingDirectory=/srv/webpush-scheduler/current
ExecStart=/usr/bin/node src/main.ts
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

- [x] `WorkingDirectory` — `current` (симлинк на актуальный релиз), не сам релиз: путь в юните не
      меняется между деплоями.
- [x] Node — системный бинарь `/usr/bin/node`, без версии в пути (в отличие от первой версии плана
      с жёстким nvm-путём): апгрейд Node через apt/NodeSource подхватится сам, без правки юнита.
- [x] `systemctl daemon-reload`, `systemctl enable webpush-scheduler` (не `--now` — сервису ещё
      нечего стартовать, первый релиз положит workflow деплоя, см. этап 3).

### 2.3. nginx + TLS

Домена `scheduler.push.mvladt.ru` сейчас нет ни в одном nginx-конфиге на сервере. Настраиваем с
нуля, по образу `dexity/nginx/dexity.conf`:

- [x] Сначала только `:80`-блок (ACME) и выпуск сертификата:
  ```sh
  certbot certonly --webroot -w /var/www/html -d scheduler.push.mvladt.ru
  ```
- [x] Затем полный конфиг из `nginx/webpush-scheduler.conf` (см. 2.4) →
      `/etc/nginx/conf.d/webpush-scheduler.conf`, `nginx -t && systemctl reload nginx`.
- [x] Метод `webroot`, не `--nginx`-плагин — домен терминирует TLS на `127.0.0.1:8443` за Xray
      Reality fallback, `--nginx`-плагин может отредактировать не тот файл.

### 2.4. Подготовить файлы деплоя в репозитории webpush-scheduler

- [x] `deploy/webpush-scheduler.service` — юнит из 2.2.
- [x] `nginx/webpush-scheduler.conf` — по образу `dexity/nginx/dexity.conf`, но с одним
      `location /` без разделения на статику/`/api/` — webpush-scheduler сам отдаёт и статику
      (`src/client/`), и API из одного Express-процесса:
  ```nginx
  server {
      listen 127.0.0.1:8443 ssl;
      server_name scheduler.push.mvladt.ru;

      ssl_certificate     /etc/letsencrypt/live/scheduler.push.mvladt.ru/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/scheduler.push.mvladt.ru/privkey.pem;

      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
      add_header X-Content-Type-Options    "nosniff" always;
      add_header X-Frame-Options           "DENY" always;

      location / {
          proxy_pass http://127.0.0.1:3002;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
      }
  }

  server {
      listen 80;
      server_name scheduler.push.mvladt.ru;
      location /.well-known/acme-challenge/ { root /var/www/html; }
      location / { return 301 https://$host$request_uri; }
  }
  ```
- [x] `deploy/README.md` — по образу `dexity/deploy/README.md`: команды первичной настройки
      сервера (2.1–2.3), структура `/srv/webpush-scheduler/`, ручной деплой (fallback, без CI).

### 2.5. Обновить `server-management/CLAUDE.md`

- [x] Таблица приложений: `scheduler.push.mvladt.ru` — порт `3002` (не `3001`), управление —
      `systemd: webpush-scheduler.service`, деплой — GitHub Actions → rsync → `/srv/webpush-scheduler`.
- [x] Убрать текущую неверную запись про systemd — на момент её написания сервис не был развёрнут
      физически, документ не был синхронизирован с реальностью (пере)установки сервера.

---

## Этап 3. CD: автодеплой через GitHub Actions (rsync + releases/symlink)

По образу `dexity/.github/workflows/deploy.yml`. Артефакт immutable, собирается в CI, на сервере —
только распаковка и рестарт.

### 3.1. Артефакт деплоя

- [x] Build-шаг не нужен — весь `src/` выполняется напрямую (Node 24 стрипает типы на лету), в
      отличие от `dexity`, где `server/dist` собирается через `tsc`/бандлер.
- [x] Артефакт — `src/`, `package.json`, `package-lock.json`, `node_modules/` после
      `npm ci --omit=dev`. Так как `better-sqlite3` убран (переход на `node:sqlite`, см.
      `docs/archive/node24-builtin-sqlite.result.md`), `node_modules` состоит только из чистого JS —
      переносится с раннера CI на сервер без проблем с нативными бинарниками/архитектурой.

### 3.2. Подготовка SSH-доступа для CI

- [x] Отдельный ed25519-ключ только для CI (не тот же, что личные):
  ```sh
  ssh-keygen -t ed25519 -C "github-actions-webpush-scheduler" -f ~/.ssh/gha_webpush -N ""
  ```
- [x] Публичный ключ → `/srv/webpush-scheduler/.ssh/authorized_keys` (владелец
      `webpush-scheduler`, права `700`/`600`), **без** `command="..."` — деплой через `rsync`
      использует SSH для передачи файлов, а не для запуска одной фиксированной команды (в отличие
      от первой версии плана со `scripts/deploy.sh`).
- [x] Узкий `sudo` — только рестарт сервиса (как у `dexity`, см. `/etc/sudoers.d/dexity-deploy`):
  ```sh
  echo 'webpush-scheduler ALL=(root) NOPASSWD: /usr/bin/systemctl restart webpush-scheduler' \
    > /etc/sudoers.d/webpush-scheduler-deploy
  chmod 440 /etc/sudoers.d/webpush-scheduler-deploy
  ```

### 3.3. Создать `.github/workflows/deploy.yml`

- [x] Триггер — только `workflow_dispatch` (ручная кнопка в Actions), без параметров. Отдельно от
      `ci.yml` — тот гоняется на каждый push/PR в `main` (typecheck + тесты), деплоем не
      блокируется автоматически.
- [x] Шаги (по образу `dexity`, без блока `client`):
  - `actions/checkout@v4`, `actions/setup-node@v4` (`node-version: 24`, `cache: npm`).
  - `npm ci --omit=dev`.
  - SHA релиза: `git rev-parse --short=12 HEAD`.
  - ssh-agent с `secrets.DEPLOY_SSH_KEY`, known_hosts из `secrets.DEPLOY_HOST_KEY`
    (`ssh-keyscan -t ed25519 188.225.37.62`).
  - `mkdir -p /srv/webpush-scheduler/releases/$SHA` на сервере, затем
    `rsync -az src node_modules package.json package-lock.json
    webpush-scheduler@188.225.37.62:/srv/webpush-scheduler/releases/$SHA/`.
  - На сервере: симлинки `data/.env` и `data/notifications.db` внутрь релиза, переключить
    `current` на новый релиз, `sudo systemctl restart webpush-scheduler`, почистить старые релизы
    (оставить последние 5).
  - Прод-проверка: `curl -fsS https://scheduler.push.mvladt.ru/api/health`.
- [x] `concurrency: { group: webpush-scheduler-deploy, cancel-in-progress: false }` — не отменять
      деплой в процессе повторным запуском.

### 3.4. Секреты в GitHub (Settings → Secrets and variables → Actions)

- [x] `DEPLOY_SSH_KEY` — приватный ключ из 3.2.
- [x] `DEPLOY_HOST_KEY` — вывод `ssh-keyscan -t ed25519 188.225.37.62`.

### 3.5. Откат

Симлинк `current` держит последний релиз, предыдущие остаются в `releases/` (последние 5). Откат —
переключить симлинк на нужный `releases/<sha>` и перезапустить сервис, без пересборки:

```sh
ssh webpush-scheduler@188.225.37.62 "
  ln -sfn /srv/webpush-scheduler/releases/<sha-of-known-good> /srv/webpush-scheduler/current &&
  sudo systemctl restart webpush-scheduler
"
```

Автооткат в сам workflow не встраиваем (проще руками переключить на готовый предыдущий релиз, чем
городить логику отката в CI, как в первой версии плана с `deploy.sh`) — команда документируется в
`deploy/README.md` (2.4).

---

## Этап 4. Безопасность и автоматизация

### 4.1. Dependabot

- [ ] Создать `.github/dependabot.yml`:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: npm
      directory: "/"
      schedule: { interval: weekly }
      open-pull-requests-limit: 5
    - package-ecosystem: github-actions
      directory: "/"
      schedule: { interval: weekly }
  ```
- [ ] **Docker-эконосистему пока не включаем** — Dockerfile не используется в CD.

### 4.2. CodeQL

- [ ] `.github/workflows/codeql.yml` — стандартный шаблон GitHub для JavaScript/TypeScript.
- [ ] Запуск: на push в `main`, на PR, по cron раз в неделю.
- [ ] Для публичного репо бесплатен — у нас именно так.

### 4.3. Branch protection на `main`

В Settings → Branches → Add rule `main`:

- [ ] Require status checks to pass: `test`, `e2e` (когда стабилизируется), `codeql`.
- [ ] Require branches to be up to date before merging.
- [ ] Disallow force pushes.
- [ ] Disallow deletions.
- [ ] PR-перед-merge — на усмотрение. Для одиночного автора можно оставить прямой push в main с обязательными checks.

### 4.4. GitHub Environment `production` — не заводим

Деплой теперь ручной (`workflow_dispatch`, см. 3.3), а не автоматический по push — required reviewer
и штатное окружение GitHub не добавляют защиты сверх самой ручной кнопки. `dexity/deploy.yml`
работает так же, без `environment:` — секреты (3.4) достаточно держать на уровне репозитория.
Можно вернуться к этому пункту, если деплой снова станет автоматическим.

### 4.5. Pin actions by SHA

- [ ] Все `uses:` в workflow указывать **по полному SHA**, не по тегу:
  ```yaml
  uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
  ```
- [ ] Dependabot будет обновлять автоматически.

---

## Этап 5. Документация и удобство

### 5.1. README

- [ ] Бейджи в шапку:
  ```markdown
  ![CI](https://github.com/mvladt/webpush-scheduler/actions/workflows/ci.yml/badge.svg)
  ![Deploy](https://github.com/mvladt/webpush-scheduler/actions/workflows/deploy.yml/badge.svg)
  ```
- [ ] Раздел «Деплой» — короткое описание: ручной запуск workflow `Deploy` в Actions → CI собирает
      артефакт (`npm ci --omit=dev`) → `rsync` в новый `releases/<sha>` на сервере → симлинк
      `current` переключается → `systemctl restart` → health-check. Подробности — в
      `deploy/README.md`.

### 5.2. PR template

- [ ] `.github/pull_request_template.md`:
  ```markdown
  ## Что
  ## Зачем
  ## Как проверял
  ```

### 5.3. CLAUDE.md проекта

- [ ] Раздел «CI/CD»: краткое описание workflow-файлов и их связи.
- [ ] Раздел «Команды» — добавить `npm run typecheck` (если решим вынести `tsc` в скрипт — опционально).

---

## Файлы для создания/изменения

| Действие | Файл                                       | Этап |
| -------- | ------------------------------------------ | ---- |
| Создать  | `.github/workflows/ci.yml`                 | 1    |
| Создать  | `.github/workflows/deploy.yml`             | 3    |
| Создать  | `deploy/webpush-scheduler.service`         | 2    |
| Создать  | `deploy/README.md`                         | 2    |
| Создать  | `nginx/webpush-scheduler.conf`             | 2    |
| Создать  | `.github/workflows/codeql.yml`             | 4    |
| Создать  | `.github/dependabot.yml`                   | 4    |
| Создать  | `.github/pull_request_template.md`         | 5    |
| Изменить | `playwright.config.ts` (headless под CI)   | 1    |
| Изменить | `README.md` (бейджи + раздел деплоя)       | 5    |
| Изменить | `CLAUDE.md` (раздел CI/CD)                 | 5    |
| Создать (на сервере) | пользователь и каталоги `/srv/webpush-scheduler/` | 2 |
| Создать (на сервере) | `/etc/systemd/system/webpush-scheduler.service` | 2 |
| Создать (на сервере) | `/etc/nginx/conf.d/webpush-scheduler.conf` + TLS-сертификат | 2 |
| Создать (на сервере) | `/srv/webpush-scheduler/.ssh/authorized_keys` (deploy-ключ) | 3 |
| Создать (на сервере) | `/etc/sudoers.d/webpush-scheduler-deploy`  | 3 |
| Изменить | `~/Projects/MyOwn/server-management/CLAUDE.md` (порт, статус деплоя) | 2 |

Не создаём (отложено):
- `.github/workflows/release.yml` (GHCR push) — деплой нативный (rsync), образ не нужен.
- `.dockerignore` / правки `Dockerfile` — Dockerfile не используется в CD, но актуализирован
  (`node:24-alpine`) на случай будущего использования.

---

## Порядок внедрения (рекомендуемый)

1. **Этап 1** — CI с тестами. Безопасно, на прод не влияет. Сразу видим, что workflow зелёный.
2. **Этап 4.1 + 4.3 + 4.5** — Dependabot, защита ветки, pin actions. Тоже без рисков.
3. **Этап 2** — пользователь, каталоги, systemd, nginx на сервере. Критичный момент (первое
   появление сервиса на переустановленном сервере), делаем вручную, на месте проверяем.
4. **Этап 3** — CD-workflow. `workflow_dispatch` сразу, без промежуточного варианта — деплой
   ручной по дизайну (см. вопрос D в старой версии плана ниже).
5. **Этап 4.2** — CodeQL. (4.4 не делаем, см. выше.)
6. **Этап 5** — документация.

Каждый этап — самостоятельный коммит/PR.

---

## Открытые вопросы

1. ~~Как развёрнут сервер?~~ → нативно на SPB, изначально не под systemd; после переустановки
   сервера — заново, под systemd, по образу `dexity` (см. «Обновление плана» и этап 2).
2. ~~Репо публичный?~~ → да (проверил через `gh`).
3. ~~`notifications.json` — что с ним?~~ → пользователь сказал «фиг с ним», volume не нужен.
4. ~~Ручное подтверждение деплоя?~~ → изначально «автомат», после переустановки сервера и
   перехода на паттерн `dexity` — **ручной `workflow_dispatch`** (см. вопрос D ниже и этап 3.3).
5. ~~`/api/health`?~~ → есть, `src/router/router.ts`.
6. ~~Playwright в CI?~~ → да, всегда.
7. ~~ESLint/Prettier?~~ → отложено, см. `eslint-prettier.task.md`.

**Ответы на открытые вопросы A–E (первая версия плана, до переустановки сервера).**
Актуальны только как история решений — сервер был переустановлен, обнаружился конфликт портов и
готовый паттерн деплоя `dexity` на этом же сервере, и большинство решений ниже заменены (см.
«Обновление плана» и вопросы F–G):

A. ~~SSH-пользователь для деплоя?~~ → **root** (как есть сейчас).

B. ~~Ограничение SSH-ключа CI через `command="..."`?~~ → **включаем сразу**.

C. ~~Node-версия в systemd-юните?~~ → **жёсткий путь к бинарю nvm** (`/root/.nvm/versions/node/v24.18.0/bin/node`, версия обновлена после перехода на Node 24). Пользователь предпочёл явность; при апгрейде Node путь в юните надо будет обновить руками.

D. ~~Триггер деплоя?~~ → **job `deploy` внутри `ci.yml`**, а не отдельный `deploy.yml`: `needs: [test, e2e]` + `if: github.ref == 'refs/heads/main'`. Тесты гоняются один раз (обычная зависимость job'ов, не хрупкий `workflow_run` между разными workflow), деплой стартует только после их успеха.

E. ~~Падение деплоя — что делать?~~ → **автооткат в `deploy.sh`**, одна попытка без цикла: при провале health-check скрипт возвращается на предыдущий коммит, переустанавливает зависимости и перезапускает сервис. Если и откат не поднялся — красный билд с диагностикой, разбор руками.

**Вопросы F–G (после переустановки сервера):**

F. **Какой порт для webpush-scheduler?** Порт 3001 занят `dexity-server`. → **3002.**

G. **Какой паттерн деплоя использовать?** Продолжить старый план (root, `git reset --hard` на
месте, push в main как триггер) или повторить уже работающий на этом сервере паттерн `dexity`
(выделенный системный пользователь, immutable-артефакт из CI, `releases/<sha>` + симлинк
`current`, `rsync`, ручной `workflow_dispatch`, узкий `sudo`)? → **паттерн `dexity`.** Проверенная
на этом же сервере схема, безопаснее (не root), откат — просто переключить симлинк. Это отменяет
решения A, B, D, E выше — см. этапы 2–3 в актуальной редакции.
