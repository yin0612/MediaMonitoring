import fs from 'node:fs/promises';

const output = process.argv[2];
const base = (process.argv[3] || 'https://yin0612.github.io/MediaMonitoring').replace(/\/$/, '');
if (!output) throw new Error('usage: node build-staging-snapshot.mjs <output.json> [pages-base-url]');

const names = ['meta', 'keywords', 'sources', 'recent', 'entities', 'topics', 'events'];
const files = {};
for (const name of names) {
  const response = await fetch(`${base}/data/${name}.json?staging=${Date.now()}`);
  if (!response.ok) throw new Error(`${name}: HTTP_${response.status}`);
  files[name] = await response.json();
}

await fs.writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`, 'utf8');
console.log(`wrote staging snapshot fixture: ${output}`);
