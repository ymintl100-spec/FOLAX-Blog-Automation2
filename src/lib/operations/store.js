"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const connections = new Map();
const now = () => new Date().toISOString(),
  id = () => crypto.randomUUID();
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
function open(root) {
  const file = path.resolve(root, "content-operations.sqlite");
  if (connections.has(file)) return connections.get(file);
  fs.mkdirSync(root, { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { timeout: 5000 });
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS ops_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ops_datasets(id TEXT PRIMARY KEY,account TEXT NOT NULL,kind TEXT NOT NULL,platform TEXT NOT NULL,digest TEXT NOT NULL,created_at TEXT NOT NULL,meta TEXT NOT NULL,UNIQUE(account,kind,platform,digest));
 CREATE TABLE IF NOT EXISTS ops_observations(id TEXT PRIMARY KEY,dataset TEXT NOT NULL REFERENCES ops_datasets(id),account TEXT NOT NULL,kind TEXT NOT NULL,platform TEXT NOT NULL,record_key TEXT NOT NULL,observed_at TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(dataset,record_key));
 CREATE INDEX IF NOT EXISTS ops_observation_scope ON ops_observations(account,kind,observed_at);
 CREATE TABLE IF NOT EXISTS ops_topics(id TEXT PRIMARY KEY,account TEXT NOT NULL,keyword TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ops_topic_scope ON ops_topics(account,status);
 CREATE TABLE IF NOT EXISTS ops_documents(id TEXT PRIMARY KEY,account TEXT NOT NULL,topic_id TEXT,platform TEXT NOT NULL,status TEXT NOT NULL,current_version INTEGER NOT NULL,approved_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ops_versions(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES ops_documents(id),version INTEGER NOT NULL,digest TEXT NOT NULL,title TEXT NOT NULL,article TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(document,version));
 CREATE TABLE IF NOT EXISTS ops_reviews(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES ops_documents(id),version INTEGER NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ops_events(id TEXT PRIMARY KEY,account TEXT NOT NULL,entity TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ops_event_scope ON ops_events(account,created_at);
 CREATE TABLE IF NOT EXISTS ops_publications(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES ops_documents(id),version INTEGER NOT NULL,platform TEXT NOT NULL,state TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
 INSERT OR IGNORE INTO ops_meta(key,value) VALUES ('schemaVersion','1');`);
    const version = JSON.parse(
      db.prepare("SELECT value FROM ops_meta WHERE key=?").get("schemaVersion")
        .value,
    );
    if (version !== 1) {
      throw Error("콘텐츠 DB 버전을 확인하세요. 기존 파일은 보존했습니다.");
    }
    connections.set(file, db);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {}
    throw error;
  }
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function meta(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM ops_meta WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO ops_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
function event(db, account, entity, type, data = {}) {
  db.prepare("INSERT INTO ops_events VALUES (?,?,?,?,?,?)").run(
    id(),
    account,
    entity,
    type,
    now(),
    JSON.stringify(data),
  );
}
function rows(db, account, kind, platform) {
  const result = db
    .prepare(
      `SELECT o.*,d.meta,d.created_at AS imported_at FROM ops_observations o JOIN ops_datasets d ON d.id=o.dataset WHERE o.account=? AND o.kind=? ${platform ? "AND o.platform=?" : ""} ORDER BY d.created_at DESC,d.rowid DESC,o.observed_at DESC`,
    )
    .all(...[account, kind, ...(platform ? [platform] : [])]);
  const seen = new Set();
  return result
    .filter((r) => {
      const k = r.platform + "|" + r.record_key;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      ...JSON.parse(r.data),
      _id: r.id,
      _dataset: r.dataset,
      _platform: r.platform,
      _observedAt: r.observed_at,
      _importedAt: r.imported_at,
      _source: JSON.parse(r.meta),
    }));
}
function close(root) {
  const file = path.resolve(root, "content-operations.sqlite");
  connections.get(file)?.close();
  connections.delete(file);
}
module.exports = {
  open,
  transaction,
  meta,
  setMeta,
  event,
  rows,
  now,
  id,
  hash,
  close,
};
