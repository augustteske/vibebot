# GitLab repository

Основной репозиторий Shertwg group: https://gitlab.com/shertwg-group1/vibebot. GitLab используется для merge requests и CI. GitHub сохранён как зеркало истории; ориентируйтесь на GitLab при получении актуальных изменений.

`main` — стабильная демонстрационная версия, `develop` — интеграционная. Изменения вносите в feature-ветку и отправляйте merge request в `develop`; не отправляйте напрямую в `main` или `develop`.

Для нового клонирования:

```sh
git clone https://gitlab.com/shertwg-group1/vibebot.git
cd vibebot
npm ci
npm run dev
```

Для переноса существующего checkout проверьте `git remote -v` и убедитесь, что `origin` указывает на GitLab. При необходимости GitHub можно оставить дополнительным remote для зеркалирования.
