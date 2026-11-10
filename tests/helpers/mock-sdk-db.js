const store = new Map(); // tableName -> { rows: [], nextId: 1 }

export function resetMockDatabase() {
  store.clear();
}

function getTableBucket(tableDesc) {
  if (!store.has(tableDesc._tableName)) {
    store.set(tableDesc._tableName, { rows: [], nextId: 1 });
  }
  return store.get(tableDesc._tableName);
}

export function sql(strings, ...values) {
  return { _isSql: true, strings, values };
}

function makeColumn(sqlType, colName, opts = {}) {
  const col = {
    _isCol: true,
    sqlType,
    colName,
    jsKey: null,
    mode: opts.mode || null,
    isPrimary: false,
    autoIncrement: false,
    isUnique: false,
    notNullFlag: false,
    hasDefault: false,
    defaultVal: undefined,
    primaryKey(pkOpts = {}) {
      col.isPrimary = true;
      col.autoIncrement = Boolean(pkOpts.autoIncrement);
      return col;
    },
    notNull() {
      col.notNullFlag = true;
      return col;
    },
    unique() {
      col.isUnique = true;
      return col;
    },
    default(v) {
      col.hasDefault = true;
      col.defaultVal = v;
      return col;
    },
  };
  return col;
}

export const integer = (name, opts) => makeColumn('INTEGER', name, opts);
export const text = (name, opts) => makeColumn('TEXT', name, opts);
export const boolean = (name) => makeColumn('INTEGER', name, { mode: 'boolean' });
export const json = (name) => makeColumn('TEXT', name, { mode: 'json' });

export function index(name) {
  return {
    name,
    on: (...cols) => ({ type: 'index', name, cols }),
  };
}

export function uniqueIndex(name) {
  return {
    name,
    on: (...cols) => ({ type: 'uniqueIndex', name, cols }),
  };
}

export function table(tableName, columnsObj, constraintsCb) {
  const desc = { _tableName: tableName, _columns: {}, _constraints: {} };
  for (const [jsKey, col] of Object.entries(columnsObj)) {
    col.jsKey = jsKey;
    desc._columns[jsKey] = col;
    desc[jsKey] = col;
  }
  if (typeof constraintsCb === 'function') {
    desc._constraints = constraintsCb(desc) || {};
  }
  return desc;
}

export function eq(col, val) {
  return (row) => row[col.jsKey] === val;
}

export function and(...preds) {
  const active = preds.filter(Boolean);
  return (row) => active.every((fn) => fn(row));
}

export function asc(col) {
  return (a, b) => (a[col.jsKey] < b[col.jsKey] ? -1 : a[col.jsKey] > b[col.jsKey] ? 1 : 0);
}

export function desc(col) {
  return (a, b) => (a[col.jsKey] > b[col.jsKey] ? -1 : a[col.jsKey] < b[col.jsKey] ? 1 : 0);
}

function evalValue(val, currentRow) {
  if (val && typeof val === 'object' && val._isSql) {
    // Handle `sql`${col} + ${delta}`` and `sql`(unixepoch())``
    const rawJoined = val.strings.join('');
    if (rawJoined.includes('unixepoch')) {
      return Math.floor(Date.now() / 1000);
    }
    if (val.values.length >= 1 && val.values[0]?._isCol && currentRow) {
      const base = Number(currentRow[val.values[0].jsKey] || 0);
      const addend = val.values.length >= 2 ? Number(val.values[1]) : 1;
      return base + addend;
    }
    return 0;
  }
  return structuredClone(val);
}

const db = {
  select(projection = null) {
    let targetTable = null;
    let whereFn = null;
    let orderFn = null;

    const builder = {
      from(tbl) {
        targetTable = tbl;
        return builder;
      },
      where(pred) {
        whereFn = pred;
        return builder;
      },
      orderBy(ord) {
        orderFn = ord;
        return builder;
      },
      async all() {
        const bucket = getTableBucket(targetTable);
        let list = whereFn ? bucket.rows.filter(whereFn) : [...bucket.rows];
        if (orderFn) list.sort(orderFn);
        return list.map((r) => {
          if (!projection) return structuredClone(r);
          const projected = {};
          for (const [alias, col] of Object.entries(projection)) {
            projected[alias] = structuredClone(r[col.jsKey]);
          }
          return projected;
        });
      },
      async get() {
        const allRows = await builder.all();
        return allRows[0] ?? null;
      },
    };
    return builder;
  },

  insert(targetTable) {
    let payload = null;
    let conflictAction = null;

    const builder = {
      values(v) {
        payload = v;
        return builder;
      },
      onConflictDoNothing({ target }) {
        conflictAction = { mode: 'nothing', target };
        return builder;
      },
      onConflictDoUpdate({ target, set }) {
        conflictAction = { mode: 'update', target, set };
        return builder;
      },
      async run() {
        const bucket = getTableBucket(targetTable);
        const items = Array.isArray(payload) ? payload : [payload];

        for (const item of items) {
          if (conflictAction?.target) {
            const key = conflictAction.target.jsKey;
            const found = bucket.rows.find((r) => r[key] === item[key]);
            if (found) {
              if (conflictAction.mode === 'update') {
                for (const [k, v] of Object.entries(conflictAction.set)) {
                  found[k] = evalValue(v, found);
                }
              }
              continue;
            }
          }

          const newRow = {};
          for (const [jsKey, col] of Object.entries(targetTable._columns)) {
            if (item[jsKey] !== undefined) {
              newRow[jsKey] = structuredClone(item[jsKey]);
            } else if (col.autoIncrement) {
              newRow[jsKey] = bucket.nextId++;
            } else if (col.hasDefault) {
              newRow[jsKey] = evalValue(col.defaultVal, null);
            } else {
              newRow[jsKey] = null;
            }
          }
          bucket.rows.push(newRow);
        }

        return { rowsAffected: items.length, lastInsertRowid: bucket.nextId - 1, rows: [] };
      },
    };
    return builder;
  },

  update(targetTable) {
    let patchObj = {};
    let whereFn = null;
    const builder = {
      set(patch) {
        patchObj = patch;
        return builder;
      },
      where(pred) {
        whereFn = pred;
        return builder;
      },
      async run() {
        const bucket = getTableBucket(targetTable);
        let count = 0;
        for (const row of bucket.rows) {
          if (!whereFn || whereFn(row)) {
            for (const [k, v] of Object.entries(patchObj)) {
              row[k] = evalValue(v, row);
            }
            count += 1;
          }
        }
        return { rowsAffected: count, lastInsertRowid: 0, rows: [] };
      },
    };
    return builder;
  },

  delete(targetTable) {
    let whereFn = null;
    const builder = {
      where(pred) {
        whereFn = pred;
        return builder;
      },
      async run() {
        const bucket = getTableBucket(targetTable);
        const before = bucket.rows.length;
        bucket.rows = whereFn ? bucket.rows.filter((r) => !whereFn(r)) : [];
        return { rowsAffected: before - bucket.rows.length, lastInsertRowid: 0, rows: [] };
      },
    };
    return builder;
  },

  async $count(targetTable, whereFn = null) {
    const bucket = getTableBucket(targetTable);
    return whereFn ? bucket.rows.filter(whereFn).length : bucket.rows.length;
  },
};

export { db };
export default db;
