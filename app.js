'use strict';

let state = loadData();

const fmt = value => 'Rs ' + (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const $ = id => document.getElementById(id);

function getPeople() {
  return state.people;
}

function getPersonName(personId) {
  const person = getPeople().find(item => item.id === personId);
  return person ? person.name : 'Unassigned';
}

function personInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || 'NA';
}

function personColorClass(index) {
  return ['green', 'blue', 'amber', 'slate'][index % 4];
}

function personOptions(selectedId) {
  return getPeople().map(person => (
    `<option value="${person.id}" ${person.id === selectedId ? 'selected' : ''}>${esc(person.name)}</option>`
  )).join('');
}

function ensureShares() {
  const personIds = getPeople().map(person => person.id);
  state.streams.forEach(stream => {
    stream.shares = stream.shares || {};
    personIds.forEach(id => {
      stream.shares[id] = Number(stream.shares[id]) || 0;
    });
    Object.keys(stream.shares).forEach(id => {
      if (!personIds.includes(id)) delete stream.shares[id];
    });
  });
}

function compute() {
  ensureShares();

  const people = getPeople();
  const totals = {
    gross: 0,
    expenses: 0,
    withdrawals: 0,
    shareByPerson: {},
    expenseByPerson: {},
    withdrawalByPerson: {},
  };

  people.forEach(person => {
    totals.shareByPerson[person.id] = 0;
    totals.expenseByPerson[person.id] = 0;
    totals.withdrawalByPerson[person.id] = 0;
  });

  state.streams.forEach(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    totals.gross += gross;
    people.forEach(person => {
      totals.shareByPerson[person.id] += gross * ((Number(stream.shares[person.id]) || 0) / 100);
    });
  });

  state.expenses.forEach(expense => {
    totals.expenses += Number(expense.amount) || 0;
    if (expense.by in totals.expenseByPerson) {
      totals.expenseByPerson[expense.by] += Number(expense.amount) || 0;
    }
  });

  state.withdrawals.forEach(withdrawal => {
    totals.withdrawals += Number(withdrawal.amount) || 0;
    if (withdrawal.by in totals.withdrawalByPerson) {
      totals.withdrawalByPerson[withdrawal.by] += Number(withdrawal.amount) || 0;
    }
  });

  const peopleSummary = people.map((person, index) => {
    const share = totals.shareByPerson[person.id] || 0;
    const expense = totals.expenseByPerson[person.id] || 0;
    const withdrawn = totals.withdrawalByPerson[person.id] || 0;
    return {
      id: person.id,
      name: person.name,
      avatar: personInitials(person.name),
      colorClass: personColorClass(index),
      share,
      expense,
      withdrawn,
      net: share - withdrawn,
    };
  });

  return { totals, peopleSummary };
}

function persistAndRender() {
  saveData(state);
  render();
}

function renderMetrics(summary) {
  const cards = [
    { label: 'People', value: String(getPeople().length), cls: '' },
    { label: 'Revenue', value: fmt(summary.totals.gross), cls: '' },
    { label: 'Expenses', value: fmt(summary.totals.expenses), cls: 'red' },
    { label: 'Withdrawals', value: fmt(summary.totals.withdrawals), cls: 'amber' },
    { label: 'Revenue Rows', value: String(state.streams.length), cls: '' },
    { label: 'Expense Rows', value: String(state.expenses.length), cls: '' },
    { label: 'Withdrawal Rows', value: String(state.withdrawals.length), cls: '' },
  ];

  $('metric-grid').innerHTML = cards.map(card => `
    <div class="metric">
      <div class="metric-label">${esc(card.label)}</div>
      <div class="metric-value ${card.cls}">${esc(card.value)}</div>
    </div>
  `).join('');
}

