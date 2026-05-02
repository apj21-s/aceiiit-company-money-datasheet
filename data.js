/**
 * Shared/local data layer.
 * Root shape:
 * {
 *   currentYear: "2026",
 *   years: {
 *     "2026": <sheet data>,
 *     "2027": <sheet data>
 *   }
 * }
 */

const DEFAULT_SHEET = {
  meta: {
    lastUpdatedBy: '',
    lastUpdatedEmail: '',
    lastUpdatedSection: '',
    lastUpdatedField: '',
    lastUpdatedAt: '',
    editHistory: [],
  },
  people: [
    { id: 'p1', name: 'Priyanshu' },
    { id: 'p2', name: 'Uman' },
    { id: 'p3', name: 'Arco' },
  ],
  streams: [
    { id: 's1', name: 'Class + Notes', price: 1499, qty: 16, shares: { p1: 50, p2: 35, p3: 15 } },
    { id: 's2', name: 'Only Notes', price: 499, qty: 3, shares: { p1: 50, p2: 35, p3: 15 } },
    { id: 's3', name: 'Mock Test', price: 599, qty: 18, shares: { p1: 20, p2: 20, p3: 60 } },
  ],
  discounts: [
    { id: 'd1', item: 'Class + Notes', list: 1499, discount: 142.18 },
    { id: 'd2', item: 'Mock Test', list: 599, discount: 56.82 },
  ],
  expenses: [
    { id: 'e1', name: 'Biryani party', amount: 673, by: 'p3', done: true, notes: 'Done' },
    { id: 'e2', name: 'Domain', amount: 116.82, by: 'p3', done: true, notes: 'Done' },
  ],
  withdrawals: [
    { id: 'w1', date: '2026-03-29', amount: 2000, by: 'p1' },
    { id: 'w2', date: '2026-04-30', amount: 4000, by: 'p1' },
  ],
};

const BLANK_SHEET = {
  meta: {
    lastUpdatedBy: '',
    lastUpdatedEmail: '',
    lastUpdatedSection: '',
    lastUpdatedField: '',
    lastUpdatedAt: '',
    editHistory: [],
  },
  people: [],
  streams: [],
  discounts: [],
  expenses: [],
  withdrawals: [],
};

const DEFAULT_YEAR = String(new Date().getFullYear());
const DEFAULT_DATA = {
  currentYear: DEFAULT_YEAR,
  years: {
    [DEFAULT_YEAR]: JSON.parse(JSON.stringify(DEFAULT_SHEET)),
  },
};

const STORAGE_KEY = 'company_datasheet_v3';
const DOCUMENT_ID = 'main';
const CONFIG = window.APP_CONFIG || {};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function normalizeSheet(data) {
  const base = deepClone(DEFAULT_SHEET);
  const raw = data && typeof data === 'object' ? data : {};

  if (raw.meta && typeof raw.meta === 'object') {
    base.meta = {
      lastUpdatedBy: raw.meta.lastUpdatedBy || '',
      lastUpdatedEmail: raw.meta.lastUpdatedEmail || '',
      lastUpdatedSection: raw.meta.lastUpdatedSection || '',
      lastUpdatedField: raw.meta.lastUpdatedField || '',
      lastUpdatedAt: raw.meta.lastUpdatedAt || '',
      editHistory: Array.isArray(raw.meta.editHistory) ? raw.meta.editHistory.slice(0, 100).map(entry => ({
        by: entry.by || '',
        email: entry.email || '',
        section: entry.section || '',
        field: entry.field || '',
        details: entry.details || '',
        at: entry.at || '',
        previousValue: entry.previousValue ?? '',
        newValue: entry.newValue ?? '',
        rowId: entry.rowId || '',
        personId: entry.personId || '',
        actionType: entry.actionType || '',
        weekKey: entry.weekKey || '',
        year: entry.year || '',
      })) : [],
    };
  }

  if (Array.isArray(raw.people) && raw.people.length) {
    base.people = raw.people.map((person, index) => ({
      id: person.id || uid('p' + index),
      name: person.name || 'Person ' + (index + 1),
    }));
  }

  const legacyNameToId = {};
  base.people.forEach(person => { legacyNameToId[person.name] = person.id; });

  if (Array.isArray(raw.streams)) {
    base.streams = raw.streams.map((stream, index) => {
      const shares = {};
      if (stream.shares && typeof stream.shares === 'object') {
        base.people.forEach(person => { shares[person.id] = Number(stream.shares[person.id]) || 0; });
      } else {
        const legacyMap = { ps: base.people[0] && base.people[0].id, us: base.people[1] && base.people[1].id, as: base.people[2] && base.people[2].id };
        Object.entries(legacyMap).forEach(([key, id]) => { if (id) shares[id] = Number(stream[key]) || 0; });
      }
      return {
        id: stream.id || uid('s' + index),
        name: stream.name || '',
        price: Number(stream.price) || 0,
        qty: Number(stream.qty) || 0,
        shares,
      };
    });
  }

  if (Array.isArray(raw.discounts)) {
    base.discounts = raw.discounts.map((discount, index) => ({
      id: discount.id || uid('d' + index),
      item: discount.item || '',
      list: Number(discount.list) || 0,
      discount: Number(discount.discount) || 0,
    }));
  }

  if (Array.isArray(raw.expenses)) {
    base.expenses = raw.expenses.map((expense, index) => ({
      id: expense.id || uid('e' + index),
      name: expense.name || '',
      amount: Number(expense.amount) || 0,
      by: legacyNameToId[expense.by] || expense.by || (base.people[0] && base.people[0].id) || '',
      done: Boolean(expense.done),
      notes: expense.notes || '',
    }));
  }

  if (Array.isArray(raw.withdrawals)) {
    base.withdrawals = raw.withdrawals.map((withdrawal, index) => ({
      id: withdrawal.id || uid('w' + index),
      date: withdrawal.date || '',
      amount: Number(withdrawal.amount) || 0,
      by: legacyNameToId[withdrawal.by] || withdrawal.by || (base.people[0] && base.people[0].id) || '',
    }));
  }

  return base;
}

