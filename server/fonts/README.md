# Шрифт карточки «Пульс команды»

Inter — тот же шрифт, что в интерфейсе (`--vibee-font` в `src/index.css`).

- Файлы: `inter-semibold.ttf` (600) и `inter-extrabold.ttf` (800), Inter v20, латиница + кириллица.
- Источник: Google Fonts (`https://fonts.googleapis.com/css2?family=Inter:wght@600;800`).
- Лицензия: SIL Open Font License 1.1 — `OFL.txt` рядом, менять файлы нельзя, распространять можно только вместе с лицензией.

Сервер читает шрифт напрямую (`server/truetype.mjs`) и рисует текст без сторонних библиотек.
Если понадобится другой вес, положите файл сюда и подключите его в `server/share-card.mjs`.
