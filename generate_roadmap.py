import os
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def register_cyrillic_fonts():
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if os.path.exists(regular):
            pdfmetrics.registerFont(TTFont("CyrFont", regular))
            if os.path.exists(bold):
                pdfmetrics.registerFont(TTFont("CyrFont-Bold", bold))
            else:
                pdfmetrics.registerFont(TTFont("CyrFont-Bold", regular))
            return "CyrFont", "CyrFont-Bold"
    return "Helvetica", "Helvetica-Bold"


def create_pdf(filename):
    font_regular, font_bold = register_cyrillic_fonts()
    c = canvas.Canvas(filename, pagesize=A4)
    width, height = A4

    # Титульная страница (тёмный минимализм в стиле opencode.ai + 3D-маскот Vibee)
    c.setFillColor(colors.HexColor("#171719"))
    c.rect(0, 0, width, height, fill=1, stroke=0)

    # Жёлтая акцентная полоса сверху
    c.setFillColor(colors.HexColor("#FFD638"))
    c.rect(0, height - 8, width, 8, fill=1, stroke=0)

    mascot_path = Path("public/bee-mascot.png")
    if mascot_path.exists():
        img_size = 180
        c.drawImage(
            str(mascot_path),
            (width - img_size) / 2,
            height - 310,
            width=img_size,
            height=img_size,
            mask="auto",
            preserveAspectRatio=True,
        )

    c.setFillColor(colors.HexColor("#FFD700"))
    c.setFont(font_bold, 38)
    c.drawCentredString(width / 2, height - 370, "Vibee Roadmap")

    c.setFillColor(colors.white)
    c.setFont(font_regular, 16)
    c.drawCentredString(width / 2, height - 405, "План развития продукта и чек-лист из 43 задач")

    c.setFillColor(colors.HexColor("#9CA3AF"))
    c.setFont(font_regular, 11)
    c.drawCentredString(width / 2, height - 435, "Почувствовать команду. Сделать следующий шаг. · Приватность по умолчанию")

    # Легенда статусов на обложке
    c.setStrokeColor(colors.HexColor("#2E2E34"))
    c.setFillColor(colors.HexColor("#202024"))
    c.roundRect(70, 120, width - 140, 110, 10, fill=1, stroke=1)

    c.setFont(font_bold, 11)
    c.setFillColor(colors.HexColor("#FFD638"))
    c.drawString(90, 205, "Легенда статусов в чек-листе:")

    c.setFont(font_regular, 10)
    c.setFillColor(colors.HexColor("#22C55E"))
    c.drawString(90, 182, "[V] Зелёный — выполнено или заложено в ядро MVP")
    c.setFillColor(colors.HexColor("#E5E7EB"))
    c.drawString(90, 162, "[ ] Тёмный — в плане реализации (отсортировано по сложности S -> M -> L -> XL)")
    c.setFillColor(colors.HexColor("#EF4444"))
    c.drawString(90, 142, "[X] Красный — отменено / отложено (риск слежки, деанонимизации или раздувания бюджета)")

    c.showPage()

    # Внутренние страницы со списком из 43 пунктов
    items = [
        # Сложность S
        ("done", "35. Оформление README на GitHub [V] — Сложность: S (Выполнено)"),
        ("done", "24. Кнопка «показать пароль» (SecretField) [V] — Сложность: S (Выполнено в TeamWorkspace)"),
        ("done", "14. Как собираются данные по перепискам (стриминг + TTL 15 мин) [V] — Сложность: S (В ядре)"),
        ("todo", "25. Шрифты: Roboto и парный шрифт (JetBrains Mono) [ ] — Сложность: S (MVP)"),
        ("todo", "13. Экраны ошибок и отсутствия соединения [ ] — Сложность: S (MVP)"),
        ("todo", "10. Анимации и плавность (диагональный блик на кнопках) [ ] — Сложность: S (MVP)"),
        ("todo", "20. Раскрывающиеся пояснения на карточках (<details>) [ ] — Сложность: S (MVP)"),
        ("todo", "21. Светлая и тёмная тема [ ] — Сложность: S (MVP)"),
        ("todo", "26. Окна обратной связи (объединено с п. 37) [ ] — Сложность: S (MVP)"),
        ("todo", "1. Кнопка очистки чата с ботом (Clean сессии) [ ] — Сложность: S (Следующий релиз)"),
        ("risk", "7. Картинки к вопросам в Telegram-боте [X] — Сложность: S (Отложено: замедляет быстрый чек-ин)"),
        # Сложность M
        ("todo", "23. Дизайн-концепция: меньше болтовни, больше дела (opencode.ai) [ ] — Сложность: M (MVP)"),
        ("todo", "31. ДНК проекта (объединено с п. 34 в BRAND.md) [ ] — Сложность: M (MVP)"),
        ("todo", "34. Философия, цели и тезисы проекта [ ] — Сложность: M (MVP)"),
        ("todo", "22. Онбординг в две кнопки и ключ комнаты + Telegram Mini App [ ] — Сложность: M (MVP)"),
        ("todo", "29. Оптимизация всего (code-splitting, prefers-reduced-motion) [ ] — Сложность: M (MVP)"),
        ("todo", "36. Серверная часть, домен, хранение данных (VPS ~$5/мес + SQLite WAL) [ ] — Сложность: M (MVP)"),
        ("todo", "3. Кабинет тимлида: интерактивная аналитика и вкладки периодов [ ] — Сложность: M (Следующий релиз)"),
        ("todo", "2. Мультиязычность (RU + EN на старт, затем ES/FR/DE) [ ] — Сложность: M (Следующий релиз)"),
        ("todo", "17. Три режима общения («Классик», «Ми-ми-ми», «Правдарубка») [ ] — Сложность: M (Следующий релиз)"),
        ("risk", "12. Новогоднее оформление [X] — Сложность: M (Отложено до декабря)"),
        ("risk", "30. Стильный десктопный установщик [X] — Сложность: M (Отложено: заменён на веб/PWA без SmartScreen)"),
        # Сложность L
        ("done", "11. Не должно ощущаться как слежка (k-анонимность >= 5, авто-TTL) [V] — Сложность: L (Ядро MVP)"),
        ("todo", "41. Юридическая составляющая целиком (минимизация ПДн, оферта) [ ] — Сложность: L (MVP)"),
        ("todo", "18. Кризисы продукта (защита от ухода в теневые чаты через пользу команде) [ ] — Сложность: L (MVP)"),
        ("todo", "40. Стратегия роста и удержания (open-source доверие, шаринг пульса) [ ] — Сложность: L (MVP)"),
        ("todo", "32. Оформление сайта: ссылки на GitHub, проблема-решение, гайд [ ] — Сложность: L (MVP)"),
        ("todo", "37. «Помогите проекту стать лучше» [ ] — Сложность: L (Следующий релиз)"),
        ("todo", "8. Регистрация и OAuth (GitHub/Google/Яндекс только для тимлидов) [ ] — Сложность: L (Следующий релиз)"),
        ("todo", "4. Безопасные командные метрики и тренды без деанонимизации [ ] — Сложность: L (Следующий релиз)"),
        ("done", "39. Поддержка всех операционных систем (через Web PWA / Telegram / Docker) [V] — Сложность: L (Готово)"),
        ("todo", "15. Платные функции (Open-Core / Pro-тариф позже) [ ] — Сложность: L (Позже)"),
        ("risk", "16. Детект мата при ревью [X] — Сложность: L (Отложено: риск токсичности и деанонимизации)"),
        ("risk", "19. Встраивание в Git-репозиторий [X] — Сложность: L (Отложено: воспринимается как микроменеджмент)"),
        ("risk", "33. Собственный саунд-дизайн [X] — Сложность: L (Отложено: лишний шум в рабочем инструменте)"),
        ("risk", "38. Расширение для браузера [X] — Сложность: L (Отменено: вызывает страх слежки за вкладками)"),
        ("risk", "9. Запись аудио/видеоконференций [X] — Сложность: L (ОТМЕНЕНО: прямое нарушение п. 11 о доверии)"),
        # Сложность XL
        ("todo", "0. Демо-блок на главной в стиле opencode.ai (живая UI-симуляция) [ ] — Сложность: XL (MVP)"),
        ("todo", "28. Мобильная версия и адаптивность (PWA + Telegram Mini App, 360px+) [ ] — Сложность: XL (MVP)"),
        ("todo", "6. Работа с несколькими командами и переходами между ними [ ] — Сложность: XL (Позже, v2)"),
        ("risk", "27. Публикация в Google Play и App Store [X] — Сложность: XL (Отложено в пользу PWA / TMA)"),
        ("risk", "5b. Генерация скинов нейросетью с цензурой и сбор ФИО/телефона [X] — Сложность: XL (ОТМЕНЕНО: ПДн + GPU)"),
        ("risk", "5a. Обучение бота на диалогах пользователей [X] — Сложность: XL (ОТМЕНЕНО: разрушает доверие и NDA)"),
    ]

    def draw_header(page_num):
        c.setFillColor(colors.HexColor("#171719"))
        c.rect(0, height - 55, width, 55, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#FFD638"))
        c.setFont(font_bold, 13)
        c.drawString(40, height - 34, "Vibee — Чек-лист и дорожная карта (43 пункта по сложности)")
        c.setFillColor(colors.HexColor("#9CA3AF"))
        c.setFont(font_regular, 10)
        c.drawRightString(width - 40, height - 34, f"Стр. {page_num}")

    page_num = 2
    draw_header(page_num)
    y = height - 80

    for status, text in items:
        if y < 50:
            c.showPage()
            page_num += 1
            draw_header(page_num)
            y = height - 80

        if status == "done":
            c.setFillColor(colors.HexColor("#15803D"))
            c.setFont(font_bold, 9.5)
        elif status == "risk":
            c.setFillColor(colors.HexColor("#DC2626"))
            c.setFont(font_regular, 9.5)
        else:
            c.setFillColor(colors.HexColor("#18181B"))
            c.setFont(font_regular, 9.5)

        c.drawString(40, y, text)
        y -= 16

    c.save()
    print(f"PDF создан: {filename}")


if __name__ == "__main__":
    create_pdf("Vibee_Roadmap.pdf")
