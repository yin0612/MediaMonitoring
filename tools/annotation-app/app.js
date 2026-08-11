import {
  labelsFor,
  machineSuggestionFor,
  parseJsonl,
  safeArticleUrl,
  serializeJsonl,
  updateAnnotation,
  validateRows,
} from './annotation-core.mjs';

const state = { rows: [], drafts: [], index: 0, mode: 'consensus', candidateName: 'annotation-candidates.jsonl' };
const sessionKey = 'media-monitoring-annotation-app-v1';
const byId = (id) => document.getElementById(id);
const inputs = {
  candidate: byId('candidate-file'),
  draft: byId('machine-draft-file'),
  mode: byId('annotation-mode'),
  eventCluster: byId('event-cluster'),
  tone: byId('text-tone'),
  target: byId('target'),
  stance: byId('target-stance'),
  entities: byId('entities'),
};

function activeRow() {
  return state.rows[state.index] || null;
}

function sessionPayload() {
  return JSON.stringify({ rows: state.rows, drafts: state.drafts, index: state.index, mode: state.mode, candidateName: state.candidateName });
}

function persist() {
  try { sessionStorage.setItem(sessionKey, sessionPayload()); } catch { /* Browser storage is optional. */ }
}

function setStatus(id, message) {
  byId(id).textContent = message;
}

function selectedTopics() {
  return [...document.querySelectorAll('#topic-choices input:checked')].map((input) => input.value);
}

function formLabels() {
  return {
    eventCluster: inputs.eventCluster.value,
    topics: selectedTopics(),
    entities: inputs.entities.value.split(',').map((value) => value.trim()).filter(Boolean),
    textTone: inputs.tone.value,
    target: inputs.target.value,
    targetStance: inputs.stance.value,
  };
}

function showLabels(labels) {
  inputs.eventCluster.value = labels.eventCluster || '';
  inputs.tone.value = labels.textTone || '';
  inputs.target.value = labels.target || '';
  inputs.stance.value = labels.targetStance || '';
  inputs.entities.value = (labels.entities || []).join(', ');
  const topics = new Set(labels.topics || []);
  document.querySelectorAll('#topic-choices input').forEach((input) => { input.checked = topics.has(input.value); });
}

function showMachineSuggestion(row) {
  const suggestion = machineSuggestionFor(row, state.drafts);
  const panel = byId('machine-suggestion');
  panel.hidden = !suggestion;
  if (suggestion) byId('machine-suggestion-content').textContent = JSON.stringify(suggestion, null, 2);
  byId('copy-machine-suggestion').onclick = () => {
    if (!suggestion) return;
    showLabels(suggestion);
    setStatus('save-status', '機器建議已帶入表單；請人工覆核後再儲存。');
  };
}

function syncMode(row) {
  const canDoubleAnnotate = row?.doubleAnnotation === true;
  ['annotator1', 'annotator2'].forEach((mode) => {
    inputs.mode.querySelector(`option[value="${mode}"]`).disabled = !canDoubleAnnotate;
  });
  if (!canDoubleAnnotate && state.mode !== 'consensus') state.mode = 'consensus';
  inputs.mode.value = state.mode;
  byId('mode-note').textContent = canDoubleAnnotate
    ? '這筆資料需要兩名標註者獨立完成；請不要在獨立標註時查看對方欄位。'
    : '此筆不是雙人標註列，只能寫入正式／共識欄位。';
}

function render() {
  const row = activeRow();
  byId('workspace').hidden = !row;
  byId('download-jsonl').disabled = !row;
  if (!row) return;

  syncMode(row);
  const report = validateRows(state.rows);
  byId('row-position').textContent = `${state.index + 1} / ${state.rows.length}`;
  byId('completion-count').textContent = `${report.completeRows} / ${report.totalRows}`;
  byId('double-count').textContent = `${report.completedDoubleAnnotationRows} / ${report.expectedDoubleAnnotationRows}`;
  byId('article-split').textContent = row.split || 'unknown split';
  byId('article-double').textContent = row.doubleAnnotation ? '雙人標註' : '單人標註';
  byId('article-source').textContent = row.source || '未知來源';
  byId('article-time').textContent = row.publishedAt || '';
  byId('article-title').textContent = row.title || '（無標題）';
  byId('article-excerpt').textContent = row.excerpt || '（無摘要；資料不足時請使用 uncertain，勿猜測。）';
  const articleUrl = safeArticleUrl(row.url);
  byId('article-link').href = articleUrl || '#';
  byId('article-link').hidden = !articleUrl;
  showLabels(labelsFor(row, state.mode));
  showMachineSuggestion(row);
  byId('previous-row').disabled = state.index === 0;
  byId('next-row').disabled = state.index >= state.rows.length - 1;
}

async function loadFile(input, onLoad) {
  const [file] = input.files || [];
  if (!file) return;
  try {
    const rows = parseJsonl(await file.text());
    onLoad(rows, file.name);
  } catch (error) {
    setStatus('import-status', `無法讀取檔案：${error.message}`);
  }
}

inputs.candidate.addEventListener('change', () => loadFile(inputs.candidate, (rows, name) => {
  state.rows = rows;
  state.index = 0;
  state.candidateName = name;
  persist();
  setStatus('import-status', `已載入 ${rows.length} 筆待標註資料。`);
  render();
}));

inputs.draft.addEventListener('change', () => loadFile(inputs.draft, (rows) => {
  state.drafts = rows;
  persist();
  setStatus('import-status', `已載入 ${state.rows.length} 筆候選資料與 ${rows.length} 筆機器建議。`);
  render();
}));

inputs.mode.addEventListener('change', () => {
  state.mode = inputs.mode.value;
  persist();
  render();
});

byId('annotation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const labels = formLabels();
  if (!labels.eventCluster || !labels.topics.length || !labels.textTone || !labels.target || !labels.targetStance) {
    setStatus('save-status', '請填寫所有標示 * 的欄位；資料不足請使用 uncertain。');
    return;
  }
  try {
    state.rows = updateAnnotation(state.rows, state.index, labels, state.mode);
    persist();
    setStatus('save-status', '已儲存於本機瀏覽器；請定期下載 JSONL 備份。');
    render();
  } catch (error) {
    setStatus('save-status', error.message);
  }
});

byId('previous-row').addEventListener('click', () => { state.index -= 1; persist(); render(); });
byId('next-row').addEventListener('click', () => { state.index += 1; persist(); render(); });
byId('download-jsonl').addEventListener('click', () => {
  const blob = new Blob([serializeJsonl(state.rows)], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = state.candidateName.replace(/\.jsonl$/i, '') + '-reviewed.jsonl';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('save-status', '已下載 JSONL；請以此檔案執行評估器。');
});

try {
  const saved = sessionStorage.getItem(sessionKey);
  if (saved) {
    Object.assign(state, JSON.parse(saved));
    setStatus('import-status', `已還原同一瀏覽器工作階段的 ${state.rows.length} 筆資料。`);
    render();
  }
} catch { sessionStorage.removeItem(sessionKey); }
