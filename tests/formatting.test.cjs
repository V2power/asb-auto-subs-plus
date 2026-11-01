const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('./helpers.cjs');

const all = { removeSpeakerNames: true, removeFurigana: true, removeAssTags: true, removeDecorativeMarkers: true, joinSubtitleLines: true };
const none = Object.fromEntries(Object.keys(all).map(k => [k, false]));
const { context } = loadBackground();
const clean = (src, name, opts = all) => context.cleanSubtitleText(src, name, { ...opts });
// Compare SRT/VTT ignoring CRLF/LF; cue separator and trailing newline are asserted explicitly.
const lf = text => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

test('SRT: keeps index and timing, strips speaker/furigana/markers, joins lines', () => {
  const out = clean('\uFEFF1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n＜次＞\n\n2\n00:00:03,000 --> 00:00:04,000\nこんにちは\n', 'a.srt');
  assert.equal(lf(out), '1\n00:00:01,000 --> 00:00:02,000\n漢字次\n\n2\n00:00:03,000 --> 00:00:04,000\nこんにちは\n');
  assert.ok(out.includes('\r\n\r\n2'), 'cues separated by CRLF CRLF');
  assert.ok(out.endsWith('\r\n'));
  assert.ok(!out.startsWith('\uFEFF'));
});

test('SRT: all options off leaves the text untouched apart from newline normalisation', () => {
  const out = clean('1\r\n00:00:01,000 --> 00:00:02,000\r\n（太郎）漢字(かんじ)\r\n次\r\n', 'a.srt', none);
  assert.equal(lf(out), '1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n次\n');
});

test('SRT: a blank line inside a cue does not start a new block', () => {
  const out = clean('1\n00:00:01,000 --> 00:00:02,000\n一行目\n\n二行目\n\n2\n00:00:03,000 --> 00:00:04,000\n次\n', 'a.srt');
  assert.equal(lf(out), '1\n00:00:01,000 --> 00:00:02,000\n一行目二行目\n\n2\n00:00:03,000 --> 00:00:04,000\n次\n');
});

test('VTT header and timing lines survive formatting', () => {
  const out = lf(clean('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n（A）字幕\n', 'a.vtt'));
  assert.match(out, /^WEBVTT/);
  assert.match(out, /00:00:01\.000 --> 00:00:02\.000\n字幕/);
});

const ass = [
  '[Script Info]', 'Title: x', '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}一行目\\N二行目',
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,続き',
  'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,（花）漢字(かんじ)',
].join('\n');

test('ASS: tags removed, \\N joined, identical-time Dialogue merged, header preserved', () => {
  const lines = clean(ass, 'a.ass').split('\r\n');
  assert.equal(lines[0], '[Script Info]');
  assert.equal(lines[3], 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  assert.equal(lines[4], 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,一行目二行目続き');
  assert.equal(lines[5], 'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,漢字');
  assert.equal(lines.length, 6);
});

test('ASS: without joining, \\N is preserved and records stay separate', () => {
  const lines = clean(ass, 'a.ass', { ...all, joinSubtitleLines: false }).split('\r\n');
  assert.equal(lines[4], 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,一行目\\N二行目');
  assert.equal(lines[5], 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,続き');
});

test('formattingOptionsFrom: defaults on, individual opt-out, global opt-out', () => {
  const from = settings => context.formattingOptionsFrom(settings);
  assert.deepEqual(JSON.parse(JSON.stringify(from({}))), all);
  assert.equal(from({ removeFurigana: false }).removeFurigana, false);
  assert.equal(from({ removeFurigana: false }).removeAssTags, true);
  assert.equal(from({ formatSubtitles: false }), null);
});

test('safeAnimeFolder sanitises reserved names, separators and trailing dots', () => {
  const f = context.safeAnimeFolder;
  assert.equal(f('a/b\\c:d'), 'a_b_c_d');
  assert.equal(f('CON'), '_CON');
  assert.equal(f('name. '), 'name');
  assert.equal(f('   '), 'Anime');
  assert.equal(f('x'.repeat(300)).length, 100);
});

test('subtitleMimeType and base64 helpers', () => {
  assert.match(context.subtitleMimeType('a.SRT'), /subrip/);
  assert.match(context.subtitleMimeType('a.ass'), /ssa/);
  assert.match(context.subtitleMimeType('a.vtt'), /vtt/);
  const big = new Uint8Array(100000).map((_, i) => i % 251);
  assert.equal(Buffer.from(context.arrayBufferToBase64(big.buffer), 'base64').equals(Buffer.from(big)), true);
  assert.equal(Buffer.from(context.textToBase64('字幕'), 'base64').toString('utf8'), '字幕');
});
