export function getSetting(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM system_setting WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO system_setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}
