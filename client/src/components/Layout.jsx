import { NavLink, Outlet } from 'react-router-dom';
import { useUser } from '../context/UserContext.jsx';

const NAV_GROUPS = [
  {
    label: '현황',
    items: [{ to: '/', label: '대시보드', end: true }],
  },
  {
    label: '주문',
    items: [
      { to: '/orders', label: '주문 목록' },
      { to: '/orders/upload', label: '주문 업로드' },
      { to: '/mapping-queue', label: '매핑 대기함' },
    ],
  },
  {
    label: '출고',
    items: [{ to: '/ship-orders', label: '출고 지시서' }],
  },
  {
    label: '거래명세서',
    items: [{ to: '/invoices', label: '거래명세서' }],
  },
  {
    label: '마스터',
    items: [
      { to: '/customers', label: '거래처' },
      { to: '/products', label: '제품' },
    ],
  },
  {
    label: '관리',
    items: [
      { to: '/users', label: '사용자' },
      { to: '/settings', label: '설정' },
      { to: '/audit-log', label: '감사 로그' },
    ],
  },
];

export default function Layout() {
  const { users, currentUser, currentUserId, selectUser } = useUser();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">
          평창꽃순이 경량 MES
          <small>주문·출고·거래명세서 연동</small>
        </div>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="sidebar-group">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="muted" style={{ fontSize: 12 }}>
            접속 계정
          </span>
          <select value={currentUserId} onChange={(e) => selectUser(e.target.value)} style={{ width: 220 }}>
            <option value="">(미인증 — 조회만 가능)</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          {currentUser && <span className="badge badge-blue">{currentUser.role}</span>}
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
