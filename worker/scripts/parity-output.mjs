import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildEntities, buildKeywords, buildTopics } from '../src/analysis.js';

export function parityOutput(fixture) {
  const now = Date.parse(fixture.now);
  return {
    keywords: buildKeywords(fixture.items, now, fixture.enabledSourceCount),
    entities: buildEntities(fixture.items),
    topics: buildTopics(fixture.items),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(parityOutput(fixture)));
}
