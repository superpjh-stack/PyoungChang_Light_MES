import express from 'express';
import cors from 'cors';
import { customersRouter } from './routes/customers.js';
import { productsRouter, productAliasesRouter } from './routes/products.js';

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  app.use('/api/customers', customersRouter(db));
  app.use('/api/products', productsRouter(db));
  app.use('/api/product-aliases', productAliasesRouter(db));

  return app;
}
