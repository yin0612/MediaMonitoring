import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);

test('local annotation page exposes local imports, reviewer modes, and JSONL download', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('app.js', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8'),
  ]);

  assert.match(html, /id="candidate-file"/);
  assert.match(html, /id="machine-draft-file"/);
  assert.match(html, /id="annotation-mode"/);
  assert.match(html, /id="download-jsonl"/);
  assert.match(html, /Machine suggestions are references only/);
  assert.match(app, /updateAnnotation/);
  assert.match(app, /machineSuggestionFor/);
  assert.match(app, /safeArticleUrl/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(css, /\.machine-suggestion/);
});
