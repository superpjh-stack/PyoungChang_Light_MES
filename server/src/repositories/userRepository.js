const VALID_ROLES = ['ADMIN', 'OPERATOR', 'VIEWER'];

export function createUser(db, { user_id, name, role }) {
  if (!user_id || !name || !role) {
    const err = new Error('user_id, name, role은 필수입니다');
    err.status = 400;
    throw err;
  }
  if (!VALID_ROLES.includes(role)) {
    const err = new Error(`role은 ${VALID_ROLES.join('/')} 중 하나여야 합니다`);
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT 1 FROM app_user WHERE user_id = ?').get(user_id);
  if (existing) {
    const err = new Error(`이미 존재하는 사용자입니다: ${user_id}`);
    err.status = 409;
    throw err;
  }
  db.prepare('INSERT INTO app_user (user_id, name, role) VALUES (?, ?, ?)').run(user_id, name, role);
  return getUser(db, user_id);
}

export function getUser(db, userId) {
  return db.prepare('SELECT * FROM app_user WHERE user_id = ?').get(userId) ?? null;
}

export function listUsers(db) {
  return db.prepare('SELECT * FROM app_user ORDER BY user_id').all();
}
