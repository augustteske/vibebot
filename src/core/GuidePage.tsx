import { ThemeToggle } from './ThemeToggle'
import { LanguageToggle } from './LanguageToggle'
import './GuidePage.css'

export interface GuidePageProps {
  onBack: () => void
  onEnter: () => void
  onDemo: () => void
}

export function GuidePage({ onBack, onEnter, onDemo }: GuidePageProps) {
  return (
    <div className="guide-page">
      <header className="guide-header">
        <div className="guide-header__left">
          <a
            className="guide-brand"
            href="/"
            onClick={event => {
              event.preventDefault()
              onBack()
            }}
          >
            <img src="/bee.svg" alt="" />
            <span>vibee</span>
          </a>
          <button
            type="button"
            className="guide-back-link"
            onClick={onBack}
            aria-label="Вернуться назад"
          >
            ← Назад
          </button>
        </div>
        <div className="guide-header__right">
          <LanguageToggle />
          <ThemeToggle />
          <button type="button" className="guide-cta-btn" onClick={onEnter}>
            Войти в кабинет <span aria-hidden="true">→</span>
          </button>
        </div>
      </header>

      <main className="guide-main">
        <section className="guide-hero">
          <span className="guide-eyebrow">РУКОВОДСТВО ПО ПОДКЛЮЧЕНИЮ · GETTING STARTED</span>
          <h1>
            Подключите Vibee<br />
            <span>за 4 простых шага.</span>
          </h1>
          <p>
            Пошаговая инструкция для тимлидов и команд: от создания бота в Telegram до
            первого командного пульса и безопасных агрегированных метрик.
          </p>
          <div className="guide-badges">
            <span className="guide-badge">⏱ ~5 минут настройки</span>
            <span className="guide-badge">🔒 100% приватность и согласие</span>
            <span className="guide-badge">🐳 Docker & Node.js</span>
            <span className="guide-badge">🔑 Вход по ключу комнаты</span>
          </div>
        </section>

        <div className="guide-steps">
          {/* Шаг 1: Создайте бота в Telegram */}
          <article className="guide-step-card">
            <div className="guide-step-card__header">
              <span className="guide-step-num">01</span>
              <div className="guide-step-card__title">
                <h2>Шаг 1: Создайте бота в Telegram</h2>
                <p>Регистрация официального бота через @BotFather</p>
              </div>
            </div>
            <div className="guide-step-content">
              <ol>
                <li>
                  Откройте Telegram и перейдите к официальному боту{' '}
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                    <strong>@BotFather</strong>
                  </a>.
                </li>
                <li>
                  Отправьте команду <code>/newbot</code>.
                </li>
                <li>
                  Придумайте имя бота (например, <em>Командный пульс Vibee</em>) и уникальный
                  юзернейм, оканчивающийся на <code>bot</code> (например, <code>myteam_vibee_bot</code>).
                </li>
                <li>
                  BotFather пришлёт <strong>API Token</strong> формата{' '}
                  <code>123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ</code>. Скопируйте его — он
                  понадобится на шаге 2.
                </li>
                <li>
                  <em>(Рекомендуется)</em> Настройте описание через <code>/setdescription</code> и
                  аватарку через <code>/setuserpic</code>.
                </li>
              </ol>

              <div className="guide-placeholder">
                <div className="guide-placeholder__icon" aria-hidden="true">🤖</div>
                <strong>Фото: Скриншот диалога с BotFather</strong>
                <p>Здесь отображается процесс создания нового бота и получение токена API в Telegram.</p>
              </div>
            </div>
          </article>

          {/* Шаг 2: Настройте .env */}
          <article className="guide-step-card">
            <div className="guide-step-card__header">
              <span className="guide-step-num">02</span>
              <div className="guide-step-card__title">
                <h2>Шаг 2: Настройте конфигурацию (.env)</h2>
                <p>Указание токена бота и параметров безопасности</p>
              </div>
            </div>
            <div className="guide-step-content">
              <p>
                Скопируйте пример файла окружения <code>.env.example</code> в <code>.env</code> в корне
                проекта:
              </p>
              <div className="guide-code-block">
                <pre>
                  <code>
{`# 1. Токен вашего Telegram-бота (из шага 1)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# 2. Базовый адрес бэкенда для связи бота с веб-сервером
VIBEE_API_BASE_URL=http://localhost:3000/api

# 3. Секретный ключ для подписи сессий веб-кабинета
SESSION_SECRET=your-random-session-secret-key-min-32-chars

# 4. Порт веб-приложения (по умолчанию 3000)
PORT=3000`}
                  </code>
                </pre>
              </div>
              <p>
                Бот не обращается напрямую к SQLite, а взаимодействует с сервером строго по
                HTTP API, гарантируя приватность и защиту данных участников.
              </p>

              <div className="guide-placeholder">
                <div className="guide-placeholder__icon" aria-hidden="true">⚙️</div>
                <strong>Фото: Пример файла .env в редакторе кода</strong>
                <p>Настройка безопасного токена, параметров сессии и URL бэкенда.</p>
              </div>
            </div>
          </article>

          {/* Шаг 3: Запустите проект */}
          <article className="guide-step-card">
            <div className="guide-step-card__header">
              <span className="guide-step-num">03</span>
              <div className="guide-step-card__title">
                <h2>Шаг 3: Запустите проект</h2>
                <p>Запуск через Docker или локально в терминале</p>
              </div>
            </div>
            <div className="guide-step-content">
              <p><strong>Вариант А: Быстрый запуск через Docker (рекомендуется)</strong></p>
              <p>Одной командой поднимаются веб-приложение, API и Telegram-бот:</p>
              <div className="guide-code-block">
                <pre>
                  <code>docker compose up --build</code>
                </pre>
              </div>

              <p style={{ marginTop: '20px' }}>
                <strong>Вариант Б: Локальный запуск без Docker</strong>
              </p>
              <p>Для разработки и кастомизации компонентов:</p>
              <div className="guide-code-block">
                <pre>
                  <code>
{`# 1. Веб-интерфейс и API сервер
npm ci
npm run dev

# 2. Telegram-бот (в отдельном окне терминала)
python -m venv venv
# Linux / macOS:
source venv/bin/activate
# Windows:
.\\venv\\Scripts\\activate

pip install -r bot/requirements.txt
python -m bot`}
                  </code>
                </pre>
              </div>
              <p>
                После запуска откройте веб-кабинет в браузере по адресу:{' '}
                <code>http://localhost:3000</code> (или <code>http://localhost:5173</code> в dev-режиме).
              </p>

              <div className="guide-placeholder">
                <div className="guide-placeholder__icon" aria-hidden="true">💻</div>
                <strong>Фото: Терминал с успешным запуском сервисов</strong>
                <p>Логи инициализации SQLite, запуск сервера на порту 3000 и активный Telegram-поллинг.</p>
              </div>
            </div>
          </article>

          {/* Шаг 4: Подключите чат и команду */}
          <article className="guide-step-card">
            <div className="guide-step-card__header">
              <span className="guide-step-num">04</span>
              <div className="guide-step-card__title">
                <h2>Шаг 4: Подключите рабочий чат</h2>
                <p>Добавление бота в группу и приглашение участников</p>
              </div>
            </div>
            <div className="guide-step-content">
              <ol>
                <li>
                  Добавьте созданного бота в ваш рабочий групповой чат Telegram.
                </li>
                <li>
                  В веб-кабинете нажмите <strong>«Создать команду»</strong> или войдите в существующее
                  пространство.
                </li>
                <li>
                  В блоке <strong>«Пригласить коллегу»</strong> скопируйте <strong>Ключ комнаты</strong>{' '}
                  (например, <code>A1B2C3D4</code>).
                </li>
                <li>
                  Отправьте коллегам ключ комнаты — им достаточно нажать «У меня есть ключ комнаты» на
                  главной странице и вставить код.
                </li>
                <li>
                  Участники проходят добровольный чек-ин из 3 вопросов (энергия, ясность, поддержка).
                  Все метрики публикуются строго анонимными агрегатами при согласии участников.
                </li>
              </ol>

              <div className="guide-placeholder">
                <div className="guide-placeholder__icon" aria-hidden="true">👥</div>
                <strong>Фото: Добавление бота в группу и ввод ключа комнаты</strong>
                <p>Интерфейс рабочего кабинета с ключом комнаты и приглашением участников команды.</p>
              </div>
            </div>
          </article>
        </div>

        <section className="guide-faq">
          <h3>Полезные команды Telegram-бота</h3>
          <p>Бот поддерживает управление на русском и английском языках:</p>
          <div className="guide-command-grid">
            <div className="guide-command-card">
              <code>/start</code>
              <p>Главное меню сценариев и добровольный личный чек-ин</p>
            </div>
            <div className="guide-command-card">
              <code>/guide</code>
              <p>Ссылка на эту инструкцию по подключению бота</p>
            </div>
            <div className="guide-command-card">
              <code>/lang</code>
              <p>Переключение языка ответов бота (ru / en)</p>
            </div>
            <div className="guide-command-card">
              <code>/clean</code>
              <p>Удаление сообщений бота в чате (за последние 48 часов)</p>
            </div>
            <div className="guide-command-card">
              <code>/privacy</code>
              <p>Политика обработки данных и гарантии конфиденциальности</p>
            </div>
            <div className="guide-command-card">
              <code>/stop</code>
              <p>Отмена текущего черновика и отзыв согласия на сбор</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="guide-footer">
        <div className="guide-footer-links">
          <button type="button" onClick={onBack}>Главная</button>
          <button type="button" onClick={onEnter}>Войти в кабинет</button>
          <button type="button" onClick={onDemo}>Демонстрация</button>
          <a href="https://github.com/augustteske/vibebot" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <span>Vibee · Shertwg group</span>
      </footer>
    </div>
  )
}
