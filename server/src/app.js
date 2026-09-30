import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { customersRouter } from './routes/customers.js';
import { productsRouter, productAliasesRouter } from './routes/products.js';
import { ordersRouter } from './routes/orders.js';
import { mappingQueueRouter } from './routes/mappingQueue.js';
import { shipOrdersRouter } from './routes/shipOrders.js';
import { invoicesRouter } from './routes/invoices.js';
import { dashboardRouter } from './routes/dashboard.js';
import { usersRouter } from './routes/users.js';
import { auditLogRouter } from './routes/auditLog.js';
import { settingsRouter } from './routes/settings.js';
import { erpMasterSyncRouter } from './routes/erpMasterSync.js';
import { identifyUser } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 배포 시 client/dist를 이 서버가 그대로 서빙한다 (별도 nginx 없이 컨테이너 1개로 API+화면 제공)
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

export function createApp(db) {
  const app = express();
  app.use(cors());
  // 기본 100kb 제한으로는 1,000행 규모의 주문 업로드 커밋 요청(R1-N-01)이 잘릴 수 있어 상향
  app.use(express.json({ limit: '20mb' }));
  app.use(identifyUser(db)); // R1-N-06: X-User-Id 헤더로 req.user 식별 (없어도 통과, requireRole에서만 차단)

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
  app.use('/api/users', usersRouter(db));
  app.use('/api/audit-log', auditLogRouter(db));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/erp-sync', erpMasterSyncRouter(db));

  // client/dist가 빌드돼 있으면(프로덕션 배포) 정적 파일과 SPA 라우팅 폴백을 제공한다.
  // 개발 중(vite dev server가 화면을 서빙)에는 dist가 없어 이 블록이 조용히 건너뛰어진다.
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  return app;
}
