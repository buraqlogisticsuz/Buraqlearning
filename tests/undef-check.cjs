// Проверка «X is not defined» без запуска: разбор файлов сайта встроенным в Node acorn (node --expose-internals),
// все объявленные имена против всех использованных (без учёта областей — грубо, но ловит удалённое объявление).
// Запуск: node --expose-internals tests/undef-check.cjs app.js templates.js …  → JSON-список необъявленных имён
const a = require('internal/deps/acorn/acorn/dist/acorn'), w = require('internal/deps/acorn/acorn-walk/dist/walk'), fs = require('fs');
const files = process.argv.slice(2), declared = new Set(), used = new Map();
function pat(p) { if (!p) return; if (p.type === 'Identifier') declared.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(x => pat(x.value || x.argument)); else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'AssignmentPattern') pat(p.left); else if (p.type === 'RestElement') pat(p.argument); }
for (const f of files) {
  const ast = a.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2022, sourceType: 'script', locations: true });
  w.full(ast, n => {
    if (n.type === 'VariableDeclarator') pat(n.id);
    if (/Function/.test(n.type)) { if (n.id) declared.add(n.id.name); n.params.forEach(pat); }
    if (n.type === 'CatchClause') pat(n.param);
    if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object.type === 'Identifier' && /^(window|root|self|globalThis)$/.test(n.left.object.name) && !n.left.computed) declared.add(n.left.property.name);
  });
  w.ancestor(ast, { Identifier(n, st, anc) {
    const p = anc[anc.length - 2];
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && (p.type === 'Property' || p.type === 'MethodDefinition') && p.key === n && !p.computed && !(p.shorthand)) return;
    if (p && /Label|Break|Continue/.test(p.type)) return;
    if (!used.has(n.name)) used.set(n.name, f + ':' + n.loc.start.line);
  } });
}
const B = 'window document localStorage sessionStorage location history navigator console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame Promise Object Array String Number Boolean Math Date JSON RegExp Error TypeError Map Set WeakMap Symbol parseInt parseFloat isFinite isNaN encodeURIComponent decodeURIComponent encodeURI escape unescape Blob File FileReader URL URLSearchParams DOMParser TextDecoder TextEncoder Uint8Array Uint16Array Uint32Array Int32Array Float32Array ArrayBuffer DataView fetch AbortController Event CustomEvent KeyboardEvent ClipboardEvent MouseEvent DataTransfer Image Audio AudioContext webkitAudioContext Notification matchMedia getComputedStyle getSelection performance crypto atob btoa alert confirm prompt Intl ResizeObserver IntersectionObserver MutationObserver HTMLElement Element Node NodeFilter CSS screen innerWidth innerHeight devicePixelRatio structuredClone queueMicrotask Infinity NaN undefined arguments globalThis self module exports require define DecompressionStream CompressionStream Response Headers Request XMLHttpRequest FormData indexedDB caches print open close scrollTo scrollY scrollX visualViewport Range HTMLCanvasElement OffscreenCanvas createImageBitmap MediaRecorder MessageChannel BroadcastChannel Worker PerformanceObserver Proxy Reflect BigInt WeakSet this React ReactDOM'.split(' ');
B.forEach(x => declared.add(x));
const miss = [...used.keys()].filter(x => !declared.has(x)).sort();
console.log(JSON.stringify(miss.map(x => x + ' @ ' + used.get(x))));
