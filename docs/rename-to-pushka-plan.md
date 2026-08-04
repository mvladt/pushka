# План: переименование webpush-scheduler → Pushka

## Содержание

- [Контекст](#контекст)
- [Этап 1. Код и репозиторий (низкий риск, обратимо)](#этап-1-код-и-репозиторий-низкий-риск-обратимо)
- [Этап 2. Домен и TLS](#этап-2-домен-и-tls)
- [Этап 3. Сервер: пользователь, каталоги, systemd, nginx](#этап-3-сервер-пользователь-каталоги-systemd-nginx)
- [Этап 4. CD-workflow и передеплой](#этап-4-cd-workflow-и-передеплой)
- [Этап 5. Обновить внешние проекты (server-management, my-site-2)](#этап-5-обновить-внешние-проекты-server-management-my-site-2)
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

- [x] `package.json` — `"name": "pushka"`.
- [x] `docker-compose.yml` — переименовать сервис `webpush-scheduler` → `pushka` (сам файл не
      используется в CD, но упоминание старого имени стоит убрать заодно).
- [x] `README.md` и `CLAUDE.md` (`## Обзор проекта`) — заменить название/описание на Pushka.
- [x] Переименовать репозиторий на GitHub: `gh repo rename pushka` (из директории репо, или
      `--repo mvladt/webpush-scheduler`). GitHub сам держит редирект со старого имени на новое —
      старые `git clone`/ссылки не ломаются сразу, но не вечно.
- [x] Обновить локальный remote: `git remote set-url origin git@github.com:mvladt/pushka.git`.
- [x] Переименовать локальный каталог: `mv ~/Projects/MyOwn/webpush-scheduler ~/Projects/MyOwn/pushka`.
- [x] GitHub Secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY`) — переносить не нужно, остаются
      привязаны к репозиторию при рейнейме.

## Этап 2. Домен и TLS

- [x] Решить, что с текущим `scheduler.push.mvladt.ru` — см. «Открытые вопросы», п.1.
- [x] DNS: A-запись `pushka.mvladt.ru` → `188.225.37.62`.
- [x] Выпустить сертификат: `certbot certonly --webroot -w /var/www/html -d pushka.mvladt.ru`.
- [x] VAPID-ключи **не трогать** — `VAPID_SUBJECT` в `.env` это `mailto:`, не URL, от домена не
      зависит. Смена домена не требует новых ключей и не рвёт существующие push-подписки
      напрямую (подписка привязана к push-сервису — FCM, — не к origin страницы).

## Этап 3. Сервер: пользователь, каталоги, systemd, nginx

Даунтайм несколько секунд, сделано одним заходом по SSH (скриптом).

- [x] Бэкап БД перед началом: `/root/notifications.db.bak.<timestamp>` (бэкапов до этого не
      было вообще, см. `docs/sqlite-backup-task.md`).
- [x] Остановить сервис: `systemctl stop webpush-scheduler`, проверено что процессов
      пользователя не осталось (`pgrep -u webpush-scheduler`).
- [x] Переименовать системного пользователя с сохранением `uid` (994) и переносом `$HOME`
      (значит, `.ssh/authorized_keys` переехал вместе с ним автоматически):
  ```sh
  usermod -l pushka webpush-scheduler
  usermod -d /srv/pushka -m pushka
  groupmod -n pushka webpush-scheduler
  ```
- [x] Проверено, что каталог физически переехал и `authorized_keys` на месте:
      `ls -la /srv/pushka/.ssh/`.
- [x] **Найден и закрыт пробел плана**: `current` и `.env`/`notifications.db` во всех трёх
      релизах — абсолютные симлинки на `/srv/webpush-scheduler/...`, `usermod -m` их не
      перезаписывает → после переезда они дохлые. Все 7 симлинков автоматически перелинкованы
      на `/srv/pushka/...`, проверено что дохлых (`find -xtype l`) не осталось.
- [x] Новый systemd-юнит `/etc/systemd/system/pushka.service` (копия старого,
      `User=pushka`, `WorkingDirectory=/srv/pushka/current`):
      `systemctl daemon-reload`, `systemctl disable webpush-scheduler`,
      старый файл юнита удалён.
- [x] Переименован sudoers: `/etc/sudoers.d/webpush-scheduler-deploy` →
      `/etc/sudoers.d/pushka-deploy`, команда — `systemctl restart pushka`, провалидирован
      `visudo -cf` перед применением.
- [x] Сервис запущен вручную: `systemctl enable --now pushka` (не через деплой — CI ещё
      нацелен на старое имя пользователя/пути до Этапа 4). Порт 3002 слушается, оба домена
      (`pushka.mvladt.ru`, `scheduler.push.mvladt.ru`) отвечают 200 сразу после переключения.
- [x] nginx: новый `/etc/nginx/conf.d/pushka.conf` (`server_name pushka.mvladt.ru`,
      `proxy_pass http://127.0.0.1:3002` — порт можно не менять). Судьба старого конфига —
      см. «Открытые вопросы», п.1. `nginx -t && systemctl reload nginx`. **Сделано заранее**
      (до пользователя/systemd), отдельным файлом, старый `webpush-scheduler.conf` не тронут.

**Важно, пока не сделан Этап 4:** CI-деплой (`deploy.yml`) сейчас нацелен на старое имя
пользователя/пути (`webpush-scheduler@...`, `/srv/webpush-scheduler`) — деплой в этом
промежутке **не запускать**, сразу переходить к Этапу 4.

## Этап 4. CD-workflow и передеплой

- [x] `.github/workflows/deploy.yml`:
      SSH-пользователь `pushka@188.225.37.62`, путь `rsync ... /srv/pushka/releases/$SHA/`,
      `sudo systemctl restart pushka`, health-check `https://pushka.mvladt.ru/api/health`.
- [x] `deploy/webpush-scheduler.service` → переименован в `deploy/pushka.service`,
      обновлены `User=`/`WorkingDirectory=` внутри.
- [x] `nginx/webpush-scheduler.conf` → `nginx/pushka.conf`, обновлён `server_name` и пути к
      сертификату.
- [x] `deploy/README.md` — обновлены все пути (`/srv/webpush-scheduler` → `/srv/pushka`) и имя
      пользователя/сервиса. Заодно поправлены оставшиеся упоминания старого домена в
      `README.md` и `/srv/webpush-scheduler` в `CLAUDE.md`.
- [x] Запущен `workflow_dispatch` (run `29097496312`), деплой прошёл зелёным за 23с, релиз
      `9c185a2` реально переключился (`/srv/pushka/current`), health-check `pushka.mvladt.ru`
      и `scheduler.push.mvladt.ru` — оба 200.

## Этап 5. Обновить внешние проекты (server-management, my-site-2)

- [x] `server-management/CLAUDE.md` — таблица сервисов/приложений: `webpush-scheduler` →
      `pushka`, домен → `pushka.mvladt.ru`, старый домен оставлен отдельной строкой как алиас.
- [x] `server-management/server-spb.md` — то же самое в снапшоте состояния сервера, плюс
      сертификат `pushka.mvladt.ru` добавлен в таблицу SSL.
- [x] ~~`my-site-2/index.html:37`~~ / ~~`my-site-2/docs/deploy-vps-task.md:138`~~ — проект
      `my-site-2` брошен/удалён (не найден ни локально, ни на GitHub на момент проверки),
      пункт пропущен по решению пользователя.
- [ ] `webpush-dumb-client` — **сознательно не трогаем**, вне скоупа этого плана (там реальная
      зависимость от `VITE_API_URL=https://scheduler.push.mvladt.ru/api`, но решили разобраться
      отдельно).

## Этап 6. Косметика в проекте

- [ ] `src/client/index.html` — заголовок страницы «Web Push — Клиент» → «Pushka» (опционально,
      не блокирует остальное).
- [ ] `docs/sqlite-migrations-task.md`, `docs/sqlite-backup-task.md` — обновить упомянутые
      серверные пути (`/srv/webpush-scheduler/...` → `/srv/pushka/...`).
- [ ] Архивные `docs/archive/cicd-plan.md` / `cicd-result.md` / `cicd-task.md` — **не трогать**,
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
| Изменить  | `docs/sqlite-migrations-task.md`, `docs/sqlite-backup-task.md` | 6 |
| Изменить (на сервере) | системный пользователь + `$HOME`           | 3    |
| Создать/удалить (на сервере) | `/etc/systemd/system/pushka.service` (+ удалить старый) | 3 |
| Создать/удалить (на сервере) | `/etc/sudoers.d/pushka-deploy` (+ удалить старый) | 3 |
| Создать (на сервере) | `/etc/nginx/conf.d/pushka.conf` + TLS-сертификат | 2, 3 |
| Изменить  | `~/Projects/MyOwn/server-management/CLAUDE.md`, `server-spb.md` | 5 |

---

## Открытые вопросы

1. **Что делать со старым доменом `scheduler.push.mvladt.ru`?** **Решено:** оставить алиасом на
   переходный период (тот же nginx-блок, два `server_name`, оба ведут на тот же бэкенд) — учесть
   на Этапе 2/3. Снос старого домена — отдельное решение позже.

2. **Кто вообще пользуется приложением кроме самого пользователя?** Если это чисто личный
   проект и подписчик только один (сам pользователь) — риск пункта 1 практически нулевой, можно
   просто снести старое и переподписаться заново за минуту. Если есть другие живые подписчики —
   вариант с алиасом становится обязательным, не опциональным.

3. **Порт (сейчас 3002)** — менять не планируется (нет конфликта, нет причины), но фиксируем
   явно, чтобы не забыть при правке nginx/systemd.

4. **CLI/MCP-обвязка вокруг Pushka** (agent-friendly, curl-friendly) — отдельная задача,
   после переименования, не смешивать с этим планом.

5. **`webpush-dumb-client` сознательно оставлен вне скоупа.** Реальная зависимость есть
   (`.env.example: VITE_API_URL=https://scheduler.push.mvladt.ru/api`, README со ссылками и
   текстом «сервер доступен по адресу...») — задеплоенная на GitHub Pages демка сломается, если
   старый домен снести без синхронизации. Это напрямую усиливает вес варианта «оставить старый
   домен алиасом на переходный период» в п.1 — если снести сразу, `webpush-dumb-client` ломается
   молча, если решение по нему не примут отдельно и заранее.
