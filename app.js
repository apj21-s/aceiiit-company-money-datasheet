'use strict';

let rootState = dataApi.normalizeData(dataApi.DEFAULT_DATA);
let state = rootState.years[rootState.currentYear];
let lastUpdatedAt = null;
let saveTimer = null;
let pollTimer = null;
let isSaving = false;
let suspendRemoteRefreshUntil = 0;
let isAppReady = false;
let activeUserEmail = '';
let activeUserName = '';
let pendingHighlightEntry = null;

const HISTORY_PREVIEW_WEEKS = 2;
const HISTORY_PREVIEW_ITEMS = 3;
const HISTORY_LIMIT = 80;

const fmt = value => 'Rs ' + (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const $ = id => document.getElementById(id);

function currentYear() {
  return String(rootState.currentYear);
}

function setCurrentYear(year) {
  const key = String(year);
  rootState.currentYear = key;
  rootState.years[key] = rootState.years[key] || dataApi.createBlankYear();
  state = rootState.years[key];
}

function showLoader(title, message) {
  $('loading-title').textContent = title || 'Working';
  $('loading-message').textContent = message || 'Please wait...';
  $('loading-overlay').classList.remove('loading-overlay-hidden');
}

function hideLoader() {
  $('loading-overlay').classList.add('loading-overlay-hidden');
}

function getPeople() {
  return state.people;
}

function getPersonName(personId) {
  const person = getPeople().find(item => item.id === personId);
  return person ? person.name : 'Unassigned';
}

function personInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'NA';
}

function personColorClass(index) {
  return ['green', 'blue', 'amber', 'slate'][index % 4];
}

function personOptions(selectedId) {
  return getPeople().map(person => `<option value="${person.id}" ${person.id === selectedId ? 'selected' : ''}>${esc(person.name)}</option>`).join('');
}

function showLogin(message) {
  $('auth-shell').classList.remove('auth-hidden');
  $('app-shell').classList.add('page-hidden');
  $('auth-message').textContent = message || 'Sign in with an approved team account.';
}

function showApp(email) {
  $('auth-shell').classList.add('auth-hidden');
  $('app-shell').classList.remove('page-hidden');
  $('user-email').textContent = email || '';
}

function setPasswordMessage(message, isError) {
  const el = $('password-message');
  el.textContent = message;
  el.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}

function setSyncStatus(mode, message) {
  const labelMap = {
    loading: 'Loading',
    remote: 'Protected Cloud Mode',
    local: 'Browser Only Mode',
    'local-fallback': 'Fallback Local Mode',
    saving: 'Saving',
  };
  $('sync-source').textContent = labelMap[mode] || mode;
  $('sync-source').className = 'sync-badge sync-' + (mode === 'remote' ? 'remote' : mode === 'saving' ? 'saving' : mode === 'loading' ? 'loading' : 'local');
  $('sync-note').textContent = message || '';
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : date.toLocaleString('en-IN');
}

function updateSyncMeta() {
  $('sync-meta').textContent = lastUpdatedAt ? 'Last synced: ' + formatTimestamp(lastUpdatedAt) : 'Changes save automatically';
}

function toggleMenu(forceOpen) {
  const menu = $('header-menu');
  const trigger = document.querySelector('[data-action="toggle-menu"]');
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : menu.classList.contains('menu-hidden');
  menu.classList.toggle('menu-hidden', !shouldOpen);
  trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function openHistoryModal() {
  $('history-modal').classList.remove('modal-hidden');
  document.body.classList.add('body-locked');
}

function closeHistoryModal() {
  $('history-modal').classList.add('modal-hidden');
  document.body.classList.remove('body-locked');
}

function prettifyField(field) {
  const map = { name: 'Name', price: 'Price', qty: 'Quantity', item: 'Item', list: 'List Price', discount: 'Discount', amount: 'Amount', by: 'Assigned Person', done: 'Status', notes: 'Notes', date: 'Date', share: 'Share Percentage', year: 'Year' };
  return map[field] || field;
}

function prettifySection(section) {
  const map = { people: 'Master People Table', streams: 'Revenue Streams', discounts: 'Discount Reference', expenses: 'Investments / Expenses', withdrawals: 'Withdrawals', years: 'Year Workspace' };
  return map[section] || section;
}

function isTrackedSection(section) {
  return ['people', 'streams', 'discounts', 'expenses', 'withdrawals', 'years'].includes(section);
}

function normalizeComparable(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value) : 0;
  if (typeof value === 'boolean') return value;
  if (value == null) return '';
  return String(value).trim();
}

function formatAuditValue(value) {
  if (value === '' || value == null) return 'blank';
  if (typeof value === 'boolean') return value ? 'Done' : 'Pending';
  return String(value);
}

