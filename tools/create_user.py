"""Create a login account interactively without passwords in arguments or logs."""
import argparse
import getpass

from kkotsuni.app.auth import hash_password
from kkotsuni.app.settings import Settings
from kkotsuni.db.connection import connect


def provision(db, username, name, role, password):
    if not 8 <= len(password) <= 256:
        raise ValueError('Password must contain 8 to 256 characters.')
    encoded = hash_password(password)
    with db.tx():
        db.lock('provision:' + username)
        if db.one('SELECT 1 FROM app_user WHERE user_id=%s', (username,)):
            raise ValueError('Account already exists; no changes made.')
        db.x('INSERT INTO app_user(user_id,name,role) VALUES (%s,%s,%s)', (username, name, role))
        db.x('INSERT INTO auth_credential(user_id,password_hash) VALUES (%s,%s)', (username, encoded))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--role', choices=['ADMIN', 'OPERATOR', 'VIEWER'], default='VIEWER')
    args = parser.parse_args()
    password = getpass.getpass('Password: ')
    if password != getpass.getpass('Confirm password: '):
        parser.exit(1, 'Passwords do not match; no changes made.\n')
    settings = Settings()
    try:
        with connect(settings.database_url, settings.db_schema) as db:
            provision(db, args.username, args.name, args.role, password)
    except ValueError as error:
        parser.exit(1, str(error)+'\n')
    print('Login account created.')
