import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import OrderListPage from './pages/orders/OrderListPage.jsx';
import OrderUploadPage from './pages/orders/OrderUploadPage.jsx';
import OrderDetailPage from './pages/orders/OrderDetailPage.jsx';
import MappingQueuePage from './pages/mapping/MappingQueuePage.jsx';
import ShipOrderListPage from './pages/shipOrders/ShipOrderListPage.jsx';
import ShipOrderDetailPage from './pages/shipOrders/ShipOrderDetailPage.jsx';
import ShipOrderPrintPage from './pages/shipOrders/ShipOrderPrintPage.jsx';
import InvoiceListPage from './pages/invoices/InvoiceListPage.jsx';
import InvoiceDetailPage from './pages/invoices/InvoiceDetailPage.jsx';
import CustomerListPage from './pages/customers/CustomerListPage.jsx';
import CustomerDetailPage from './pages/customers/CustomerDetailPage.jsx';
import ProductListPage from './pages/products/ProductListPage.jsx';
import ProductDetailPage from './pages/products/ProductDetailPage.jsx';
import UserListPage from './pages/users/UserListPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AuditLogPage from './pages/auditLog/AuditLogPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="ship-orders/:shipOrderNo/print" element={<ShipOrderPrintPage />} />

      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />

        <Route path="orders" element={<OrderListPage />} />
        <Route path="orders/upload" element={<OrderUploadPage />} />
        <Route path="orders/:orderNo" element={<OrderDetailPage />} />

        <Route path="mapping-queue" element={<MappingQueuePage />} />

        <Route path="ship-orders" element={<ShipOrderListPage />} />
        <Route path="ship-orders/:shipOrderNo" element={<ShipOrderDetailPage />} />

        <Route path="invoices" element={<InvoiceListPage />} />
        <Route path="invoices/:invoiceNo" element={<InvoiceDetailPage />} />

        <Route path="customers" element={<CustomerListPage />} />
        <Route path="customers/:customerCode" element={<CustomerDetailPage />} />

        <Route path="products" element={<ProductListPage />} />
        <Route path="products/:productCode" element={<ProductDetailPage />} />

        <Route path="users" element={<UserListPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit-log" element={<AuditLogPage />} />
      </Route>
    </Routes>
  );
}

export default App;
