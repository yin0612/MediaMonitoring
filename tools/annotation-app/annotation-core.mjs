const LABEL_FIELDS = ['eventCluster', 'topics', 'entities', 'textTone', 'target', 'targetStance'];
const REQUIRED_FIELDS = ['eventCluster', 'topics', 'textTone', 'target', 'targetStance'];
const MODES = new Set(['consensus', 'annotator1', 'annotator2']);
const TONES = new Set(['positive', 'neutral', 'negative', 'uncertain']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(stringValue).filter(Boolean))];
}

function normalizedLabels(labels) {
  return {
    eventCluster: stringValue(labels?.eventCluster),
    topics: stringList(labels?.topics),
    entities: stringList(labels?.entities),
    textTone: stringValue(labels?.textTone),
    target: stringValue(labels?.target),
    targetStance: stringValue(labels?.targetStance),
  };
}

function isPresent(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(stringValue(value));
}

function isComplete(labels) {
  const normalized = normalizedLabels(labels);
  return REQUIRED_FIELDS.every((field) => isPresent(normalized[field]));
}

export function parseJsonl(text) {
  if (typeof text !== 'string') throw new TypeError('JSONL input must be text.');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
  });
}

export function serializeJsonl(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Rows must be an array.');
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

export function updateAnnotation(rows, rowIndex, labels, mode = 'consensus') {
  if (!Array.isArray(rows) || !Number.isInteger(rowIndex) || !rows[rowIndex]) {
    throw new Error('Select a valid annotation row.');
  }
  if (!MODES.has(mode)) throw new Error(`Unknown annotation mode: ${mode}`);

  const nextRows = clone(rows);
  const row = nextRows[rowIndex];
  if (mode !== 'consensus' && row.doubleAnnotation !== true) {
    throw new Error('Reviewer labels require doubleAnnotation=true.');
  }

  const annotations = row.annotations && typeof row.annotations === 'object' ? row.annotations : {};
  const nextLabels = normalizedLabels(labels);
  row.annotations = { ...annotations };

  if (mode === 'consensus') {
    Object.assign(row.annotations, nextLabels);
  } else {
    row.annotations[mode] = nextLabels;
  }

  return nextRows;
}

export function machineSuggestionFor(candidate, draftRows) {
  if (!candidate?.sampleId || !Array.isArray(draftRows)) return null;
  const draft = draftRows.find((row) => row?.sampleId === candidate.sampleId);
  if (!draft?.machineSuggested || draft?.provenance?.kind !== 'machine-draft') return null;
  return clone(normalizedLabels(draft.machineSuggested));
}

export function labelsFor(row, mode = 'consensus') {
  const annotations = row?.annotations && typeof row.annotations === 'object' ? row.annotations : {};
  return normalizedLabels(mode === 'consensus' ? annotations : annotations[mode]);
}

export function validateRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Rows must be an array.');
  const missingByField = Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, 0]));
  const invalidByField = { textTone: 0, targetStance: 0 };
  let completeRows = 0;
  let completedDoubleAnnotationRows = 0;
  let expectedDoubleAnnotationRows = 0;

  rows.forEach((row) => {
    const labels = labelsFor(row);
    if (isComplete(labels)) completeRows += 1;
    REQUIRED_FIELDS.forEach((field) => {
      if (!isPresent(labels[field])) missingByField[field] += 1;
    });
    if (labels.textTone && !TONES.has(labels.textTone)) invalidByField.textTone += 1;
    if (labels.targetStance && !TONES.has(labels.targetStance)) invalidByField.targetStance += 1;

    if (row?.doubleAnnotation === true) {
      expectedDoubleAnnotationRows += 1;
      if (isComplete(labelsFor(row, 'annotator1')) && isComplete(labelsFor(row, 'annotator2'))) {
        completedDoubleAnnotationRows += 1;
      }
    }
  });

  return {
    totalRows: rows.length,
    completeRows,
    missingRows: rows.length - completeRows,
    missingByField,
    invalidByField,
    expectedDoubleAnnotationRows,
    completedDoubleAnnotationRows,
  };
}

export { LABEL_FIELDS, REQUIRED_FIELDS, TONES };
