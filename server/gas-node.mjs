// Сервисы Google Apps Script на Node — с данными на диске. Код сервера платформы (tools/lms-gs/Server.gs + lms-sync.js,
// тот же, что работает в Apps Script) выполняется без изменений; вместо Google Диска и свойств скрипта — папка dir
// (на Railway — том, Volume):
//   dir/props.json                                   свойства скрипта: учётные записи (хэши паролей), входы, номера файлов
//   dir/drive.json                                   какой файл где лежит (номер → путь, тип, дата)
//   dir/BURAQ o‘quv platformasi — ma’lumotlar/       state.json, files/ (сканы, вложения), backups/ (ночные копии)
// Свойства ANTHROPIC_API_KEY и AI_* берутся из переменных окружения (Railway → Variables).
import vm from 'node:vm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLmsGs } from '../tools/build-lms-gs.mjs';

export const ENV_PROPS = ['ANTHROPIC_API_KEY', 'AI_MODEL', 'AI_DAILY_LIMIT', 'AI_DAILY_LIMIT_ADMIN', 'AI_MAX_TOKENS'];

// байты как в Apps Script: знаковые (−128…127). Большие файлы — Int8Array поверх Buffer, без копирования в массив
const sbytes = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const ubuf = x => typeof x === 'string' ? Buffer.from(x, 'utf8')
  : ArrayBuffer.isView(x) ? Buffer.from(x.buffer, x.byteOffset, x.byteLength)
  : Buffer.from(x.map(b => (b + 256) % 256));
const sview = buf => new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);

