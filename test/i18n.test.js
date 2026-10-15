// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { searchMessage } from '../src/hub.js';
import { NAMES, SEARCH_TEXT, TEXT } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;
// The unambiguous informal Spanish forms ("tú"): the series speaks "usted".
// (An imperative like "abre" is also the third person: not a marker.)
const INFORMAL_SPANISH =
  /(?<!\p{L})(tú|tu|tus|contigo|puedes|tienes|quieres|debes|necesitas|haz|pon)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && INFORMAL_SPANISH.test(text)) {
    found.push(`${path} uses the informal form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max = path === 'manifest.description' ? MAX.catalog : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('the name of the integration is the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 25, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('every message of the code has the four languages', () => {
  const found = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, MAX.message),
  );
  assert.deepEqual(found, []);
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the search report exists in every language', () => {
  const hub = {
    name: 'Living room hub',
    generation: 2,
    host: '192.0.2.10',
    shades: 12,
    scenes: 18,
  };
  const render = (value) => (typeof value === 'function' ? value(hub) : value);
  assert.deepEqual(tableProblems(SEARCH_TEXT, 'SEARCH_TEXT', MAX.message, render), []);

  const report = searchMessage({
    hubs: [{ ...hub, reachable: true }],
    secondaries: ['192.0.2.21'],
    unreachable: ['192.0.2.99'],
    mdns: 'unavailable',
    invalidHosts: ['300.1.1.1'],
  });
  assert.deepEqual(problems(report, 'searchMessage', 800), []);
  assert.match(report.de, /12 Jalousie\(n\), 18 Szene\(n\)\. .*sekundäres Gateway/);
  assert.match(report.es, /introduzca las direcciones IP/);
});

test('the guard catches a missing language, an empty text and the wrong form of address', () => {
  assert.equal(problems({ en: 'Shade', fr: 'Store', de: 'Jalousie' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Shade', fr: 'Store', de: '', es: 'Persiana' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Hub',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.equal(
    problems({ en: 'a', fr: 'a', de: 'a', es: 'Puedes abrir tu pestaña' }, 'x', 60).length,
    1,
  );
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// The documentation: the four languages the store publishes, same sections.
const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
const headings = (markdown) => markdown.split('\n').filter((line) => /^#{1,3} /.test(line));
const levels = (markdown) => headings(markdown).map((line) => line.split(' ')[0]);

test('the four docs exist, long enough for the store', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('the four docs have the same sections, in the same order', () => {
  assert.ok(headings(docs.en).length >= 10, 'docs/en.md has too few sections');
  for (const lang of LANGS) {
    assert.deepEqual(
      levels(docs[lang]),
      levels(docs.en),
      `docs/${lang}.md sections differ from docs/en.md`,
    );
  }
});

test('the docs say it was developed without the hardware, and who it is not affiliated with', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  assert.match(docs.fr, /Développée sans le matériel/);
  assert.match(docs.de, /Ohne die Hardware entwickelt/);
  assert.match(docs.es, /Desarrollada sin el hardware/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /Hunter Douglas/);
  }
});

test('the German doc says "du", the Spanish one "usted"', () => {
  assert.doesNotMatch(docs.de, POLITE_GERMAN);
  assert.doesNotMatch(docs.es, INFORMAL_SPANISH);
});
