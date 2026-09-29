// R1-N-07: 주요 변경 행위에 사용자·일시를 기록한다. user_id가 없으면(헤더 미제공) NULL로 남긴다.
export function recordAuditLog(db, { entity_type, entity_id, action, user_id, detail }) {
  db.prepare(
    `INSERT INTO audit_log (entity_type, entity_id, action, user_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(entity_type, entity_id, action, user_id ?? null, detail ?? null);
}

export function listAuditLog(db, { entity_type, entity_id, limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  if (entity_type) {
    conditions.push('entity_type = ?');
    params.push(entity_type);
  }
  if (entity_id) {
    conditions.push('entity_id = ?');
    params.push(entity_id);
  }
  let sql = 'SELECT * FROM audit_log';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}