// запись целиком или никак: сначала во временный файл, потом переименование
function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
const readJson = (file, d) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return d; } };
// имя файла или папки на диске: без «/», управляющих символов и точек в начале
const safe = s => String(s || 'fayl').replace(/[\/\\\0-\x1f]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'fayl';

export function loadServer({ dir, env = process.env, iter, log = console.log } = {}) {
  mkdirSync(dir, { recursive: true });
  const P_FILE = join(dir, 'props.json'), D_FILE = join(dir, 'drive.json');
  const props = readJson(P_FILE, {});
  const drive = readJson(D_FILE, { folders: {}, files: {} });
  const cache = new Map();
  const saveProps = () => writeAtomic(P_FILE, JSON.stringify(props));
  const saveDrive = () => writeAtomic(D_FILE, JSON.stringify(drive));
  const abs = rel => join(dir, rel);
  const newId = p => p + '-' + randomUUID().replace(/-/g, '');
  // путь для нового файла в папке: своё имя, если свободно, иначе с номером
  const freePath = (base, name, id) => {
    const taken = p => existsSync(abs(p));
    const p1 = base + '/' + safe(name);
    return taken(p1) ? base + '/' + id + '-' + safe(name) : p1;
  };

  const blob = (id) => {
    const f = drive.files[id];
    return {
      getDataAsString: () => readFileSync(abs(f.path), 'utf8'),
      getBytes: () => sview(readFileSync(abs(f.path))),
      getName: () => f.name, getContentType: () => f.type
    };
  };
  const file = (id) => ({
    getId: () => id,
    getBlob: () => blob(id),
    setDescription: d => { drive.files[id].description = String(d); saveDrive(); },
    setContent: c => { writeAtomic(abs(drive.files[id].path), String(c)); },
    makeCopy: (name, folder) => {
      const nid = newId('file'), base = drive.folders[folder.getId()].path, path = freePath(base, name, nid);
      writeAtomic(abs(path), readFileSync(abs(drive.files[id].path)));
      drive.files[nid] = { name, type: drive.files[id].type, folder: folder.getId(), path, created: Date.now() };
      saveDrive();
      return file(nid);
    },
    getDateCreated: () => new Date(drive.files[id].created),
    setTrashed: v => { if (!v) return; rmSync(abs(drive.files[id].path), { force: true }); delete drive.files[id]; saveDrive(); }
  });
  const folder = (id) => ({
    getId: () => id,
    // createFile(имя, текст, тип) или createFile(blob) — загруженный файл
    createFile: (name, content, type) => {
      const fid = newId('file'), b = typeof name === 'object' ? name : null;
      const fname = b ? b.name : name, path = freePath(drive.folders[id].path, fname, fid);
      writeAtomic(abs(path), b ? ubuf(b.bytes) : String(content));
      drive.files[fid] = { name: fname, type: b ? b.type : (type || 'text/plain'), folder: id, path, created: Date.now() };
      saveDrive();
      return file(fid);
    },
    createFolder: n => makeFolder(n, id),
    getFoldersByName: n => {
      const l = Object.keys(drive.folders).filter(k => drive.folders[k].parent === id && drive.folders[k].name === n);
      return { hasNext: () => l.length > 0, next: () => folder(l.shift()) };
    },
    getFiles: () => {
      const l = Object.keys(drive.files).filter(k => drive.files[k].folder === id);
      return { hasNext: () => l.length > 0, next: () => file(l.shift()) };
    }
  });
  function makeFolder(name, parent) {
    const id = newId('folder'), base = parent ? drive.folders[parent].path + '/' : '';
    let path = base + safe(name);
    if (existsSync(abs(path))) path = base + id + '-' + safe(name);
    mkdirSync(abs(path), { recursive: true });
    drive.folders[id] = { name, parent: parent || null, path };
    saveDrive();
    return folder(id);
  }

  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (ENV_PROPS.includes(k) && String(env[k] || '').trim() ? String(env[k]).trim()
        : Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
      getProperties: () => ({ ...props }),
      setProperty: (k, v) => { props[k] = String(v); saveProps(); },
      deleteProperty: k => { if (k in props) { delete props[k]; saveProps(); } }
    }) },
    DriveApp: {
      createFolder: n => makeFolder(n, null),
      getFolderById: id => { if (!drive.folders[id]) throw new Error('Нет папки ' + id); return folder(id); },
      getFileById: id => { if (!drive.files[id]) throw new Error('Нет файла ' + id); return file(id); }
    },
    CacheService: { getScriptCache: () => ({
      get: k => { const x = cache.get(k); if (!x || x.exp <= Date.now()) { cache.delete(k); return null; } return x.v; },
      put: (k, v, ttl = 600) => { cache.set(k, { v: String(v), exp: Date.now() + ttl * 1000 }); },
      remove: k => { cache.delete(k); }
    }) },
    // Node выполняет код сервера в одном потоке, запрос за запросом — блокировка всегда свободна
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => sbytes(createHash('sha256').update(ubuf(s)).digest()),
      computeHmacSha256Signature: (value, key) => sbytes(createHmac('sha256', ubuf(key)).update(ubuf(value)).digest()),
      newBlob: (s, type, name) => ({ bytes: typeof s === 'string' ? sbytes(Buffer.from(s, 'utf8')) : s, type, name, getBytes() { return this.bytes; } }),
      base64Decode: s => sview(Buffer.from(s, 'base64')),
      base64Encode: b => ubuf(b).toString('base64'),
      getUuid: () => randomUUID(),
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    },
    // ночную копию запускает server/index.mjs по своему таймеру
    ScriptApp: {
      getProjectTriggers: () => [], deleteTrigger: () => {},
      newTrigger: () => { const b = { timeBased: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, create: () => ({}) }; return b; }
    },
    Logger: { log: s => log(String(s)) },
    // ИИ на Node идёт мимо UrlFetchApp: server/index.mjs вызывает aiRequest_, fetch и aiResult_
    UrlFetchApp: { fetch: () => { throw new Error('UrlFetchApp на Node не используется'); } }
  };
  vm.createContext(ctx);
  let src = buildLmsGs();
  if (iter) src = src.replace(/var PBKDF2_ITER = \d+;/, 'var PBKDF2_ITER = ' + iter + ';');
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  return { ctx, props, drive, ready: () => !!props.LMS_STATE };
}
