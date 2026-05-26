# Результат: удалить Docker-тесты

## Что сделано

- Удалена папка `testsDocker/` целиком (внутри был `base.test.ts`)
- Удалён скрипт `test-docker.sh`
- Из `package.json` убран npm-скрипт `test:docker`
- `README.md` и `CLAUDE.md` упоминаний не содержали — правки не потребовались

## Что осталось

`Dockerfile` и `docker-compose.yml` не тронуты — используются для деплоя.
