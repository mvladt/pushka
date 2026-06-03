# План: внедрение CI/CD через GitHub Actions

## Содержание

- [Этап 1. CI: тесты и typecheck](#этап-1-ci-тесты-и-typecheck)
- [Этап 2. Подготовка сервера: systemd-юнит](#этап-2-подготовка-сервера-systemd-юнит)
- [Этап 3. CD: автодеплой по SSH](#этап-3-cd-автодеплой-по-ssh)
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
- [x] `actions/setup-node@v4` с `node-version: "22"` + `cache: npm` _(взял мажор `22` вместо `22.18` — совпадает с сервером v22.20 и engines `>= 22.18`)_
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

## Этап 2. Подготовка сервера: systemd-юнит

Цель — закрыть TODO из `server-management/CLAUDE.md` («scheduler не под systemd») и иметь чистую цель для `systemctl restart` из CD-workflow.

### 2.1. Подготовка (одноразово, руками на сервере)

- [ ] Залогиниться на SPB, найти и убить старый nohup-процесс (`kill 3387331` или эквивалент).
- [ ] Проверить, что `/root/projects/webpush-scheduler/` чистый, синхронизирован с `origin/main`.
- [ ] Прогнать `npm ci --omit=dev`.

### 2.2. Создать `/etc/systemd/system/webpush-scheduler.service`

По образу `mvladt-nuxt.service` (на сервере — `systemctl cat mvladt-nuxt.service`). Примерное содержимое:

```ini
[Unit]
Description=Webpush Scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/projects/webpush-scheduler
ExecStart=/root/.nvm/versions/node/v22.20.0/bin/node src/main.ts
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

- [ ] Не передавать `--env-file .env` — текущий код подгружает `.env` через `loadEnv()`.
- [ ] `WorkingDirectory` — `/root/projects/webpush-scheduler`, чтобы `.env` и `notifications.json` лежали рядом.
- [ ] Подумать о Node-версии: жёстко прописать путь через nvm — хрупко при обновлении Node. Альтернатива: `ExecStart=/usr/bin/env -S bash -lc "node src/main.ts"` (загружает nvm через bash login). Решим на месте.

### 2.3. Активация

- [ ] `systemctl daemon-reload`
- [ ] `systemctl enable --now webpush-scheduler`
- [ ] Проверить: `systemctl status webpush-scheduler`, `curl http://localhost:3001/api/health`, `curl https://scheduler.push.mvladt.ru/api/health`.
- [ ] Проверить, что после `reboot` сервис поднимается сам.

### 2.4. Обновить `server-management/CLAUDE.md`

- [ ] Снять чекбокс TODO «scheduler не под systemd».
- [ ] Изменить колонку «Управление» в таблице приложений: `systemd: webpush-scheduler.service`.

---

## Этап 3. CD: автодеплой по SSH

### 3.1. Подготовка SSH-доступа для CI

- [ ] Сгенерировать **отдельный** ed25519-ключ только для CI:
  ```sh
  ssh-keygen -t ed25519 -C "github-actions-webpush-scheduler" -f ~/.ssh/gha_webpush -N ""
  ```
- [ ] Положить публичный ключ в `/root/.ssh/authorized_keys` на SPB. Для усиления — добавить ограничения:
  ```
  command="/root/projects/webpush-scheduler/scripts/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... github-actions-webpush-scheduler
  ```
  *(командное ограничение — опционально; если не делаем, ключ имеет полный shell-доступ под root, как и личный.)*
- [ ] Если делаем `command="..."`, то в репозитории нужен `scripts/deploy.sh` (см. ниже).

### 3.2. Добавить `scripts/deploy.sh` (запускается на сервере)

- [ ] Скрипт идемпотентный, выполняется в `WorkingDirectory` сервиса:
  ```sh
  #!/usr/bin/env bash
  set -euo pipefail
  cd /root/projects/webpush-scheduler
  git fetch --prune origin
  git reset --hard origin/main
  source /root/.nvm/nvm.sh
  nvm use --lts >/dev/null 2>&1 || true
  npm ci --omit=dev
  systemctl restart webpush-scheduler
  # Подождать пока сервис поднимется
  for i in {1..15}; do
    if curl -fsS http://localhost:3001/api/health >/dev/null; then
      echo "healthy"; exit 0
    fi
    sleep 1
  done
  echo "FAIL: health check timeout"
  systemctl status webpush-scheduler --no-pager | tail -30
  exit 1
  ```
- [ ] `chmod +x scripts/deploy.sh`. Файл коммитится в репо — он становится «источником истины» для процедуры деплоя.

### 3.3. Создать `.github/workflows/deploy.yml`

- [ ] Триггеры:
  - `workflow_run`: после успешного `ci.yml` на ветке `main` (`branches: [main]`, `types: [completed]` + проверка `conclusion == 'success'`).
  - `workflow_dispatch` — на случай ручного деплоя.
- [ ] Environment: `production` (см. этап 4.4).
- [ ] Permissions: `contents: read`.

### 3.4. Шаги job `deploy`

- [ ] Установить ssh-agent: `webfactory/ssh-agent@<sha>` с `ssh-private-key: ${{ secrets.DEPLOY_SSH_KEY }}`.
- [ ] Добавить host в known_hosts: `ssh-keyscan -H 188.225.37.62 >> ~/.ssh/known_hosts` (или хранить отпечаток в Secret и `ssh-keygen -lf`).
- [ ] Запустить:
  ```sh
  ssh root@188.225.37.62 'bash /root/projects/webpush-scheduler/scripts/deploy.sh'
  ```
  *(если `command="..."` в `authorized_keys` — достаточно `ssh root@188.225.37.62`.)*
- [ ] Внешний smoke после деплоя:
  ```sh
  curl --fail --retry 5 --retry-delay 2 https://scheduler.push.mvladt.ru/api/health
  ```

### 3.5. Секреты в GitHub (Settings → Secrets and variables → Actions → Environments → production)

- [ ] `DEPLOY_SSH_KEY` — приватный ключ ed25519 (в формате OpenSSH), который кладём в `authorized_keys` сервера.
- [ ] `DEPLOY_HOST` (опционально, для гибкости): `188.225.37.62`.
- [ ] `DEPLOY_USER`: `root`.

### 3.6. Откат

- [ ] Документировать в `README.md` (или отдельным `docs/deploy.md`):
  ```sh
  ssh root@188.225.37.62
  cd /root/projects/webpush-scheduler
  git reset --hard <SHA-of-known-good>
  npm ci --omit=dev
  systemctl restart webpush-scheduler
  ```
- [ ] Workflow `rollback.yml` с `workflow_dispatch` и параметром `sha` — опционально, в будущем.

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

### 4.4. GitHub Environment `production`

- [ ] Создать environment `production`, привязать секреты деплоя (3.5).
- [ ] **Без required reviewer** — деплой автоматический (пользователь так попросил).
- [ ] Указать URL: `https://scheduler.push.mvladt.ru` — будет красивая ссылка в UI деплоев.

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
- [ ] Раздел «Деплой» — короткое описание: push в main → CI → SSH-деплой → health-check.

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
| Создать  | `.github/workflows/codeql.yml`             | 4    |
| Создать  | `.github/dependabot.yml`                   | 4    |
| Создать  | `.github/pull_request_template.md`         | 5    |
| Создать  | `scripts/deploy.sh`                        | 3    |
| Изменить | `playwright.config.ts` (headless под CI)   | 1    |
| Изменить | `README.md` (бейджи + раздел деплоя)       | 5    |
| Изменить | `CLAUDE.md` (раздел CI/CD)                 | 5    |
| Создать (на сервере) | `/etc/systemd/system/webpush-scheduler.service` | 2 |
| Изменить (на сервере) | `/root/.ssh/authorized_keys` (deploy-ключ) | 3 |
| Изменить | `~/Projects/MyOwn/server-management/CLAUDE.md` (снять TODO) | 2 |

Не создаём (отложено):
- `.github/workflows/release.yml` (GHCR push) — пока деплой нативный, образ не нужен.
- `.dockerignore` / правки `Dockerfile` — пока Docker на сервере не появится.

---

## Порядок внедрения (рекомендуемый)

1. **Этап 1** — CI с тестами. Безопасно, на прод не влияет. Сразу видим, что workflow зелёный.
2. **Этап 4.1 + 4.3 + 4.5** — Dependabot, защита ветки, pin actions. Тоже без рисков.
3. **Этап 2** — systemd-юнит на сервере. Это критичный момент, делаем вручную, на месте проверяем. Здесь возможен короткий downtime (пока убиваем nohup и поднимаем systemd).
4. **Этап 3** — CD-workflow. Сначала пробуем `workflow_dispatch` руками, потом включаем `workflow_run`.
5. **Этап 4.2 + 4.4** — CodeQL, GitHub Environment.
6. **Этап 5** — документация.

Каждый этап — самостоятельный коммит/PR.

---

## Открытые вопросы

1. ~~Как развёрнут сервер?~~ → нативно на SPB, не под systemd, см. этап 2.
2. ~~Репо публичный?~~ → да (проверил через `gh`).
3. ~~`notifications.json` — что с ним?~~ → пользователь сказал «фиг с ним», volume не нужен.
4. ~~Ручное подтверждение деплоя?~~ → автомат.
5. ~~`/api/health`?~~ → есть, `src/router/router.ts`.
6. ~~Playwright в CI?~~ → да, всегда.
7. ~~ESLint/Prettier?~~ → отложено, см. `eslint-prettier.task.md`.

**Новые открытые вопросы — нужен ответ перед началом:**

A. **SSH-пользователь для деплоя.** Сейчас на SPB всё под `root`. Деплоить тоже под `root` — быстрее всего, но «грязно». Альтернатива — завести `deploy`-пользователя в группе с правами `systemctl restart webpush-scheduler` через sudoers. Делаем «грязно» или «правильно»?

B. **Ограничение SSH-ключа CI через `command="..."`** в `authorized_keys`. Сильно усложняет ключ (он сможет только запустить `deploy.sh`), но значительно безопаснее. Включаем сразу или потом?

C. **Node-версия в systemd-юните.** Жёстко прописать путь к бинарю nvm (`/root/.nvm/versions/node/v22.20.0/bin/node`) — хрупко при апгрейде Node. Или завернуть в bash-loader, чтобы nvm активировался. Что предпочитаешь?

D. **Триггер деплоя.**
   - Вариант 1: `workflow_run` после успешного CI на `main` — деплой запускается автоматически после каждого зелёного коммита в main.
   - Вариант 2: на push tag `v*.*.*` — деплоятся только явные релизы.
   - Вариант 3: на push в `main` напрямую (без зависимости от CI workflow) с дублированием тестов в начале deploy-workflow — проще, надёжнее.

   По умолчанию заложил **вариант 1**, но он самый хрупкий из трёх (`workflow_run` иногда странно себя ведёт). Что выбираешь?

E. **Падение деплоя — что делать?** Сейчас при `health-check timeout` сервис останется в сломанном состоянии (старый код уже сброшен). Делаем автооткат на предыдущий SHA (хранить в файле `LAST_GOOD_SHA`) или просто красный билд + ручной разбор?
