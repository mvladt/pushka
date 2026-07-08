# План: переименование webpush-scheduler → Pushka

## Содержание

- [Контекст](#контекст)
- [Этап 1. Код и репозиторий (низкий риск, обратимо)](#этап-1-код-и-репозиторий-низкий-риск-обратимо)
- [Этап 2. Домен и TLS](#этап-2-домен-и-tls)
- [Этап 3. Сервер: пользователь, каталоги, systemd, nginx](#этап-3-сервер-пользователь-каталоги-systemd-nginx)
- [Этап 4. CD-workflow и передеплой](#этап-4-cd-workflow-и-передеплой)
- [Этап 5. Обновить server-management](#этап-5-обновить-server-management)
- [Этап 6. Косметика в проекте](#этап-6-косметика-в-проекте)
- [Файлы для создания/изменения](#файлы-для-созданияизменения)
- [Открытые вопросы](#открытые-вопросы)

---

## Контекст

Имя `webpush-scheduler` → **Pushka** (репозиторий, каталог, npm-пакет, системный
пользователь/сервис на сервере, домен). Заодно это закрывает отдельную старую жалобу — «URL
слишком длинный» (`scheduler.push.mvladt.ru`): новый домен `pushka.mvladt.ru` короче и совпадает
с брендом.

Переименование затрагивает три репозитория (`webpush-scheduler`, `server-management` — как
внешнего наблюдателя, `dexity` не затрагивается, там ссылок на webpush-scheduler нет) и живой
прод-сервер. Самый рискованный шаг — этап 3 (переименование юзера/systemd/nginx на сервере),
там неизбежен даунтайм на несколько минут — делать сознательно, не «между делом».

CLI/MCP-инструмент поверх Pushka (agent-friendly curl/CLI, обсуждали отдельно) — **не в скоупе
этого плана**, это следующая отдельная задача после переименования.

---

## Этап 1. Код и репозиторий (низкий риск, обратимо)

- [ ] `package.json` — `"name": "pushka"`.
- [ ] `docker-compose.yml` — переименовать сервис `webpush-scheduler` → `pushka` (сам файл не
      используется в CD, но упоминание старого имени стоит убрать заодно).
- [ ] `README.md` и `CLAUDE.md` (`## Обзор проекта`) — заменить название/описание на Pushka.
- [ ] Переименовать репозиторий на GitHub: `gh repo rename pushka` (из директории репо, или
      `--repo mvladt/webpush-scheduler`). GitHub сам держит редирект со старого имени на новое —
      старые `git clone`/ссылки не ломаются сразу, но не вечно.
- [ ] Обновить локальный remote: `git remote set-url origin git@github.com:mvladt/pushka.git`.
- [ ] Переименовать локальный каталог: `mv ~/Projects/MyOwn/webpush-scheduler ~/Projects/MyOwn/pushka`.
- [ ] GitHub Secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY`) — переносить не нужно, остаются
      привязаны к репозиторию при рейнейме.

## Этап 2. Домен и TLS

- [ ] Решить, что с текущим `scheduler.push.mvladt.ru` — см. «Открытые вопросы», п.1.
- [ ] DNS: A-запись `pushka.mvladt.ru` → `188.225.37.62`.
- [ ] Выпустить сертификат: `certbot certonly --webroot -w /var/www/html -d pushka.mvladt.ru`.
- [ ] VAPID-ключи **не трогать** — `VAPID_SUBJECT` в `.env` это `mailto:`, не URL, от домена не
      зависит. Смена домена не требует новых ключей и не рвёт существующие push-подписки
      напрямую (подписка привязана к push-сервису — FCM, — не к origin страницы).

## Этап 3. Сервер: пользователь, каталоги, systemd, nginx

Даунтайм на несколько минут, делать одним заходом по SSH.

- [ ] Остановить сервис: `systemctl stop webpush-scheduler`.
- [ ] Переименовать системного пользователя с сохранением `uid` (994) и переносом `$HOME`
      (значит, `.ssh/authorized_keys` переедет вместе с ним автоматически):
  ```sh
  usermod -l pushka webpush-scheduler
  usermod -d /srv/pushka -m pushka
  groupmod -n pushka webpush-scheduler
  ```
- [ ] Проверить, что каталог физически переехал и `authorized_keys` на месте:
      `ls -la /srv/pushka/.ssh/`.
- [ ] Новый systemd-юнит `/etc/systemd/system/pushka.service` (копия старого,
      `User=pushka`, `WorkingDirectory=/srv/pushka/current`):
      `systemctl daemon-reload`, `systemctl disable webpush-scheduler`,
      удалить старый файл юнита, `systemctl enable pushka` (не `--now` — стартует деплоем).
- [ ] Переименовать sudoers: `/etc/sudoers.d/webpush-scheduler-deploy` →
      `/etc/sudoers.d/pushka-deploy`, команда — `systemctl restart pushka`.
- [ ] nginx: новый `/etc/nginx/conf.d/pushka.conf` (`server_name pushka.mvladt.ru`,
      `proxy_pass http://127.0.0.1:3002` — порт можно не менять). Судьба старого конфига —
      см. «Открытые вопросы», п.1. `nginx -t && systemctl reload nginx`.

## Этап 4. CD-workflow и передеплой

- [ ] `.github/workflows/deploy.yml`:
      SSH-пользователь `pushka@188.225.37.62`, путь `rsync ... /srv/pushka/releases/$SHA/`,
      `sudo systemctl restart pushka`, health-check `https://pushka.mvladt.ru/api/health`.
- [ ] `deploy/webpush-scheduler.service` → переименовать файл в `deploy/pushka.service`,
      обновить `User=`/`WorkingDirectory=` внутри.
- [ ] `nginx/webpush-scheduler.conf` → `nginx/pushka.conf`, обновить `server_name`.
- [ ] `deploy/README.md` — обновить все пути (`/srv/webpush-scheduler` → `/srv/pushka`) и имя
      пользователя/сервиса.
- [ ] Запустить `workflow_dispatch`, убедиться, что первый деплой под новым именем прошёл и
      health-check зелёный.

## Этап 5. Обновить server-management

- [ ] `CLAUDE.md` — таблица сервисов/приложений: `webpush-scheduler` → `pushka`, домен →
      `pushka.mvladt.ru`.
- [ ] `server-spb.md` — то же самое в снапшоте состояния сервера.

## Этап 6. Косметика в проекте

- [ ] `src/client/index.html` — заголовок страницы «Web Push — Клиент» → «Pushka» (опционально,
      не блокирует остальное).
- [ ] `docs/sqlite-migrations.task.md`, `docs/sqlite-backup.task.md` — обновить упомянутые
      серверные пути (`/srv/webpush-scheduler/...` → `/srv/pushka/...`).
- [ ] Архивные `docs/cicd.plan.md` / `docs/cicd.result.md` / `docs/cicd.task.md` — **не трогать**,
      это исторический протокол того, что происходило под старым именем.

---

## Файлы для создания/изменения

| Действие  | Файл                                                 | Этап |
| --------- | ----------------------------------------------------- | ---- |
| Изменить  | `package.json`, `docker-compose.yml`                  | 1    |
| Изменить  | `README.md`, `CLAUDE.md`                               | 1    |
| Изменить  | `.github/workflows/deploy.yml`                         | 4    |
| Переименовать | `deploy/webpush-scheduler.service` → `deploy/pushka.service` | 4 |
| Переименовать | `nginx/webpush-scheduler.conf` → `nginx/pushka.conf`  | 4    |
| Изменить  | `deploy/README.md`                                     | 4    |
| Изменить  | `docs/sqlite-migrations.task.md`, `docs/sqlite-backup.task.md` | 6 |
| Изменить (на сервере) | системный пользователь + `$HOME`           | 3    |
| Создать/удалить (на сервере) | `/etc/systemd/system/pushka.service` (+ удалить старый) | 3 |
| Создать/удалить (на сервере) | `/etc/sudoers.d/pushka-deploy` (+ удалить старый) | 3 |
| Создать (на сервере) | `/etc/nginx/conf.d/pushka.conf` + TLS-сертификат | 2, 3 |
| Изменить  | `~/Projects/MyOwn/server-management/CLAUDE.md`, `server-spb.md` | 5 |

---

## Открытые вопросы

1. **Что делать со старым доменом `scheduler.push.mvladt.ru`?**
   - Снести сразу вместе со старым nginx-конфигом — просто и чисто, но если кто-то (в том числе
     сам пользователь с другого устройства) держит открытой старую страницу/PWA, она перестанет
     работать без предупреждения.
   - Оставить старый домен как алиас (тот же nginx-блок, два `server_name`, оба ведут на тот же
     бэкенд) на переходный период — безопаснее, чуть больше возни, требует отдельного решения,
     когда всё-таки снести.
   - Решение не принято, нужен ответ пользователя.

2. **Кто вообще пользуется приложением кроме самого пользователя?** Если это чисто личный
   проект и подписчик только один (сам pользователь) — риск пункта 1 практически нулевой, можно
   просто снести старое и переподписаться заново за минуту. Если есть другие живые подписчики —
   вариант с алиасом становится обязательным, не опциональным.

3. **Порт (сейчас 3002)** — менять не планируется (нет конфликта, нет причины), но фиксируем
   явно, чтобы не забыть при правке nginx/systemd.

4. **CLI/MCP-обвязка вокруг Pushka** (agent-friendly, curl-friendly) — отдельная задача,
   после переименования, не смешивать с этим планом.
