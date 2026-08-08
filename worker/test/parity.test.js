import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { parityOutput } from '../scripts/parity-output.mjs';

const FIXTURE = new URL('../../tests/fixtures/analysis-parity.json', import.meta.url);

test('Worker analysis matches the Python implementation on the shared fixture', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const worker = parityOutput(fixture);
  const python = JSON.parse(execFileSync(
    'python',
    ['-X', 'utf8', '../tests/parity_snapshot.py', '../tests/fixtures/analysis-parity.json'],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PYTHONPATH: '../src', PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf8',
    },
  ));

  assert.deepEqual(worker, python);
});