function areValuesEqual(left, right) {
  return normalizeComparable(left) === normalizeComparable(right);
}

function getWeekStart(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return copy;
}

function getWeekKey(date) {
  return getWeekStart(date).toISOString().slice(0, 10);
}

function getWeekLabel(weekKey) {
  const start = new Date(weekKey + 'T00:00:00');
  if (isNaN(start.getTime())) return 'Recent Updates';
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const endLabel = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function getHistoryEntries() {
  return (Array.isArray(state.meta && state.meta.editHistory) ? state.meta.editHistory : []).filter(entry => isTrackedSection(entry.section));
}

function groupHistory(entries) {
  const groups = [];
  const map = new Map();
  entries.forEach((entry, index) => {
    const key = entry.weekKey || getWeekKey(entry.at || new Date());
    if (!map.has(key)) {
      const group = { key, label: getWeekLabel(key), items: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).items.push({ entry, index });
  });
  return groups;
}

function getHistoryEntryByIndex(index) {
  const history = getHistoryEntries();
  return Number.isInteger(index) && index >= 0 ? history[index] || null : null;
}

function buildHistoryCopy(entry) {
  const changeLine = entry.actionType === 'change'
    ? `${esc(prettifyField(entry.field))}: ${esc(formatAuditValue(entry.previousValue))} -> ${esc(formatAuditValue(entry.newValue))}`
    : esc(entry.details || 'Manual update');
  return `
    <strong>${esc(entry.by || 'Approved User')}</strong> changed <strong>${esc(prettifySection(entry.section || ''))}</strong>${entry.field ? ` (${esc(prettifyField(entry.field))})` : ''}
    <div>${changeLine}</div>
    ${entry.details && entry.actionType === 'change' ? `<div class="history-subline">${esc(entry.details)}</div>` : ''}
    <span class="history-meta">${esc(formatTimestamp(entry.at))}</span>
  `;
}

function buildHistoryMarkup(groups, opts = {}) {
  const isPreview = Boolean(opts.preview);
  if (!groups.length) return '<p class="history-empty">No edit history yet.</p>';
  return groups.map(group => `
    <section class="history-group">
      <div class="history-group-head">
        <span>${esc(group.label)}</span>
        <span>${group.items.length} edit${group.items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="history-group-list">
        ${group.items.map(item => `
          <button class="history-item ${isPreview ? 'history-item-compact' : ''}" data-action="history-jump" data-history-index="${item.index}">
            ${buildHistoryCopy(item.entry)}
          </button>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function updateAuditPanel() {
  const meta = state.meta || {};
  const validSection = isTrackedSection(meta.lastUpdatedSection) ? meta.lastUpdatedSection : '';
  $('audit-by').textContent = meta.lastUpdatedBy ? 'By: ' + meta.lastUpdatedBy + (meta.lastUpdatedAt ? ' on ' + formatTimestamp(meta.lastUpdatedAt) : '') : 'No manual edit recorded yet';
  $('audit-what').textContent = validSection ? 'Section: ' + prettifySection(validSection) + (meta.lastUpdatedField ? ' | Field: ' + prettifyField(meta.lastUpdatedField) : '') : 'Section: Not recorded yet';
}

function renderHistory() {
  const history = getHistoryEntries();
  const groups = groupHistory(history);
  const previewGroups = groups.slice(0, HISTORY_PREVIEW_WEEKS).map(group => ({
    ...group,
    items: group.items.slice(0, HISTORY_PREVIEW_ITEMS),
  }));
  $('history-list').innerHTML = buildHistoryMarkup(previewGroups, { preview: true });
  $('history-modal-body').innerHTML = buildHistoryMarkup(groups);
}

function highlightElement(element, options = {}) {
  if (!element) return;
  const shouldScroll = options.scroll !== false;
  element.classList.remove('cell-highlight');
  void element.offsetWidth;
  element.classList.add('cell-highlight');
  if (shouldScroll) element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  setTimeout(() => element.classList.remove('cell-highlight'), 3600);
}

function highlightSection(section) {
  if (!section) return;
  const card = document.querySelector(`[data-section-card="${section}"]`);
  if (!card) return;
  card.classList.remove('card-highlight');
  void card.offsetWidth;
  card.classList.add('card-highlight');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('card-highlight'), 3200);
}

function locateHistoryTarget(entry) {
  if (!entry) return null;
  if (entry.section === 'streams' && entry.field === 'share' && entry.rowId && entry.personId) {
    return document.querySelector(`[data-table="streams"][data-id="${entry.rowId}"][data-share-person="${entry.personId}"]`);
  }
  if (entry.section && entry.rowId && entry.field) {
    return document.querySelector(`[data-table="${entry.section}"][data-id="${entry.rowId}"][data-field="${entry.field}"]`);
  }
  return null;
}

function focusHistoryEntry(entry) {
  if (!entry) return;
  const target = locateHistoryTarget(entry);
  if (target) {
    highlightSection(entry.section);
    setTimeout(() => highlightElement(target), 140);
    return;
  }
  highlightSection(entry.section);
}

function markManualUpdate(config) {
  const entryTime = new Date();
  const entry = {
    by: activeUserName || activeUserEmail || 'Approved User',
    email: activeUserEmail || '',
    section: config.section || '',
    field: config.field || '',
    details: config.details || '',
    at: entryTime.toISOString(),
    previousValue: config.previousValue ?? '',
    newValue: config.newValue ?? '',
    rowId: config.rowId || '',
    personId: config.personId || '',
    actionType: config.actionType || 'change',
    weekKey: getWeekKey(entryTime),
    year: currentYear(),
  };
  state.meta = state.meta || {};
  state.meta.lastUpdatedBy = entry.by;
  state.meta.lastUpdatedEmail = entry.email;
  state.meta.lastUpdatedSection = entry.section;
  state.meta.lastUpdatedField = entry.field;
  state.meta.lastUpdatedAt = entry.at;
  state.meta.editHistory = Array.isArray(state.meta.editHistory) ? state.meta.editHistory : [];
  state.meta.editHistory.unshift(entry);
  state.meta.editHistory = state.meta.editHistory.slice(0, HISTORY_LIMIT);
  pendingHighlightEntry = entry;
}

function ensureShares() {
  const personIds = getPeople().map(person => person.id);
  state.streams.forEach(stream => {
    stream.shares = stream.shares || {};
    personIds.forEach(id => { stream.shares[id] = Number(stream.shares[id]) || 0; });
    Object.keys(stream.shares).forEach(id => { if (!personIds.includes(id)) delete stream.shares[id]; });
  });
}

function compute() {
  ensureShares();
  const totals = { gross: 0, expenses: 0, distributable: 0, withdrawals: 0, shareByPerson: {}, expenseByPerson: {}, withdrawalByPerson: {}, grossShareByPerson: {} };
  getPeople().forEach(person => {
    totals.shareByPerson[person.id] = 0;
    totals.grossShareByPerson[person.id] = 0;
    totals.expenseByPerson[person.id] = 0;
    totals.withdrawalByPerson[person.id] = 0;
  });
  state.streams.forEach(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    totals.gross += gross;
    getPeople().forEach(person => { totals.grossShareByPerson[person.id] += gross * ((Number(stream.shares[person.id]) || 0) / 100); });
  });
  state.expenses.forEach(expense => {
    totals.expenses += Number(expense.amount) || 0;
    if (expense.by in totals.expenseByPerson) totals.expenseByPerson[expense.by] += Number(expense.amount) || 0;
  });
  totals.distributable = totals.gross - totals.expenses;
  getPeople().forEach(person => {
    const grossShare = totals.grossShareByPerson[person.id] || 0;
    const ratio = totals.gross > 0 ? grossShare / totals.gross : 0;
    totals.shareByPerson[person.id] = totals.distributable * ratio;
  });
  state.withdrawals.forEach(withdrawal => {
    totals.withdrawals += Number(withdrawal.amount) || 0;
    if (withdrawal.by in totals.withdrawalByPerson) totals.withdrawalByPerson[withdrawal.by] += Number(withdrawal.amount) || 0;
  });
  return {
    totals,
    peopleSummary: getPeople().map((person, index) => ({
      id: person.id,
      name: person.name,
      avatar: personInitials(person.name),
      colorClass: personColorClass(index),
      grossShare: totals.grossShareByPerson[person.id] || 0,
      share: totals.shareByPerson[person.id] || 0,
      expense: totals.expenseByPerson[person.id] || 0,
      withdrawn: totals.withdrawalByPerson[person.id] || 0,
      net: (totals.shareByPerson[person.id] || 0) + (totals.expenseByPerson[person.id] || 0) - (totals.withdrawalByPerson[person.id] || 0),
    })),
  };
}

function renderYearControls() {
  const years = Object.keys(rootState.years).sort((a, b) => Number(b) - Number(a));
  $('year-current').textContent = 'Year ' + currentYear();
  $('year-tabs').innerHTML = years.map(year => `
    <div class="year-tab ${year === currentYear() ? 'year-tab-active' : ''}">
      <button class="year-tab-main" data-action="switch-year" data-year="${esc(year)}">
        <span class="year-tab-label">Workspace</span>
        <span class="year-tab-value">${esc(year)}</span>
      </button>
      <button class="year-tab-delete" data-action="delete-year" data-year="${esc(year)}" aria-label="Delete workspace ${esc(year)}" ${years.length <= 1 ? 'disabled' : ''}>Delete</button>
    </div>
  `).join('');
}

function renderMetrics(summary) {
  const cards = [
    { label: 'Year', value: currentYear(), cls: '' },
    { label: 'People', value: String(getPeople().length), cls: '' },
    { label: 'Revenue', value: fmt(summary.totals.gross), cls: '' },
    { label: 'Expenses', value: fmt(summary.totals.expenses), cls: 'red' },
    { label: 'Withdrawals', value: fmt(summary.totals.withdrawals), cls: 'amber' },
    { label: 'Revenue Rows', value: String(state.streams.length), cls: '' },
  ];
  $('metric-grid').innerHTML = cards.map(card => `<div class="metric"><div class="metric-label">${esc(card.label)}</div><div class="metric-value ${card.cls}">${esc(card.value)}</div></div>`).join('');
}

function renderPeopleTable(summary) {
  $('people-body').innerHTML = getPeople().map((person, index) => `
    <tr>
      <td><div class="person-cell"><span class="avatar av-${personColorClass(index)}">${esc(personInitials(person.name))}</span><input class="text-input" type="text" value="${esc(person.name)}" data-table="people" data-id="${person.id}" data-field="name" placeholder="Person name" /></div></td>
      <td class="num">${fmt(summary.totals.grossShareByPerson[person.id] || 0)}</td>
      <td class="num">${fmt(summary.totals.shareByPerson[person.id] || 0)}</td>
      <td class="num">${fmt(summary.totals.expenseByPerson[person.id] || 0)}</td>
      <td class="num">${fmt(summary.totals.withdrawalByPerson[person.id] || 0)}</td>
      <td class="row-actions"><button class="icon-btn" data-action="delete-person" data-id="${person.id}" ${getPeople().length <= 1 ? 'disabled' : ''}>Delete</button></td>
    </tr>
  `).join('');
}

function renderStreams(summary) {
  $('stream-head').innerHTML = `
    <tr>
      <th>Stream</th><th class="num">Price (Rs)</th><th class="num">Qty</th><th class="num">Gross (Rs)</th>
      ${getPeople().map(person => `<th class="num">${esc(person.name)} %</th>`).join('')}
      <th class="num">Total %</th>
      ${getPeople().map(person => `<th class="num">${esc(person.name)} (Rs)</th>`).join('')}
      <th></th>
    </tr>`;
  $('stream-body').innerHTML = state.streams.map(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    const totalPct = getPeople().reduce((sum, person) => sum + (Number(stream.shares[person.id]) || 0), 0);
    return `
      <tr>
        <td><input class="text-input" type="text" value="${esc(stream.name)}" data-table="streams" data-id="${stream.id}" data-field="name" /></td>
        <td class="num"><input type="number" value="${Number(stream.price) || 0}" min="0" step="0.01" data-table="streams" data-id="${stream.id}" data-field="price" /></td>
        <td class="num"><input type="number" class="small-input" value="${Number(stream.qty) || 0}" min="0" step="1" data-table="streams" data-id="${stream.id}" data-field="qty" /></td>
        <td class="num">${fmt(gross)}</td>
        ${getPeople().map(person => `<td class="num"><input type="number" class="small-input" min="0" max="100" step="0.01" value="${Number(stream.shares[person.id]) || 0}" data-table="streams" data-id="${stream.id}" data-share-person="${person.id}" /></td>`).join('')}
        <td class="num ${Math.abs(totalPct - 100) > 0.01 ? 'warn-text' : 'ok-text'}">${totalPct.toFixed(2)}%</td>
        ${getPeople().map(person => `<td class="num">${fmt(gross * ((Number(stream.shares[person.id]) || 0) / 100))}</td>`).join('')}
        <td class="row-actions"><button class="icon-btn" data-action="delete-stream" data-id="${stream.id}">Delete</button></td>
      </tr>`;
  }).join('');
  $('stream-foot').innerHTML = `<tr><td colspan="3">Total</td><td class="num">${fmt(summary.totals.gross)}</td><td colspan="${getPeople().length + 1}"></td>${getPeople().map(person => `<td class="num">${fmt(summary.totals.shareByPerson[person.id] || 0)}</td>`).join('')}<td></td></tr>`;
}

function renderDiscounts() {
  $('discount-body').innerHTML = state.discounts.map(discount => {
    const net = (Number(discount.list) || 0) - (Number(discount.discount) || 0);
    return `<tr><td><input class="text-input" type="text" value="${esc(discount.item)}" data-table="discounts" data-id="${discount.id}" data-field="item" /></td><td class="num"><input type="number" value="${Number(discount.list) || 0}" min="0" step="0.01" data-table="discounts" data-id="${discount.id}" data-field="list" /></td><td class="num"><input type="number" value="${Number(discount.discount) || 0}" min="0" step="0.01" data-table="discounts" data-id="${discount.id}" data-field="discount" /></td><td class="num">${fmt(net)}</td><td class="row-actions"><button class="icon-btn" data-action="delete-discount" data-id="${discount.id}">Delete</button></td></tr>`;
  }).join('');
  const totals = state.discounts.reduce((acc, item) => ({ list: acc.list + (Number(item.list) || 0), discount: acc.discount + (Number(item.discount) || 0) }), { list: 0, discount: 0 });
  $('discount-foot').innerHTML = `<tr><td>Total</td><td class="num">${fmt(totals.list)}</td><td class="num">${fmt(totals.discount)}</td><td class="num">${fmt(totals.list - totals.discount)}</td><td></td></tr>`;
}

function renderExpenses(summary) {
  $('expense-body').innerHTML = state.expenses.map(expense => `<tr><td><input class="text-input" type="text" value="${esc(expense.name)}" data-table="expenses" data-id="${expense.id}" data-field="name" /></td><td class="num"><input type="number" value="${Number(expense.amount) || 0}" min="0" step="0.01" data-table="expenses" data-id="${expense.id}" data-field="amount" /></td><td><select data-table="expenses" data-id="${expense.id}" data-field="by">${personOptions(expense.by)}</select></td><td><select data-table="expenses" data-id="${expense.id}" data-field="done"><option value="true" ${expense.done ? 'selected' : ''}>Done</option><option value="false" ${expense.done ? '' : 'selected'}>Pending</option></select></td><td><input class="text-input" type="text" value="${esc(expense.notes)}" data-table="expenses" data-id="${expense.id}" data-field="notes" /></td><td class="row-actions"><button class="icon-btn" data-action="delete-expense" data-id="${expense.id}">Delete</button></td></tr>`).join('');
  $('expense-foot').innerHTML = `<tr><td>Total</td><td class="num">${fmt(summary.totals.expenses)}</td><td colspan="4"></td></tr>`;
}

function renderWithdrawals(summary) {
  $('wd-body').innerHTML = state.withdrawals.map(withdrawal => `<tr><td><input type="date" value="${esc(withdrawal.date)}" data-table="withdrawals" data-id="${withdrawal.id}" data-field="date" /></td><td class="num"><input type="number" value="${Number(withdrawal.amount) || 0}" min="0" step="0.01" data-table="withdrawals" data-id="${withdrawal.id}" data-field="amount" /></td><td><select data-table="withdrawals" data-id="${withdrawal.id}" data-field="by">${personOptions(withdrawal.by)}</select></td><td class="row-actions"><button class="icon-btn" data-action="delete-withdrawal" data-id="${withdrawal.id}">Delete</button></td></tr>`).join('');
  $('wd-foot').innerHTML = `<tr><td>Total withdrawals</td><td class="num">${fmt(summary.totals.withdrawals)}</td><td colspan="2"></td></tr>`;
}

function renderSettlement(summary) {
  $('settle-body').innerHTML = summary.peopleSummary.map(person => `<tr><td><div class="person-cell"><span class="avatar av-${person.colorClass}">${esc(person.avatar)}</span>${esc(person.name)}</div></td><td class="num">${fmt(person.share)}</td><td class="num">${fmt(person.expense)}</td><td class="num">${fmt(person.withdrawn)}</td><td class="num ${person.net >= 0 ? 'bal-pos' : 'bal-neg'}">${fmt(person.net)}</td><td>${person.net > 0 ? 'Owed' : person.net < 0 ? 'Excess withdrawn' : 'Settled'}</td></tr>`).join('');
  $('settle-foot').innerHTML = `<tr><td>Total</td><td class="num">${fmt(summary.totals.distributable)}</td><td class="num">${fmt(summary.totals.expenses)}</td><td class="num">${fmt(summary.totals.withdrawals)}</td><td class="num">${fmt(summary.totals.distributable + summary.totals.expenses - summary.totals.withdrawals)}</td><td>Final share + expenses = total revenue</td></tr>`;
}

function render() {
  const summary = compute();
  renderYearControls();
  renderMetrics(summary);
  renderPeopleTable(summary);
  renderStreams(summary);
  renderDiscounts();
  renderExpenses(summary);
  renderWithdrawals(summary);
  renderSettlement(summary);
  updateSyncMeta();
  updateAuditPanel();
  renderHistory();
  if (pendingHighlightEntry) {
    const entryToHighlight = pendingHighlightEntry;
    pendingHighlightEntry = null;
    requestAnimationFrame(() => focusHistoryEntry(entryToHighlight));
  }
}

function parseValue(field, value) {
  if (['amount', 'price', 'qty', 'list', 'discount'].includes(field)) return Number(value) || 0;
  if (field === 'done') return value === 'true';
  return value;
}

function persistRootState() {
  rootState.years[currentYear()] = state;
}

function scheduleSave() {
  if (!isAppReady) return;
  if (saveTimer) clearTimeout(saveTimer);
  setSyncStatus('saving', 'Syncing changes...');
  saveTimer = setTimeout(async () => {
    isSaving = true;
    suspendRemoteRefreshUntil = Date.now() + 15000;
    persistRootState();
    const result = await dataApi.saveData(rootState);
    rootState = result.data;
    setCurrentYear(rootState.currentYear);
    isSaving = false;
    lastUpdatedAt = result.updatedAt || lastUpdatedAt;
    setSyncStatus(result.source, result.source === 'remote' ? 'Only signed-in approved users can access this live sheet.' : 'Authenticated cloud save failed. Local fallback is active.');
    updateSyncMeta();
  }, 280);
}

function updateRecord(table, id, field, value) {
  const record = state[table].find(item => item.id === id);
  if (!record) return;
  const parsedValue = parseValue(field, value);
  if (areValuesEqual(record[field], parsedValue)) return;
  const previousValue = record[field];
  record[field] = parsedValue;
  markManualUpdate({
    section: table,
    field,
    rowId: id,
    previousValue,
    newValue: parsedValue,
    actionType: 'change',
    details: `${prettifyField(field)} changed from ${formatAuditValue(previousValue)} to ${formatAuditValue(parsedValue)}`,
  });
  render();
  scheduleSave();
}

function updateShare(streamId, personId, value) {
  const stream = state.streams.find(item => item.id === streamId);
  if (!stream) return;
  const parsedValue = Number(value) || 0;
  const previousValue = Number(stream.shares[personId]) || 0;
  if (areValuesEqual(previousValue, parsedValue)) return;
  stream.shares[personId] = parsedValue;
  markManualUpdate({
    section: 'streams',
    field: 'share',
    rowId: streamId,
    personId,
    previousValue,
    newValue: parsedValue,
    actionType: 'change',
    details: `${getPersonName(personId)} share changed from ${formatAuditValue(previousValue)} to ${formatAuditValue(parsedValue)}`,
  });
  render();
  scheduleSave();
}

function deletePerson(personId) {
  if (state.people.length <= 1) return;
  const person = state.people.find(item => item.id === personId);
  state.people = state.people.filter(item => item.id !== personId);
  const fallbackId = state.people[0] ? state.people[0].id : '';
  state.expenses.forEach(expense => { if (expense.by === personId) expense.by = fallbackId; });
  state.withdrawals.forEach(withdrawal => { if (withdrawal.by === personId) withdrawal.by = fallbackId; });
  state.streams.forEach(stream => { delete stream.shares[personId]; });
  markManualUpdate({
    section: 'people',
    field: 'name',
    actionType: 'delete',
    previousValue: person ? person.name : '',
    newValue: '',
    details: `Removed ${person ? person.name : 'a person'} from the master table`,
  });
  render();
  scheduleSave();
}

function addRow(type) {
  const firstPersonId = getPeople()[0] ? getPeople()[0].id : '';
  let record = null;
  if (type === 'people') {
    record = { id: 'p_' + Date.now(), name: '' };
    state.people.push(record);
  }
  if (type === 'streams') {
    record = { id: 's_' + Date.now(), name: '', price: 0, qty: 0, shares: Object.fromEntries(getPeople().map(person => [person.id, 0])) };
    state.streams.push(record);
  }
  if (type === 'discounts') {
    record = { id: 'd_' + Date.now(), item: '', list: 0, discount: 0 };
    state.discounts.push(record);
  }
  if (type === 'expenses') {
    record = { id: 'e_' + Date.now(), name: '', amount: 0, by: firstPersonId, done: false, notes: '' };
    state.expenses.push(record);
  }
  if (type === 'withdrawals') {
    record = { id: 'w_' + Date.now(), date: new Date().toISOString().slice(0, 10), amount: 0, by: firstPersonId };
    state.withdrawals.push(record);
  }
  const primaryField = type === 'discounts' ? 'item' : type === 'withdrawals' ? 'amount' : 'name';
  markManualUpdate({
    section: type,
    field: primaryField,
    rowId: record && record.id ? record.id : '',
    actionType: 'create',
    previousValue: '',
    newValue: '',
    details: `Added a new row in ${prettifySection(type)}`,
  });
  render();
  scheduleSave();
}

function deleteRow(action, id) {
  let removed = null;
  let section = '';
  if (action === 'delete-person') return deletePerson(id);
  if (action === 'delete-stream') {
    section = 'streams';
    removed = state.streams.find(item => item.id === id);
    state.streams = state.streams.filter(item => item.id !== id);
  }
  if (action === 'delete-discount') {
    section = 'discounts';
    removed = state.discounts.find(item => item.id === id);
    state.discounts = state.discounts.filter(item => item.id !== id);
  }
  if (action === 'delete-expense') {
    section = 'expenses';
    removed = state.expenses.find(item => item.id === id);
    state.expenses = state.expenses.filter(item => item.id !== id);
  }
  if (action === 'delete-withdrawal') {
    section = 'withdrawals';
    removed = state.withdrawals.find(item => item.id === id);
    state.withdrawals = state.withdrawals.filter(item => item.id !== id);
  }
  if (!section) return;
  markManualUpdate({
    section,
    field: 'name',
    actionType: 'delete',
    previousValue: removed && (removed.name || removed.item || removed.amount || removed.date) ? (removed.name || removed.item || removed.amount || removed.date) : '',
    newValue: '',
    details: `Deleted a row from ${prettifySection(section)}`,
  });
  render();
  scheduleSave();
}

function changeYear(year) {
  if (!year) return;
  setCurrentYear(year);
  persistRootState();
  render();
  scheduleSave();
}

function addNewYear(year) {
  const key = String(year).trim();
  if (!/^\d{4}$/.test(key)) return;
  if (!rootState.years[key]) rootState.years[key] = dataApi.createBlankYear();
  setCurrentYear(key);
  persistRootState();
  render();
  scheduleSave();
}

function deleteYear(year) {
  const key = String(year).trim();
  const years = Object.keys(rootState.years);
  if (!rootState.years[key] || years.length <= 1) return;
  delete rootState.years[key];
  if (currentYear() === key) {
    const fallbackYear = Object.keys(rootState.years).sort((a, b) => Number(b) - Number(a))[0];
    setCurrentYear(fallbackYear);
  }
  persistRootState();
  render();
  scheduleSave();
}

function handleFieldEdit(event) {
  if (!isAppReady) return;
  const target = event.target;
  const table = target.dataset.table;
  const id = target.dataset.id;
  const field = target.dataset.field;
  const sharePerson = target.dataset.sharePerson;
  if (table && id && field) updateRecord(table, id, field, target.value);
  if (table === 'streams' && id && sharePerson) updateShare(id, sharePerson, target.value);
}

document.addEventListener('change', handleFieldEdit);

document.addEventListener('focusout', event => {
  if (!event.target.matches('[data-table]')) return;
  handleFieldEdit(event);
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === 'export') exportCSV();
  else if (action === 'sync-now') refreshFromRemote(true);
  else if (action === 'sign-out') {
    showLoader('Signing Out', 'Closing your protected session...');
    await authApi.signOut();
  }
  else if (action === 'switch-year') changeYear(button.dataset.year);
  else if (action === 'delete-year') deleteYear(button.dataset.year);
  else if (action === 'toggle-menu') toggleMenu();
  else if (action === 'open-history') openHistoryModal();
  else if (action === 'close-history') closeHistoryModal();
  else if (action === 'history-jump') {
    const entry = getHistoryEntryByIndex(Number(button.dataset.historyIndex));
    if (entry) {
      closeHistoryModal();
      focusHistoryEntry(entry);
    }
  }
  else if (action.startsWith('add-')) addRow(action.replace('add-', ''));
  else deleteRow(action, id);
});

