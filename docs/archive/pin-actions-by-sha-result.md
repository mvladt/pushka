# Результат: закрепление GitHub Actions по SHA

## Что сделано

Все `uses:` в `.github/workflows/ci.yml` и `.github/workflows/deploy.yml` переведены с тега на
полный SHA коммита, с комментарием версии для читаемости:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
```

SHA получены через `gh api repos/<owner>/<repo>/tags` — сопоставили тег `v7` с конкретным
патч-релизом (`checkout` → v7.0.1, `setup-node` → v7.0.0, `upload-artifact` → v7.0.1).

## Проверка

`npx prettier --check .github/workflows/*.yml` — зелёный, комментарии в YAML не ломают
форматирование.

## Дальнейшая поддержка

Dependabot (`.github/dependabot.yml`, экосистема `github-actions`) сам открывает PR при выходе
новой версии экшена — обновляет и SHA, и комментарий с версией. Ручного отслеживания не
требуется.
