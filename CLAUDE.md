# BURAQ o‘quv platformasi — учебная платформа для сотрудников

Сайт: https://buraqceoassistant-ai.github.io/Buraq-learning/ · устройство, сервер и настройка — `README.md`.

Фирменный стиль — обязателен для всего видимого (цвета, шрифт, логотип, кнопки, иконки):

@buraq-brand/BRAND.md

- Цвета — токены в `lor.css` (`--navy`, `--red`, `--surface`, …); новых цветов в разметку не добавлять.
- Логотип — только файлы из `buraq-brand/logo/` (на синем — `buraq-logo-white.svg`, на светлом — `buraq-logo.svg`).
- Шрифт — Neue Montreal из `fonts/` (только латиница; кириллица — Inter), заголовки капсом обычной толщины.
- Надписи — в `strings.js`, на четырёх языках: uz (основной, латиница), ru, en, zh. Новую надпись — сразу во все четыре.
- Репозиторий открытый: тексты и тесты стандартов компании (4-bob) и персональные данные сюда не коммитить —
  они живут только на сервере (Google Apps Script, `tools/lms-gs/`).
- После правки `tools/lms-gs/Server.gs` или `lms-sync.js` — `node tools/build-lms-gs.mjs` (Code.gs и lms-gs-script.js);
  новая версия сервера — `LMS_VERSION` в Server.gs и `SERVER_V` в `lms-client.js`.
- Проверка: `node --test tests/*.test.mjs` и `node tests/lms-e2e.mjs` (браузер, Playwright).