function normalizeData(data) {
  const raw = data && typeof data === 'object' ? data : {};

  if (raw.years && typeof raw.years === 'object') {
    const years = {};
    Object.entries(raw.years).forEach(([year, sheet]) => {
      years[String(year)] = normalizeSheet(sheet);
    });
    const yearKeys = Object.keys(years);
    const fallbackYear = yearKeys[0] || DEFAULT_YEAR;
    if (!years[fallbackYear]) years[fallbackYear] = normalizeSheet(DEFAULT_SHEET);
    return {
      currentYear: String(raw.currentYear || fallbackYear),
      years,
    };
  }

  return {
    currentYear: DEFAULT_YEAR,
    years: {
      [DEFAULT_YEAR]: normalizeSheet(raw),
    },
  };
}

function createBlankYear() {
  return normalizeSheet(BLANK_SHEET);
}

function readLocalData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeData(JSON.parse(saved));
  } catch (error) {}
  return normalizeData(DEFAULT_DATA);
}

function saveLocalData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  } catch (error) {}
}

function hasRemoteConfig() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.authApi);
}

async function getRemoteHeaders(extra = {}) {
  const accessToken = await window.authApi.getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  return {
    apikey: CONFIG.supabaseAnonKey,
    Authorization: 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

function getRemoteBaseUrl() {
  return CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + (CONFIG.tableName || 'company_datasheet');
}

async function fetchRemoteRow() {
  const url = getRemoteBaseUrl() + '?id=eq.' + encodeURIComponent(CONFIG.documentId || DOCUMENT_ID) + '&select=*';
  const response = await fetch(url, { headers: await getRemoteHeaders() });
  if (!response.ok) throw new Error('Remote load failed: ' + response.status);
  const rows = await response.json();
  return rows[0] || null;
}

async function saveRemoteData(data) {
  const payload = {
    id: CONFIG.documentId || DOCUMENT_ID,
    payload: normalizeData(data),
    updated_at: new Date().toISOString(),
  };
  const url = getRemoteBaseUrl() + '?id=eq.' + encodeURIComponent(payload.id);
  const response = await fetch(url, {
    method: 'POST',
    headers: await getRemoteHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Remote save failed: ' + response.status);
  const rows = await response.json();
  return rows[0] || payload;
}

async function loadData() {
  if (!hasRemoteConfig()) return { data: readLocalData(), source: 'local', updatedAt: null };
  try {
    const row = await fetchRemoteRow();
    if (!row) {
      const created = await saveRemoteData(DEFAULT_DATA);
      return { data: normalizeData(created.payload), source: 'remote', updatedAt: created.updated_at || null };
    }
    return { data: normalizeData(row.payload), source: 'remote', updatedAt: row.updated_at || null };
  } catch (error) {
    console.error(error);
    return { data: readLocalData(), source: 'local-fallback', updatedAt: null, error: error.message };
  }
}

async function saveData(data) {
  const normalized = normalizeData(data);
  if (!hasRemoteConfig()) {
    saveLocalData(normalized);
    return { data: normalized, source: 'local', updatedAt: null };
  }
  try {
    const row = await saveRemoteData(normalized);
    return { data: normalizeData(row.payload), source: 'remote', updatedAt: row.updated_at || null };
  } catch (error) {
    console.error(error);
    saveLocalData(normalized);
    return { data: normalized, source: 'local-fallback', updatedAt: null, error: error.message };
  }
}

window.dataApi = {
  DEFAULT_DATA,
  DEFAULT_SHEET,
  DEFAULT_YEAR,
  normalizeData,
  normalizeSheet,
  createBlankYear,
  loadData,
  saveData,
  hasRemoteConfig,
};
