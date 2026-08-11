// 從 config/*.yml 產生 Worker 用的 JS 設定，讓 YAML 維持單一真相來源。
// 由 npm run gen-config（deploy/test 前自動執行）呼叫；輸出檔會提交進 git。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const watch = loadYaml(readFileSync(resolve(repoRoot, 'config/watch_terms.yml'), 'utf8')) || {};
const entities = loadYaml(readFileSync(resolve(repoRoot, 'config/entities.yml'), 'utf8')) || {};
const sentiment = loadYaml(readFileSync(resolve(repoRoot, 'config/sentiment.yml'), 'utf8')) || {};

const watchTerms = (watch.watch_terms || []).map((entry) => ({
  id: entry.id ?? entry.display,
  display: entry.display,
  anyOf: entry.any_of || [entry.display],
  exclude: entry.exclude || [],
}));

const autoRaw = watch.auto_terms || {};
const autoTerms = {
  maxTerms: autoRaw.max_terms ?? 10,
  minDocs: autoRaw.min_docs ?? 5,
  minSources: autoRaw.min_sources ?? 3,
  minLength: autoRaw.min_length ?? 2,
  stopwords: autoRaw.stopwords || [],
};

// ORG 與 PERSON 併為單一詞典，每筆帶 type 供共現圖區分節點類別
const toEntity = (entry, type) =>
  typeof entry === 'string'
    ? { name: entry, aliases: [], type }
    : { name: entry.name, aliases: entry.aliases || [], type };
const entityLexicon = [
  ...(entities.orgs || []).map((entry) => toEntity(entry, 'ORG')),
  ...(entities.persons || []).map((entry) => toEntity(entry, 'PERSON')),
];

const toTerms = (list) =>
  (list || []).map((entry) =>
    typeof entry === 'string' ? { term: entry, weight: 1 } : { term: entry.term, weight: entry.weight ?? 1 },
  );
const sentimentLexicon = {
  positive: toTerms(sentiment.positive),
  negative: toTerms(sentiment.negative),
  negations: sentiment.negations || [],
  negationWindow: sentiment.negation_window ?? 4,
};

const banner =
  '// 自動產生檔，請勿手改。來源：config/ 下的 watch_terms.yml、entities.yml、sentiment.yml；重跑 `npm run gen-config`。\n';
const body =
  banner +
  `export const WATCH_TERMS = ${JSON.stringify(watchTerms, null, 2)};\n\n` +
  `export const AUTO_TERMS = ${JSON.stringify(autoTerms, null, 2)};\n\n` +
  `export const ENTITY_LEXICON = ${JSON.stringify(entityLexicon, null, 2)};\n\n` +
  `export const SENTIMENT_LEXICON = ${JSON.stringify(sentimentLexicon, null, 2)};\n`;

writeFileSync(resolve(here, '..', 'src', 'generated-config.js'), body);
console.log(
  `gen-config: ${watchTerms.length} watch terms, ${autoTerms.maxTerms} auto max, ` +
    `${entityLexicon.length} entities (${entityLexicon.filter((e) => e.type === 'PERSON').length} persons), ` +
    `${sentimentLexicon.positive.length + sentimentLexicon.negative.length} sentiment terms`,
);
