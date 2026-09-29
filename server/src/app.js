import express from 'express';
import cors from 'cors';
import { customersRouter } from './routes/customers.js';
import { productsRouter, productAliasesRouter } from './routes/products.js';
import { ordersRouter } from './routes/orders.js';
import { mappingQueueRouter } from './routes/mappingQueue.js';
import { shipOrdersRouter } from './routes/shipOrders.js';
import { invoicesRouter } from './routes/invoices.js';
import { dashboardRouter } from './routes/dashboard.js';

export function createApp(db) {
  const app = express();
  app.use(cors());
  // 기본 100kb 제한으로는 1,000행 규모의 주문 업로드 커밋 요청(R1-N-01)이 잘릴 수 있어 상향
  app.use(express.json({ limit: '20mb' }));

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
  app.use('/api/invoices', invoicesRouter(db));
  app.use('/api/dashboard', dashboardRouter(db));

  return app;
}
