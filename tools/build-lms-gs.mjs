#!/usr/bin/env node
// Собирает код сервера учебной платформы для Apps Script одним файлом:
// tools/lms-gs/Server.gs + lms-sync.js (разница и применение правок) + lms-pay.js (формула зарплаты) — те же файлы,
// что на странице →
//   tools/lms-gs/Code.gs        — вставить в Apps Script (или скопировать с GitHub);
//   lms-gs-script.js            — тот же код для кнопки «Скопировать код сервера» у методиста.
//   node tools/build-lms-gs.mjs
import { readFileSync, writeFileSync } from 'node:fs';

export function buildLmsGs() {
  const server = readFileSync(new URL('./lms-gs/Server.gs', import.meta.url), 'utf8').trimEnd();
  const part = f => '\n\n/* ---------------- ' + f + ' (собрано tools/build-lms-gs.mjs — правьте исходники) ---------------- */\n'
    + readFileSync(new URL('../' + f, import.meta.url), 'utf8').trimEnd();
  return server + part('lms-sync.js') + part('lms-pay.js') + '\n';
}
export const lmsVersion = src => +((src.match(/var LMS_VERSION = (\d+)/) || [])[1] || 0);
export const pageScript = src => '/* Код сервера учебной платформы для кнопки «Скопировать код» — собран tools/build-lms-gs.mjs, не править */\n'
  + 'window.LMS_GS_SCRIPT=' + JSON.stringify(src) + ';\nwindow.LMS_GS_VERSION=' + lmsVersion(src) + ';\n';

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = buildLmsGs();
  writeFileSync(new URL('./lms-gs/Code.gs', import.meta.url), src);
  writeFileSync(new URL('../lms-gs-script.js', import.meta.url), pageScript(src));
  console.log('tools/lms-gs/Code.gs и lms-gs-script.js ← Server.gs + lms-sync.js + lms-pay.js, версия', lmsVersion(src));
}
