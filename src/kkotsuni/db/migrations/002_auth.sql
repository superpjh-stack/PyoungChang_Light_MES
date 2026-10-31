CREATE TABLE IF NOT EXISTS auth_credential (
 user_id TEXT PRIMARY KEY REFERENCES app_user(user_id),
 password_hash TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS auth_session (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES auth_credential(user_id),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_session(expires_at);
CREATE TABLE IF NOT EXISTS auth_login_limit (
 key TEXT PRIMARY KEY,
 failures INTEGER NOT NULL DEFAULT 0,
 window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_until TIMESTAMPTZ
);
