# BURAQ o‘quv platformasi — учебная платформа для сотрудников

Сайт: https://buraqlearning-production.up.railway.app/ (Railway, `server/index.mjs`, `npm start`); GitHub Pages
перекидывает туда · устройство, сервер и настройка — `README.md`.

Фирменный стиль — обязателен для всего видимого (цвета, шрифт, логотип, кнопки, иконки):

@buraq-brand/BRAND.md

- Цвета — токены в `lor.css` (`--navy`, `--red`, `--surface`, …); новых цветов в разметку не добавлять.
- Логотип — только файлы из `buraq-brand/logo/` (на синем — `buraq-logo-white.svg`, на светлом — `buraq-logo.svg`).
- Шрифт — Neue Montreal из `fonts/` (только латиница; кириллица — Inter), заголовки капсом обычной толщины.
- Надписи — в `strings.js`, на четырёх языках: uz (основной, латиница), ru, en, zh. Новую надпись — сразу во все четыре.
  Вычитка носителями — `node tools/strings-review.mjs export|import` (правки — блоком в конце strings.js).
- Репозиторий открытый: тексты и тесты стандартов компании (4-bob) и персональные данные сюда не коммитить —
  они живут только на сервере (Railway или Google Apps Script).
- Код сервера один — `tools/lms-gs/Server.gs`: на Railway его выполняет `server/gas-node.mjs` (сервисы Apps Script
  на диске), в Google Apps Script — как есть. Файлы сайта, которые отдаёт сервер, — список в `server/index.mjs`
  и `.github/workflows/pages.yml`: новый файл сайта — в оба.
- После правки `tools/lms-gs/Server.gs` или `lms-sync.js` — `node tools/build-lms-gs.mjs` (Code.gs и lms-gs-script.js);
  новая версия сервера — `LMS_VERSION` в Server.gs и `SERVER_V` в `lms-client.js`.
- Проверка: `node --test tests/*.test.mjs` и `node tests/lms-e2e.mjs` (браузер, Playwright).