document.addEventListener('click', event => {
  const menu = $('header-menu');
  const trigger = document.querySelector('[data-action="toggle-menu"]');
  if (!menu || menu.classList.contains('menu-hidden')) return;
  if (menu.contains(event.target) || trigger.contains(event.target)) return;
  toggleMenu(false);
});

document.addEventListener('click', event => {
  const modal = $('history-modal');
  if (!modal || modal.classList.contains('modal-hidden')) return;
  if (event.target === modal) closeHistoryModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeHistoryModal();
    toggleMenu(false);
  }
});

function exportCSV() {
  const summary = compute();
  const rows = [];
  const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  rows.push(['YEAR', currentYear()]);
  rows.push([]);
  rows.push(['PEOPLE']);
  rows.push(['Name', 'Gross Share', 'Final Share After Expenses', 'Expenses', 'Withdrawals']);
  summary.peopleSummary.forEach(person => rows.push([person.name, person.grossShare.toFixed(2), person.share.toFixed(2), person.expense.toFixed(2), person.withdrawn.toFixed(2)]));
  rows.push([]);
  rows.push(['REVENUE STREAMS']);
  rows.push(['Stream', 'Price', 'Qty', 'Gross', ...getPeople().map(person => `${person.name} %`), ...getPeople().map(person => `${person.name} Amount`)]);
  state.streams.forEach(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    rows.push([stream.name, Number(stream.price) || 0, Number(stream.qty) || 0, gross.toFixed(2), ...getPeople().map(person => Number(stream.shares[person.id]) || 0), ...getPeople().map(person => (gross * ((Number(stream.shares[person.id]) || 0) / 100)).toFixed(2))]);
  });
  const csv = rows.map(row => row.map(q).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'company_datasheet_' + currentYear() + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshFromRemote(force) {
  if (!isAppReady || !dataApi.hasRemoteConfig()) return;
  if (!force && (isSaving || Date.now() < suspendRemoteRefreshUntil)) return;
  try {
    if (force) setSyncStatus('saving', 'Refreshing latest shared data...');
    const result = await dataApi.loadData();
    if (result.source === 'remote' && result.updatedAt && result.updatedAt !== lastUpdatedAt) {
      rootState = result.data;
      setCurrentYear(rootState.currentYear);
      lastUpdatedAt = result.updatedAt;
      pendingHighlightEntry = getHistoryEntries()[0] || null;
      render();
      setSyncStatus('remote', force ? 'Protected shared data refreshed.' : 'Received latest updates from another approved user.');
    }
  } catch (error) {
    console.error(error);
    if (force) setSyncStatus('remote', 'Could not refresh right now.');
  }
}

function startPolling() {
  if (!dataApi.hasRemoteConfig()) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshFromRemote(false), 12000);
}

