import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  let db;
  let app;

  beforeAll(() => {
    db = openDb(':memory:');
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
