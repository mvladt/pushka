# Результат: добавление ESLint и Prettier

## Что сделано

- `eslint.config.js` — flat config: `@eslint/js` recommended + `typescript-eslint` recommended
  (не type-checked). Отдельный override для `src/client/sw.js` (браузерный service worker, глобал
  `self`).
- `.prettierrc.json` — `printWidth: 100`, остальное по дефолту.
- `.prettierignore` — `package-lock.json`, `*.md`, `data`, `.claude` (локальный, глобально
  гитигнорен).
- `package.json`: скрипты `lint` (`eslint .`), `format` (`prettier --write .`),
  `format:check` (`prettier --check .`), `prepare` (`simple-git-hooks || true`).
- Pre-commit хук через `simple-git-hooks` (`npm run lint && npm run format:check`) —
  устанавливается `prepare`-скриптом, не встроенным `postinstall` пакета (npm 11+ по умолчанию
  блокирует install-скрипты зависимостей). `|| true` — иначе `deploy.yml` (`npm ci --omit=dev`)
  падал бы: без dev-зависимостей бинаря `simple-git-hooks` нет, `prepare` всё равно запускается.
- `.github/workflows/ci.yml`: в job `test` добавлены шаги `Lint` и `Форматирование` (после
  `Typecheck`, перед тестами).
- По ходу правки под `no-explicit-any`: `Logger.log`/`Logger.error` — `any[]` → `unknown[]`;
  `NotificationEntity.payload` — `any` → `unknown`; `app.ts` — `server.address() as any` →
  `server.address() as AddressInfo` (импорт из `node:net`).
- Автофикс `eslint --fix` + `prettier --write .` по всему репозиторию (16 файлов, только
  форматирование — переносы строк, кавычки, отступы; логика не менялась).

## Коммиты

Разбито на 5 отдельных коммитов (конфиг → ручные фиксы `any` → автофикс → CI → pre-commit хук) —
по риску «шумные авто-фиксы» из задачи: авто-форматирование отделено от смысловых правок.

## Проверка

На Node 24.18.0 (через nvm, локально установлен 22.18.0 — не хватает для `node:sqlite`):

- `npx eslint .` — чисто.
- `npx prettier --check .` — чисто.
- `npx tsc` — чисто.
- `npm run test:env`, `test:sqliteStore`, `test:integration` — все зелёные, после автофикса
  поведение не изменилось.
- Pre-commit хук проверен на практике — реально отработал перед последним коммитом задачи.
- `npm ci --omit=dev` (путь `deploy.yml`) — проверено отдельно: без фикса `prepare` падал
  (`simple-git-hooks: not found`, exit 127), с `|| true` проходит, хук просто не ставится.
  Обычный `npm ci` (с dev-зависимостями) — хук по-прежнему ставится и работает.

## Не проверено / не сделано

- `npm run test:playwright` не гонялся (не требуется для этой задачи, автофикс не трогал логику).
- Обнаружена низкоприоритетная npm-уязвимость (`body-parser`, low, через `express`) — не связана
  с этой задачей, не устранялась.