async function bootAuthorizedApp(email) {
  activeUserEmail = email || '';
  activeUserName = authApi.getAllowedName(activeUserEmail) || activeUserEmail;
  showApp(activeUserEmail);
  setSyncStatus('loading', 'Loading protected datasheet...');
  showLoader('Opening Workspace', 'Loading the protected ACE-IIIT datasheet for your account...');
  const result = await dataApi.loadData();
  rootState = result.data;
  setCurrentYear(rootState.currentYear);
  lastUpdatedAt = result.updatedAt || null;
  pendingHighlightEntry = getHistoryEntries()[0] || null;
  render();
  isAppReady = true;
  setSyncStatus(result.source, result.source === 'remote' ? 'Only approved signed-in users can access this live sheet.' : 'Signed in, but remote access is unavailable.');
  startPolling();
  hideLoader();
}

async function handleAuthState(detail) {
  const session = detail && detail.session;
  const authorized = detail && detail.authorized;
  const reason = detail && detail.reason;
  if (!session || !authorized) {
    isAppReady = false;
    activeUserEmail = '';
    if (pollTimer) clearInterval(pollTimer);
    showLogin(reason === 'email-unverified'
      ? 'Your email is not verified yet. Check your inbox before signing in.'
      : reason === 'unauthorized'
        ? 'This account is not approved. Use one of the three allowed team logins.'
        : 'Sign in with an approved team account to access the datasheet.');
    hideLoader();
    return;
  }
  if (session.user && session.user.email) {
    $('login-password').value = '';
    await bootAuthorizedApp(session.user.email);
  }
}

