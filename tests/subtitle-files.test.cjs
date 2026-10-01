const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const bytes = text => new TextEncoder().encode(text).buffer;
function directory(name = 'Subs') {
  const children = new Map();
  const root = {
    name, children, permission: 'granted', async queryPermission() { return this.permission; },
    async getDirectoryHandle(name, { create } = {}) {
      if (!children.has(name) && create) children.set(name, directory(name));
      if (!children.has(name)) throw new DOMException('', 'NotFoundError'); return children.get(name);
    },
    async getFileHandle(name, { create } = {}) {
      if (!children.has(name) && create) {
        const file = { name, content: bytes(''),
          async getFile() { return { size: this.content.byteLength, arrayBuffer: async () => this.content }; },
          async isSameEntry(other) { return this === other; },
          async createWritable() { let pending; return { write: async data => { pending = data; }, close: async () => { file.content = pending; }, abort: async () => {} }; },
        }; children.set(name, file);
      }
      if (!children.has(name)) throw new DOMException('', 'NotFoundError');
      if (children.get(name).children) throw new DOMException('', 'TypeMismatchError'); return children.get(name);
    },
    async removeEntry(name) { children.delete(name); },
  }; return root;
}
function setup(language = 'en') {
  const records = new Map(); let root;
  const context = { exports: {}, console, crypto: webcrypto, Uint8Array, DOMException,
    chrome: { storage: { sync: { get: async () => ({ language }) } } } };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fs.readFileSync('src/subtitleFiles.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  // Real IndexedDB serialization is exercised separately in the browser runner.
  context.getSubtitleDirectory = async () => root;
  context.databaseOperation = async (store, mode, operation) => operation({ put: record => records.set(record.id, record), getAll: () => Array.from(records.values()), delete: id => records.delete(id) });
  return { api: context, records, setRoot: value => { root = value; } };
}
test('creates the anime directory and preserves the exact SRT name and bytes', async () => {
  const { api, setRoot } = setup(); const root = directory(); setRoot(root);
  const name = '[Judas] High School DxD S1 - 02_jp.srt';
  const saved = await api.saveSubtitleFile(`High School DxD/${name}`, bytes('字幕'));
  assert.equal(saved.filename, `High School DxD/${name}`);
  assert.equal(Buffer.from(root.children.get('High School DxD').children.get(name).content).toString(), '字幕');
});
test('concurrent duplicates get separate names and preserve existing files', async () => {
  const { api, setRoot } = setup(); const root = directory(); setRoot(root);
  const results = await Promise.all([api.saveSubtitleFile('Anime/e.ass', bytes('first')), api.saveSubtitleFile('Anime/e.ass', bytes('second'))]);
  assert.equal(results[1].filename, 'Anime/e (1).ass'); assert.equal(Buffer.from(root.children.get('Anime').children.get('e.ass').content).toString(), 'first');
});
test('missing or revoked permissions prevent file creation', async () => {
  const { api, setRoot } = setup(); await assert.rejects(api.saveSubtitleFile('a.srt', bytes('x')), /Open ASB Configuration/);
  const root = directory(); root.permission = 'prompt'; setRoot(root);
  await assert.rejects(api.saveSubtitleFile('Anime/a.srt', bytes('x')), /authorize/); assert.equal(root.children.size, 0);
});
test('folder access errors use only the selected language, including native permission errors', async () => {
  for (const language of ['en', 'pt-BR']) {
    const { api } = setup(language);
    const expected = language === 'pt-BR' ? 'Abra as Configurações do ASB e escolha ou autorize a pasta de legendas.'
      : 'Open ASB Configuration and choose or authorize the subtitle folder.';
    await assert.rejects(api.saveSubtitleFile('a.srt', bytes('x')), error => error.message === expected);
    assert.equal(await api.subtitleFileErrorMessage(new DOMException('Browser message', 'NotAllowedError')), expected);
    assert.equal(await api.subtitleFileErrorMessage(new DOMException('Browser message', 'SecurityError')), expected);
  }
});
test('rejects traversal, reserved names and non-subtitle output', async () => {
  const { api, setRoot } = setup(); const root = directory(); setRoot(root);
  for (const name of ['../a.srt', '/a.srt', 'Anime/../a.srt', 'CON.srt', 'A\\a.srt', 'movie.mp4', 'archive.zip']) await assert.rejects(api.saveSubtitleFile(name, bytes('x')), /filename/);
  assert.equal(root.children.size, 0);
});
test('auto-delete removes only subtitles tracked for its tab', async () => {
  const { api, setRoot, records } = setup(); const root = directory(); setRoot(root);
  const owned = await api.saveSubtitleFile('Anime/a.srt', bytes('first')); const other = await api.saveSubtitleFile('Anime/b.srt', bytes('second'));
  await api.trackSubtitleFile(1, owned); await api.trackSubtitleFile(2, other); await api.removeSubtitleFiles(1);
  assert.equal(root.children.get('Anime').children.has('a.srt'), false); assert.equal(root.children.get('Anime').children.has('b.srt'), true); assert.equal(records.size, 1);
});
test('auto-delete preserves edited files and retains permission failures for retry', async () => {
  const { api, setRoot, records } = setup(); const root = directory(); setRoot(root);
  const owned = await api.saveSubtitleFile('a.srt', bytes('original')); await api.trackSubtitleFile(1, owned);
  root.permission = 'denied'; await api.removeSubtitleFiles(1); assert.equal(records.size, 1);
  root.permission = 'granted'; owned.handle.content = bytes('modified'); await api.removeSubtitleFiles(1);
  assert.equal(records.size, 0); assert.equal(root.children.has('a.srt'), true);
});
test('cleanup keeps the original directory when the selected folder changes', async () => {
  const { api, setRoot } = setup(); const first = directory('first'); setRoot(first);
  const owned = await api.saveSubtitleFile('a.srt', bytes('old')); await api.trackSubtitleFile(1, owned);
  const second = directory('second'); setRoot(second); await api.saveSubtitleFile('a.srt', bytes('new')); await api.removeSubtitleFiles(1);
  assert.equal(first.children.has('a.srt'), false); assert.equal(second.children.has('a.srt'), true);
});
