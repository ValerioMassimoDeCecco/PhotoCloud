import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaItemMatchesQuery,
  parseNaturalQuery,
  searchMediaItems,
  SearchableMediaItem,
} from './nlSearch';

const NOW = new Date(2026, 10, 13, 12, 0, 0); // 13 novembre 2026 (venerdì)

function item(filename: string, ts: Date, isMedia = true, album = ''): SearchableMediaItem {
  return { filename, timestamp: Math.floor(ts.getTime() / 1000), isMedia, album };
}

test('parser: riconosce anno e mese in italiano', () => {
  const q = parseNaturalQuery('foto di agosto 2024', NOW);
  assert.deepEqual(q.years, [2024]);
  assert.deepEqual(q.months, [8]);
  assert.equal(q.mediaType, 'photo');
  assert.ok(q.explanation.length >= 2);
});

test('parser: "anno scorso" e "questo mese" rispetto alla data di riferimento', () => {
  const q1 = parseNaturalQuery("video dell'anno scorso", NOW);
  assert.deepEqual(q1.years, [2025]);
  assert.equal(q1.mediaType, 'video');

  const q2 = parseNaturalQuery('foto di questo mese', NOW);
  assert.deepEqual(q2.months, [11]);
  assert.deepEqual(q2.years, [2026]);
});

test('parser: oggi e ieri producono intervalli di date esatti', () => {
  const today = parseNaturalQuery('oggi', NOW);
  const yesterday = parseNaturalQuery('ieri', NOW);
  assert.ok(today.dateFrom !== null && today.dateTo !== null);
  assert.ok(yesterday.dateFrom !== null && yesterday.dateTo !== null);
  assert.equal(today.dateFrom! - yesterday.dateFrom!, 86400);
});

test('parser: preferiti e tipo file cloud', () => {
  const q = parseNaturalQuery('documenti preferiti', NOW);
  assert.equal(q.mediaType, 'file');
  assert.equal(q.favoritesOnly, true);
});

test('parser: album esplicito e token di testo libero', () => {
  const q = parseNaturalQuery('album Vacanze al mare', NOW);
  assert.deepEqual(q.albums, ['vacanze al mare']);

    const q2 = parseNaturalQuery('immagini compleanno', NOW);
  assert.equal(q2.mediaType, 'photo');
  assert.deepEqual(q2.textTokens, ['compleanno']);
});

test('parser: inglese supportato (last 7 days, favorites)', () => {
  const q = parseNaturalQuery('my favorite photos from last 7 days', NOW);
  assert.equal(q.favoritesOnly, true);
  assert.equal(q.mediaType, 'photo');
  assert.ok(q.dateFrom !== null && q.dateTo !== null);
  assert.equal(q.dateTo! - q.dateFrom!, 6 * 86400 + 86399);
});

test('match: filtra per anno+mese+tipo', () => {
  const items = [
    item('a.jpg', new Date(2024, 7, 15)), // agosto 2024
    item('b.jpg', new Date(2024, 8, 15)), // settembre 2024
    item('c.mp4', new Date(2024, 7, 15)), // video agosto 2024
  ];
  const { results } = searchMediaItems(items, 'foto di agosto 2024', undefined, NOW);
  assert.deepEqual(results.map((r) => r.filename), ['a.jpg']);
});

test('match: preferiti richiedono il set', () => {
  const items = [item('a.jpg', new Date(2026, 10, 1)), item('b.jpg', new Date(2026, 10, 2))];
  const favs = new Set(['b.jpg']);
  const { results } = searchMediaItems(items, 'preferiti', favs, NOW);
  assert.deepEqual(results.map((r) => r.filename), ['b.jpg']);
});

test('match: token testo su filename e album', () => {
  const items = [
    item('img1.jpg', new Date(2020, 0, 1), true, 'Vacanze Sardegna'),
    item('img2.jpg', new Date(2020, 0, 1), true, 'Lavoro'),
  ];
  const { results } = searchMediaItems(items, 'album Sardegna', undefined, NOW);
  assert.deepEqual(results.map((r) => r.filename), ['img1.jpg']);
});

test('match: tipo file esclude i media', () => {
  const items = [
    item('doc.pdf', new Date(2026, 10, 1), false),
    item('foto.jpg', new Date(2026, 10, 1), true),
  ];
  const { results } = searchMediaItems(items, 'documenti di questo mese', undefined, NOW);
  assert.deepEqual(results.map((r) => r.filename), ['doc.pdf']);
});

test('match edge: query vuota restituisce filtro permissivo ma vuoto di spiegazioni', () => {
  const q = parseNaturalQuery('', NOW);
  assert.equal(q.explanation.length, 0);
  assert.ok(mediaItemMatchesQuery(item('x.jpg', new Date()), q));
});