function setupLoginForm() {
  $('auth-allowed').textContent = 'Allowed team accounts: ' + authApi.getAllowedDisplay();
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    $('auth-message').textContent = 'Signing in...';
    showLoader('Signing In', 'Verifying your account and unlocking the protected datasheet...');
    const { error } = await authApi.signInWithPassword(email, password);
    if (error) {
      $('auth-message').textContent = error.message || 'Could not sign in.';
      hideLoader();
    }
  });

  $('forgot-form').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('forgot-email').value.trim();
    $('auth-message').textContent = 'Sending reset link...';
    showLoader('Sending Reset Link', 'Preparing a secure password reset email...');
    const { error } = await authApi.sendPasswordReset(email);
    $('auth-message').textContent = error ? (error.message || 'Could not send reset link.') : 'Reset link sent. Check that email inbox.';
    hideLoader();
  });

  $('password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('new-password').value;
    const confirm = $('confirm-password').value;
    if (!password || password.length < 8) return setPasswordMessage('Use at least 8 characters for the new password.', true);
    if (password !== confirm) return setPasswordMessage('New password and confirm password do not match.', true);
    setPasswordMessage('Updating password...', false);
    showLoader('Updating Password', 'Applying your new password securely...');
    const { error } = await authApi.updatePassword(password);
    if (error) {
      setPasswordMessage(error.message || 'Could not update password.', true);
      hideLoader();
      return;
    }
    $('new-password').value = '';
    $('confirm-password').value = '';
    setPasswordMessage('Password updated successfully.', false);
    hideLoader();
  });

  $('year-form').addEventListener('submit', event => {
    event.preventDefault();
    addNewYear($('new-year-input').value);
    $('new-year-input').value = '';
  });
}

window.addEventListener('auth-state-changed', event => handleAuthState(event.detail));

async function init() {
  setupLoginForm();
  showLogin('Checking session...');
  showLoader('Preparing Datasheet', 'Checking your session and connecting to the protected workspace...');
  await authApi.init();
  if (!$('auth-shell').classList.contains('auth-hidden')) hideLoader();
}

init();
