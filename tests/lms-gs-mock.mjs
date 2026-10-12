// Заглушки сервисов Google Apps Script для сервера учебной платформы (tools/lms-gs/Code.gs) — в Node, без Google.
import vm from 'node:vm';
import { createHash, createHmac } from 'node:crypto';
import { buildLmsGs } from '../tools/build-lms-gs.mjs';

// байты как в Apps Script: знаковые (−128…127)
const sbytes = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const ubuf = x => typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => (b + 256) % 256));

export function loadLms({ now, iter } = {}) {
  const props = {}, files = {}, folders = {}, triggers = [], logs = [], cache = new Map();
  let seq = 0, writes = 0, uuid = 0;
  const clock = () => (now && now.value != null ? now.value : Date.now());
  // id как у Google Диска — длинные; файл — текст (content) или байты (bytes, type) для загруженных файлов
  const newId = p => p + '-' + String(++seq).padStart(10, '0');
  const file = (id) => ({
    getId: () => id,
    getBlob: () => ({ getDataAsString: () => files[id].content, getBytes: () => files[id].bytes, getName: () => files[id].name, getContentType: () => files[id].type }),
    setDescription: d => { files[id].description = d; },
    setContent: c => { files[id].content = c; writes++; },
    makeCopy: (name, folder) => { const nid = newId('file'); files[nid] = { name, folder: folder.getId(), content: files[id].content, created: clock() }; return file(nid); },
    getDateCreated: () => new Date(files[id].created),
    setTrashed: v => { if (v) delete files[id]; }
  });
  const folder = (id) => ({
    getId: () => id,
    createFile: (name, content) => { const fid = newId('file');
      files[fid] = typeof name === 'object' ? { name: name.name, type: name.type, bytes: name.bytes, folder: id, created: clock() } : { name, folder: id, content, created: clock() };
      return file(fid); },
    createFolder: n => { const fid = newId('folder'); folders[fid] = { name: n, parent: id }; return folder(fid); },
    getFoldersByName: n => { const l = Object.keys(folders).filter(k => folders[k].parent === id && folders[k].name === n); return { hasNext: () => l.length > 0, next: () => folder(l.shift()) }; },
    getFiles: () => { const l = Object.keys(files).filter(k => files[k].folder === id); return { hasNext: () => l.length > 0, next: () => file(l.shift()) }; }
  });
  let locked = false;
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
      getProperties: () => ({ ...props }),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    }) },
    DriveApp: {
      createFolder: n => { const id = newId('folder'); folders[id] = { name: n, parent: null }; return folder(id); },
      getFolderById: id => { if (!folders[id]) throw new Error('нет папки ' + id); return folder(id); },
      getFileById: id => { if (!files[id]) throw new Error('нет файла ' + id); return file(id); }
    },
    // кэш: значения живут ttl секунд по часам теста
    CacheService: { getScriptCache: () => ({
      get: k => { const x = cache.get(k); if (!x || x.exp <= clock()) { cache.delete(k); return null; } return x.v; },
      put: (k, v, ttl = 600) => { cache.set(k, { v: String(v), exp: clock() + ttl * 1000 }); },
      remove: k => { cache.delete(k); }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => sbytes(createHash('sha256').update(ubuf(s)).digest()),
      computeHmacSha256Signature: (value, key) => sbytes(createHmac('sha256', ubuf(key)).update(ubuf(value)).digest()),
      newBlob: (s, type, name) => ({ bytes: Array.isArray(s) ? s : sbytes(Buffer.from(String(s), 'utf8')), type, name, getBytes() { return this.bytes; } }),
      base64Decode: s => sbytes(Buffer.from(s, 'base64')),
      base64Encode: b => ubuf(b).toString('base64'),
      getUuid: () => createHash('sha256').update('uuid' + (++uuid) + Math.random()).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'),
      formatDate: (d) => d.toISOString().slice(0, 10)
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const b = { timeBased: () => b, atHour: h => { b.h = h; return b; }, everyDays: () => b, inTimezone: () => b, create: () => { const t = { getHandlerFunction: () => fn, hour: b.h }; triggers.push(t); return t; } }; return b; }
    },
    Logger: { log: s => logs.push(String(s)) },
    Date: class extends Date { constructor(...a) { if (!a.length) super(clock()); else super(...a); } static now() { return clock(); } }
  };
  vm.createContext(ctx);
  let src = buildLmsGs();
  if (iter) src = src.replace(/var PBKDF2_ITER = \d+;/, 'var PBKDF2_ITER = ' + iter + ';');
  vm.runInContext(src, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const state = () => { const id = props.LMS_STATE; return id ? JSON.parse(files[id].content) : null; };
  return { ctx, props, files, folders, triggers, logs, cache, post, state, writes: () => writes,
    get: () => JSON.parse(ctx.doGet().text), setLocked: v => { locked = v; } };
}
