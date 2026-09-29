import express from 'express';
import cors from 'cors';
import { customersRouter } from './routes/customers.js';
import { productsRouter, productAliasesRouter } from './routes/products.js';
import { ordersRouter } from './routes/orders.js';
import { mappingQueueRouter } from './routes/mappingQueue.js';
import { shipOrdersRouter } from './routes/shipOrders.js';

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
  app.use('/api/orders', ordersRouter(db));
  app.use('/api/mapping-queue', mappingQueueRouter(db));
  app.use('/api/ship-orders', shipOrdersRouter(db));

  return app;
}
