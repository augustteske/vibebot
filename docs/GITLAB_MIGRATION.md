# GitLab — перенос завершён

Основной репозиторий: https://gitlab.com/shertwg-group1/vibebot
Видимость при создании: Private. Project ID: 88326699.

История и шесть веток загружены и проверены через git ls-remote:
- main
- develop
- feat/august-core — сохранённая серверная версия
- feat/ilian-checkin
- feat/arina-actions
- feat/alisa-insights-demo

Локальный origin указывает на GitLab. Прежний GitHub сохранён как remote github. В main/develop пока первоначальная демонстрационная версия; серверная итерация находится в ветке Августа и должна попасть в develop через merge request.

GitLab CI и шаблон MR подготовлены в ветке Августа. Результат удалённого pipeline пока не проверен. Локально 14 тестов и production-сборка прошли.

Осталось: проверить pipeline, создать/просмотреть MR в develop, выдать доступ ребятам по точным GitLab-логинам. Приглашения пока не отправлены.

Для нового клонирования:
```sh
git clone https://gitlab.com/shertwg-group1/vibebot.git
cd vibebot
git switch feat/august-core
npm ci
npm run dev
```