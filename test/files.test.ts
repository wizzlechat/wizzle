import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileName, isImage, safeSegment } from '../src/files/paths.ts';

test('ids and names become safe path segments', () => {
  assert.equal(safeSegment('wizzle:agent:agent-1:ops'), 'wizzle_agent_agent-1_ops');
  assert.equal(safeSegment('../x'), '__x');
  assert.equal(safeSegment(''), '_');
  assert.equal(fileName('m1', 'report final.pdf'), 'm1-report_final.pdf');
  assert.equal(fileName('a/b', '.hidden'), 'a_b-_hidden');
  assert.equal(fileName('m2', `${'x'.repeat(200)}.tar.gz`), `m2-${'x'.repeat(80)}.gz`);
  assert.equal(fileName('m3', '   '), 'm3-file');
});

test('only the image types the chat renders inline count as images', () => {
  assert.equal(isImage('image/png'), true);
  assert.equal(isImage('image/HEIC'), true);
  assert.equal(isImage('image/svg+xml'), false);
  assert.equal(isImage('application/pdf'), false);
});