function renderPeopleTable(summary) {
  const tbody = $('people-body');
  tbody.innerHTML = getPeople().map((person, index) => `
    <tr>
      <td>
        <div class="person-cell">
          <span class="avatar av-${personColorClass(index)}">${esc(personInitials(person.name))}</span>
          <input class="text-input" type="text" value="${esc(person.name)}" data-table="people" data-id="${person.id}" data-field="name" placeholder="Person name" />
        </div>
      </td>
      <td class="num">${fmt(summary.totals.shareByPerson[person.id] || 0)}</td>
      <td class="num">${fmt(summary.totals.expenseByPerson[person.id] || 0)}</td>
      <td class="num">${fmt(summary.totals.withdrawalByPerson[person.id] || 0)}</td>
      <td class="row-actions">
        <button class="icon-btn" data-action="delete-person" data-id="${person.id}" ${getPeople().length <= 1 ? 'disabled' : ''}>Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderStreams(summary) {
  const people = getPeople();
  $('stream-head').innerHTML = `
    <tr>
      <th>Stream</th>
      <th class="num">Price (Rs)</th>
      <th class="num">Qty</th>
      <th class="num">Gross (Rs)</th>
      ${people.map(person => `<th class="num">${esc(person.name)} %</th>`).join('')}
      <th class="num">Total %</th>
      ${people.map(person => `<th class="num">${esc(person.name)} (Rs)</th>`).join('')}
      <th></th>
    </tr>
  `;

  $('stream-body').innerHTML = state.streams.map(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    const sharePctCols = people.map(person => `
      <td class="num">
        <input type="number" class="small-input" min="0" max="100" step="0.01"
          value="${Number(stream.shares[person.id]) || 0}"
          data-table="streams" data-id="${stream.id}" data-share-person="${person.id}" />
      </td>
    `).join('');
    const shareAmountCols = people.map(person => `
      <td class="num">${fmt(gross * ((Number(stream.shares[person.id]) || 0) / 100))}</td>
    `).join('');
    const totalPct = people.reduce((sum, person) => sum + (Number(stream.shares[person.id]) || 0), 0);
    const warnClass = Math.abs(totalPct - 100) > 0.01 ? 'warn-text' : 'ok-text';

    return `
      <tr>
        <td><input class="text-input" type="text" value="${esc(stream.name)}" data-table="streams" data-id="${stream.id}" data-field="name" placeholder="Revenue stream" /></td>
        <td class="num"><input type="number" value="${Number(stream.price) || 0}" min="0" step="0.01" data-table="streams" data-id="${stream.id}" data-field="price" /></td>
        <td class="num"><input type="number" class="small-input" value="${Number(stream.qty) || 0}" min="0" step="1" data-table="streams" data-id="${stream.id}" data-field="qty" /></td>
        <td class="num">${fmt(gross)}</td>
        ${sharePctCols}
        <td class="num ${warnClass}">${totalPct.toFixed(2)}%</td>
        ${shareAmountCols}
        <td class="row-actions"><button class="icon-btn" data-action="delete-stream" data-id="${stream.id}">Delete</button></td>
      </tr>
    `;
  }).join('');

  const totalShareAmounts = people.map(person => `<td class="num">${fmt(summary.totals.shareByPerson[person.id] || 0)}</td>`).join('');
  $('stream-foot').innerHTML = `
    <tr>
      <td colspan="3">Total</td>
      <td class="num">${fmt(summary.totals.gross)}</td>
      <td colspan="${people.length + 1}"></td>
      ${totalShareAmounts}
      <td></td>
    </tr>
  `;
}

function renderDiscounts() {
  $('discount-body').innerHTML = state.discounts.map(discount => {
    const net = (Number(discount.list) || 0) - (Number(discount.discount) || 0);
    return `
      <tr>
        <td><input class="text-input" type="text" value="${esc(discount.item)}" data-table="discounts" data-id="${discount.id}" data-field="item" placeholder="Item name" /></td>
        <td class="num"><input type="number" value="${Number(discount.list) || 0}" min="0" step="0.01" data-table="discounts" data-id="${discount.id}" data-field="list" /></td>
        <td class="num"><input type="number" value="${Number(discount.discount) || 0}" min="0" step="0.01" data-table="discounts" data-id="${discount.id}" data-field="discount" /></td>
        <td class="num">${fmt(net)}</td>
        <td class="row-actions"><button class="icon-btn" data-action="delete-discount" data-id="${discount.id}">Delete</button></td>
      </tr>
    `;
  }).join('');

  const totals = state.discounts.reduce((acc, item) => {
    acc.list += Number(item.list) || 0;
    acc.discount += Number(item.discount) || 0;
    return acc;
  }, { list: 0, discount: 0 });

  $('discount-foot').innerHTML = `
    <tr>
      <td>Total</td>
      <td class="num">${fmt(totals.list)}</td>
      <td class="num">${fmt(totals.discount)}</td>
      <td class="num">${fmt(totals.list - totals.discount)}</td>
      <td></td>
    </tr>
  `;
}

function renderExpenses(summary) {
  $('expense-body').innerHTML = state.expenses.map(expense => `
    <tr>
      <td><input class="text-input" type="text" value="${esc(expense.name)}" data-table="expenses" data-id="${expense.id}" data-field="name" placeholder="Expense name" /></td>
      <td class="num"><input type="number" value="${Number(expense.amount) || 0}" min="0" step="0.01" data-table="expenses" data-id="${expense.id}" data-field="amount" /></td>
      <td>
        <select data-table="expenses" data-id="${expense.id}" data-field="by">
          ${personOptions(expense.by)}
        </select>
      </td>
      <td>
        <select data-table="expenses" data-id="${expense.id}" data-field="done">
          <option value="true" ${expense.done ? 'selected' : ''}>Done</option>
          <option value="false" ${expense.done ? '' : 'selected'}>Pending</option>
        </select>
      </td>
      <td><input class="text-input" type="text" value="${esc(expense.notes)}" data-table="expenses" data-id="${expense.id}" data-field="notes" placeholder="Notes" /></td>
      <td class="row-actions"><button class="icon-btn" data-action="delete-expense" data-id="${expense.id}">Delete</button></td>
    </tr>
  `).join('');

  $('expense-foot').innerHTML = `
    <tr>
      <td>Total</td>
      <td class="num">${fmt(summary.totals.expenses)}</td>
      <td colspan="4"></td>
    </tr>
  `;
}

function renderWithdrawals(summary) {
  $('wd-body').innerHTML = state.withdrawals.map(withdrawal => `
    <tr>
      <td><input type="date" value="${esc(withdrawal.date)}" data-table="withdrawals" data-id="${withdrawal.id}" data-field="date" /></td>
      <td class="num"><input type="number" value="${Number(withdrawal.amount) || 0}" min="0" step="0.01" data-table="withdrawals" data-id="${withdrawal.id}" data-field="amount" /></td>
      <td>
        <select data-table="withdrawals" data-id="${withdrawal.id}" data-field="by">
          ${personOptions(withdrawal.by)}
        </select>
      </td>
      <td class="row-actions"><button class="icon-btn" data-action="delete-withdrawal" data-id="${withdrawal.id}">Delete</button></td>
    </tr>
  `).join('');

  $('wd-foot').innerHTML = `
    <tr>
      <td>Total withdrawals</td>
      <td class="num">${fmt(summary.totals.withdrawals)}</td>
      <td colspan="2"></td>
    </tr>
  `;
}

function renderSettlement(summary) {
  $('settle-body').innerHTML = summary.peopleSummary.map(person => `
    <tr>
      <td>
        <div class="person-cell">
          <span class="avatar av-${person.colorClass}">${esc(person.avatar)}</span>
          ${esc(person.name)}
        </div>
      </td>
      <td class="num">${fmt(person.share)}</td>
      <td class="num">${fmt(person.expense)}</td>
      <td class="num">${fmt(person.withdrawn)}</td>
      <td class="num ${person.net >= 0 ? 'bal-pos' : 'bal-neg'}">${fmt(person.net)}</td>
      <td>${person.net > 0 ? 'Owed' : person.net < 0 ? 'Excess withdrawn' : 'Settled'}</td>
    </tr>
  `).join('');
}

function render() {
  const summary = compute();
  renderMetrics(summary);
  renderPeopleTable(summary);
  renderStreams(summary);
  renderDiscounts();
  renderExpenses(summary);
  renderWithdrawals(summary);
  renderSettlement(summary);
}

function parseValue(field, value) {
  if (field === 'amount' || field === 'price' || field === 'qty' || field === 'list' || field === 'discount') {
    return Number(value) || 0;
  }
  if (field === 'done') {
    return value === 'true';
  }
  return value;
}

function updateRecord(table, id, field, value) {
  const record = state[table].find(item => item.id === id);
  if (!record) return;
  record[field] = parseValue(field, value);
  persistAndRender();
}

function updateShare(streamId, personId, value) {
  const stream = state.streams.find(item => item.id === streamId);
  if (!stream) return;
  stream.shares[personId] = Number(value) || 0;
  persistAndRender();
}

function deletePerson(personId) {
  if (state.people.length <= 1) return;
  state.people = state.people.filter(person => person.id !== personId);

  const fallbackId = state.people[0] ? state.people[0].id : '';
  state.expenses.forEach(expense => {
    if (expense.by === personId) expense.by = fallbackId;
  });
  state.withdrawals.forEach(withdrawal => {
    if (withdrawal.by === personId) withdrawal.by = fallbackId;
  });
  state.streams.forEach(stream => {
    delete stream.shares[personId];
  });

  persistAndRender();
}

function addRow(type) {
  const firstPersonId = getPeople()[0] ? getPeople()[0].id : '';

  if (type === 'people') state.people.push({ id: 'p_' + Date.now(), name: 'New Person' });
  if (type === 'streams') state.streams.push({ id: 's_' + Date.now(), name: '', price: 0, qty: 0, shares: Object.fromEntries(getPeople().map(person => [person.id, 0])) });
  if (type === 'discounts') state.discounts.push({ id: 'd_' + Date.now(), item: '', list: 0, discount: 0 });
  if (type === 'expenses') state.expenses.push({ id: 'e_' + Date.now(), name: '', amount: 0, by: firstPersonId, done: false, notes: '' });
  if (type === 'withdrawals') state.withdrawals.push({ id: 'w_' + Date.now(), date: new Date().toISOString().slice(0, 10), amount: 0, by: firstPersonId });

  persistAndRender();
}

function deleteRow(action, id) {
  if (action === 'delete-stream') state.streams = state.streams.filter(item => item.id !== id);
  if (action === 'delete-discount') state.discounts = state.discounts.filter(item => item.id !== id);
  if (action === 'delete-expense') state.expenses = state.expenses.filter(item => item.id !== id);
  if (action === 'delete-withdrawal') state.withdrawals = state.withdrawals.filter(item => item.id !== id);
  if (action === 'delete-person') deletePerson(id);
  if (action !== 'delete-person') persistAndRender();
}

function handleFieldEdit(event) {
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
  const target = event.target;
  if (!target.matches('[data-table]')) return;
  handleFieldEdit(event);
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === 'export') exportCSV();
  else if (action === 'reset') resetAll();
  else if (action.startsWith('add-')) addRow(action.replace('add-', ''));
  else deleteRow(action, id);
});

function exportCSV() {
  const summary = compute();
  const rows = [];
  const people = getPeople();
  const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

  rows.push(['PEOPLE']);
  rows.push(['Name', 'Revenue Share', 'Expenses', 'Withdrawals']);
  summary.peopleSummary.forEach(person => rows.push([person.name, person.share.toFixed(2), person.expense.toFixed(2), person.withdrawn.toFixed(2)]));

  rows.push([]);
  rows.push(['REVENUE STREAMS']);
  rows.push(['Stream', 'Price', 'Qty', 'Gross', ...people.map(person => `${person.name} %`), ...people.map(person => `${person.name} Amount`)]);
  state.streams.forEach(stream => {
    const gross = (Number(stream.price) || 0) * (Number(stream.qty) || 0);
    rows.push([
      stream.name,
      Number(stream.price) || 0,
      Number(stream.qty) || 0,
      gross.toFixed(2),
      ...people.map(person => Number(stream.shares[person.id]) || 0),
      ...people.map(person => (gross * ((Number(stream.shares[person.id]) || 0) / 100)).toFixed(2)),
    ]);
  });

  rows.push([]);
  rows.push(['DISCOUNTS']);
  rows.push(['Item', 'List Price', 'Discount', 'Net']);
  state.discounts.forEach(item => rows.push([item.item, item.list, item.discount, (item.list - item.discount).toFixed(2)]));

  rows.push([]);
  rows.push(['EXPENSES']);
  rows.push(['Expense', 'Amount', 'Paid By', 'Status', 'Notes']);
  state.expenses.forEach(expense => rows.push([expense.name, expense.amount, getPersonName(expense.by), expense.done ? 'Done' : 'Pending', expense.notes]));

  rows.push([]);
  rows.push(['WITHDRAWALS']);
  rows.push(['Date', 'Amount', 'By']);
  state.withdrawals.forEach(withdrawal => rows.push([withdrawal.date, withdrawal.amount, getPersonName(withdrawal.by)]));

  const csv = rows.map(row => row.map(q).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'company_datasheet_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function resetAll() {
  if (!confirm('Reset all values to defaults? This clears saved browser edits.')) return;
  state = resetData();
  render();
}

window.exportCSV = exportCSV;
window.resetAll = resetAll;

render();
