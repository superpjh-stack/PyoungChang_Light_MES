import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb();
const app = createApp(db);
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`mes-server listening on http://localhost:${PORT}`);
});
