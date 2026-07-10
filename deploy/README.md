# Деплой pushka на VPS

Immutable-артефакт: собирается в CI, на сервере — только распаковка (`rsync`) и рестарт.
Build-шага нет: `src/` выполняется напрямую (Node 24 стрипает типы на лету), нативных зависимостей
тоже нет (`node:sqlite` встроен в Node, `better-sqlite3` не используется).

## Как задеплоить

Вкладка **Actions** репозитория → workflow **Deploy** → **Run workflow** (`workflow_dispatch`,
без параметров). `.github/workflows/deploy.yml` делает всё сам: собирает зависимости
(`npm ci --omit=dev`), синкает артефакт в новый `releases/<sha>`, атомарно переключает симлинк
`current`, перезапускает `pushka`, чистит старые релизы (оставляет последние 5) и
проверяет живой прод (`GET /api/health` → `200`).

CI-гейт (`ci.yml`, typecheck + тесты) прогоняется отдельно на каждый push/PR в `main` — деплой
им не блокируется автоматически, запускается вручную кнопкой.

## Структура на сервере

```
/srv/pushka/
├── releases/
│   └── <git-sha>/
│       ├── src/
│       ├── node_modules/       # prod-only (npm ci --omit=dev)
│       ├── package.json
│       ├── .env                 -> ../../data/.env (симлинк)
│       └── notifications.db     -> ../../data/notifications.db (симлинк)
├── data/                        # .env + notifications.db — вне релизов, деплой их не трогает
└── current -> releases/<git-sha>
```

`.env` и `notifications.db` читаются по относительному пути от `cwd` (дефолты в `loadEnv()` и
`createSqliteStore()`), поэтому каждый релиз содержит симлинк на общий `data/` — иначе каждый
деплой сгенерировал бы новые VAPID-ключи (все существующие push-подписки стали бы невалидны) и
пустую базу уведомлений.

## Первичная настройка сервера (один раз)

Нужна только при поднятии с нуля (или переносе на другой сервер) — обычный деплой её не требует.

```bash
# Node уже должен быть установлен системно (NodeSource, см. server-management)
node --version   # >= 24

# каталоги + системный пользователь
mkdir -p /srv/pushka/releases /srv/pushka/data
useradd --system --home /srv/pushka --shell /bin/bash pushka
chown -R pushka:pushka /srv/pushka

# .env — вручную, см. корневой README.md проекта (VAPID-ключи, PORT=3002; порт 3001 занят
# соседним dexity-server); права 600, владелец pushka
# notifications.db создастся сам при первом запуске

# systemd
cp deploy/pushka.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable pushka   # без --now — первый релиз положит workflow деплоя

# nginx: сначала только :80-блок (ACME), выпустить сертификат, потом полный конфиг
certbot certonly --webroot -w /var/www/html -d pushka.mvladt.ru
cp nginx/pushka.conf /etc/nginx/conf.d/pushka.conf
nginx -t && systemctl reload nginx

# деплой-ключ для CI: отдельный ed25519 (не тот же, что личные ключи!)
# публичный -> /srv/pushka/.ssh/authorized_keys (владелец pushka, права 700/600)
# приватный -> GitHub Secret DEPLOY_SSH_KEY
# host key -> `ssh-keyscan -t ed25519 <host>` -> GitHub Secret DEPLOY_HOST_KEY
# узкий sudo — только рестарт сервиса:
echo 'pushka ALL=(root) NOPASSWD: /usr/bin/systemctl restart pushka' \
  > /etc/sudoers.d/pushka-deploy
chmod 440 /etc/sudoers.d/pushka-deploy
```

Первый релиз в `releases/` и симлинк `current` создаёт сам workflow при первом запуске —
вручную ничего катить не нужно (кроме `.env` в `data/`, которого первый деплой ждёт).

## Ручной деплой (fallback, если CI/CD недоступен)

```bash
npm ci --omit=dev

SHA=$(git rev-parse --short=12 HEAD)
ssh pushka@188.225.37.62 "mkdir -p /srv/pushka/releases/$SHA"
rsync -az src node_modules package.json package-lock.json \
  pushka@188.225.37.62:/srv/pushka/releases/$SHA/
ssh pushka@188.225.37.62 "
  ln -sfn /srv/pushka/data/.env /srv/pushka/releases/$SHA/.env &&
  ln -sfn /srv/pushka/data/notifications.db /srv/pushka/releases/$SHA/notifications.db &&
  ln -sfn /srv/pushka/releases/$SHA /srv/pushka/current &&
  sudo systemctl restart pushka
"
```

## Откат

Симлинк `current` держит последний релиз, предыдущие пять остаются в `releases/`. Откат —
переключить симлинк на нужный релиз и перезапустить сервис, без пересборки:

```bash
ssh pushka@188.225.37.62 "
  ln -sfn /srv/pushka/releases/<sha-of-known-good> /srv/pushka/current &&
  sudo systemctl restart pushka
"
```

## Логи

```bash
sudo journalctl -u pushka -f
```

## Сертификат Let's Encrypt

```bash
sudo certbot certonly --webroot -w /var/www/html -d pushka.mvladt.ru
```

Метод `webroot` — домен терминирует TLS на `127.0.0.1:8443` за Xray Reality fallback, а конфиг
лежит в `/etc/nginx/conf.d/` (не в `sites-enabled/`), поэтому `--nginx`-плагин может отредактировать
не тот файл. `:80`-блок в `nginx/pushka.conf` отдаёт `/.well-known/acme-challenge/` из
`/var/www/html` — общий webroot для всех доменов на сервере. Автопродление — через cron/certbot
timer, настроенный системно.
