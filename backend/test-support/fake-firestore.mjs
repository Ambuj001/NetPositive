// In-memory stand-in for `firebase-admin/firestore`, for TESTS ONLY.
//
// Faithful where the backend relies on Firestore semantics:
//  - transactions: serialized; every read must precede every write; create() fails if the doc exists; update() fails if it doesn't
//  - batches are atomic; create() fails if the doc exists
//  - FieldValue.serverTimestamp() / increment(); set({merge:true}) deep-merges maps; update() supports dotted paths
//  - queries: == and < filters, orderBy (docs missing the field are excluded), limit
// NOT modelled: composite-index requirements, security rules, network/latency, quota. Use the real emulator for those.

export class Timestamp {
  constructor(ms) { this._ms = ms; }
  static now() { return new Timestamp(Date.now()); }
  static fromMillis(ms) { return new Timestamp(ms); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  valueOf() { return this._ms; }
}

class Sentinel { constructor(kind, n) { this.kind = kind; this.n = n; } }
export const FieldValue = {
  serverTimestamp: () => new Sentinel('ts'),
  increment: (n) => new Sentinel('inc', n),
};

const err = (code, message) => Object.assign(new Error(message), { code });
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Sentinel);

function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v._ms);
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

/** Resolve sentinels against the existing value and drop undefined (ignoreUndefinedProperties). */
function resolve(value, existing) {
  if (value instanceof Sentinel) {
    if (value.kind === 'ts') return Timestamp.now();
    return (typeof existing === 'number' ? existing : 0) + value.n;
  }
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = resolve(v, isPlain(existing) ? existing[k] : undefined);
    }
    return out;
  }
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map((v) => resolve(v, undefined));
  return value;
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlain(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const getPath = (obj, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const store = new Map(); // path -> data
let chain = Promise.resolve(); // global transaction/commit mutex
const autoId = () => Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');

class DocSnap {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; this.exists = data !== undefined; }
  data() { return this._d === undefined ? undefined : clone(this._d); }
}

class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new CollRef(`${this.path}/${name}`); }
  async get() { return new DocSnap(this, store.get(this.path)); }
  set(data, opts) { return commit([{ op: 'set', ref: this, data, merge: !!opts?.merge }]); }
  update(data) { return commit([{ op: 'update', ref: this, data }]); }
  create(data) { return commit([{ op: 'create', ref: this, data }]); }
  delete() { return commit([{ op: 'delete', ref: this }]); }
}

class Query {
  constructor(path, filters = [], order = null, lim = null) { this.path = path; this.filters = filters; this.order = order; this.lim = lim; }
  where(field, op, value) {
    if (!['==', '<'].includes(op)) throw err(3, `fake-firestore: operator ${op} not implemented`);
    return new Query(this.path, [...this.filters, { field, op, value }], this.order, this.lim);
  }
  orderBy(field, dir = 'asc') { return new Query(this.path, this.filters, { field, dir }, this.lim); }
  limit(n) { return new Query(this.path, this.filters, this.order, n); }
  async get() { return runQuery(this); }
}

class CollRef extends Query {
  constructor(path) { super(path); }
  doc(id) { return new DocRef(`${this.path}/${id ?? autoId()}`); }
}

const cmp = (a, b) => (a instanceof Timestamp ? a._ms : a) - (b instanceof Timestamp ? b._ms : b) || (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

function matches(data, { field, op, value }) {
  const v = getPath(data, field);
  if (op === '==') return v instanceof Timestamp && value instanceof Timestamp ? v._ms === value._ms : v === value;
  // '<' only matches values of the same type (null / missing never match), like Firestore
  if (value instanceof Timestamp) return v instanceof Timestamp && v._ms < value._ms;
  return typeof v === typeof value && v < value;
}

function runQuery(q) {
  const prefix = `${q.path}/`;
  let rows = [...store.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
  rows = rows.filter(([, d]) => q.filters.every((f) => matches(d, f)));
  if (q.order) {
    rows = rows.filter(([, d]) => getPath(d, q.order.field) !== undefined && getPath(d, q.order.field) !== null);
    rows.sort(([, a], [, b]) => (q.order.dir === 'desc' ? -1 : 1) * cmp(getPath(a, q.order.field), getPath(b, q.order.field)));
  }
  if (q.lim != null) rows = rows.slice(0, q.lim);
  const docs = rows.map(([p, d]) => new DocSnap(new DocRef(p), d));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (f) => docs.forEach(f) };
}

/** Apply writes atomically (all-or-nothing) inside the mutex. */
function applyWrites(writes) {
  const staged = new Map();
  const read = (p) => (staged.has(p) ? staged.get(p) : store.get(p));
  for (const w of writes) {
    const p = w.ref.path;
    const cur = read(p);
    if (w.op === 'create') {
      if (cur !== undefined) throw err(6, `ALREADY_EXISTS: ${p}`);
      staged.set(p, resolve(w.data, undefined));
    } else if (w.op === 'update') {
      if (cur === undefined) throw err(5, `NOT_FOUND: ${p}`);
      const next = clone(cur);
      for (const [k, v] of Object.entries(w.data)) {
        if (v === undefined) continue;
        setPath(next, k, resolve(v, getPath(cur, k)));
      }
      staged.set(p, next);
    } else if (w.op === 'set') {
      staged.set(p, w.merge && cur !== undefined ? deepMerge(cur, resolve(w.data, cur)) : resolve(w.data, w.merge ? cur : undefined));
    } else if (w.op === 'delete') {
      staged.set(p, undefined);
    }
  }
  for (const [p, d] of staged) (d === undefined ? store.delete(p) : store.set(p, d));
}

function commit(writes) {
  const run = chain.then(() => applyWrites(writes));
  chain = run.catch(() => {});
  return run;
}

class Transaction {
  constructor() { this.writes = []; }
  async get(refOrQuery) {
    if (this.writes.length) throw err(3, 'Firestore transactions require all reads to be executed before all writes.');
    return refOrQuery instanceof DocRef ? refOrQuery.get() : refOrQuery.get();
  }
  set(ref, data, opts) { this.writes.push({ op: 'set', ref, data, merge: !!opts?.merge }); return this; }
  update(ref, data) { this.writes.push({ op: 'update', ref, data }); return this; }
  create(ref, data) { this.writes.push({ op: 'create', ref, data }); return this; }
  delete(ref) { this.writes.push({ op: 'delete', ref }); return this; }
}

class Batch {
  constructor() { this.writes = []; }
  create(ref, data) { this.writes.push({ op: 'create', ref, data }); return this; }
  set(ref, data, opts) { this.writes.push({ op: 'set', ref, data, merge: !!opts?.merge }); return this; }
  update(ref, data) { this.writes.push({ op: 'update', ref, data }); return this; }
  delete(ref) { this.writes.push({ op: 'delete', ref }); return this; }
  commit() { return commit(this.writes); }
}

const db = {
  settings() {},
  collection: (name) => new CollRef(name),
  batch: () => new Batch(),
  // Serialized: the whole read-validate-write runs while holding the mutex, so concurrent callers see each other's commits.
  runTransaction(fn) {
    const run = chain.then(async () => {
      const tx = new Transaction();
      const result = await fn(tx);
      applyWrites(tx.writes);
      return result;
    });
    chain = run.catch(() => {});
    return run;
  },
};

export const getFirestore = () => db;

/** Test helper: wipe everything between runs. */
export const __reset = () => store.clear();
export const __dump = () => Object.fromEntries([...store.entries()].map(([k, v]) => [k, clone(v)]));
