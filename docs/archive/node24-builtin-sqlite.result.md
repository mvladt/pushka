# Результат: переход на Node 24 и встроенный node:sqlite

## Что сделано

- `src/sqliteStore/store.ts`: `better-sqlite3` → `node:sqlite` (`DatabaseSync`). `db.transaction(fn)`
  заменён на ручной `BEGIN`/`COMMIT`/`ROLLBACK` в `deleteMany` — у `DatabaseSync` нет `.transaction()`.
- `package.json`: убраны `better-sqlite3` и `@types/better-sqlite3`; `engines.node` поднят до
  `>= 24.0.0`.
- `npm install` — минус 34 пакета (нативный биндинг и его транзитивные зависимости).
- `.github/workflows/ci.yml`: `node-version` в job'ах `test` и `e2e` — `22` → `24`.
- `CLAUDE.md`, `README.md`: обновлено требование к версии Node.
- `docs/cicd.plan.md`: актуализированы упоминания версии Node (systemd `ExecStart`, ответ на
  открытый вопрос C, шаг 1.2), добавлен пункт про установку Node 24 на сервере в этап 2.1 —
  сервер сейчас на v22.20, деплой этой версии кода туда ещё не выполнялся.
- `docs/eslint-prettier.task.md`: поправлено упоминание версии Node.

## Проверка

Локально установлен и активирован Node 24.18.0 (LTS) через nvm. Прогнано на Node 24:

- `npx tsc` — чисто.
- `npm run test:sqliteStore` — 9/9, включая `removeMany` (проверяет транзакцию).
- `npm run test:env` — 2/2.
- `npm run test:integration` — 5/5.
- `npm run test:playwright` — 1/1.

На Node 24 `node:sqlite` не выводит `ExperimentalWarning` (в отличие от 22.x с тем же кодом).

## Не проверено / не сделано

- Прод-сервер не трогали: там всё ещё установлен только Node v22.20, `better-sqlite3` там пока не
  использовался в бою (стадия 2 плана `cicd.plan.md` — systemd-юнит — ещё не начата). Установка
  Node 24 на сервере — теперь явный пункт этапа 2.1.
