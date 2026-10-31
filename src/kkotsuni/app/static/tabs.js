/* Progressive enhancement only: all workflow forms operate without JavaScript. */
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-print]')) window.print();
});

// Keep navigation preferences local to this browser; storage may be disabled.
const readPreference = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePreference = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* Navigation still works. */ }
};
const sidebarToggle = document.querySelector('[data-sidebar-toggle]');
if (sidebarToggle) {
  const setSidebarCollapsed = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.textContent = collapsed ? '메뉴 펼치기' : '메뉴 접기';
  };
  setSidebarCollapsed(readPreference('mes.sidebar.collapsed') === 'true');
  sidebarToggle.hidden = false;
  sidebarToggle.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(collapsed);
    writePreference('mes.sidebar.collapsed', String(collapsed));
  });
}
document.querySelectorAll('[data-nav-group]').forEach((group) => {
  const key = 'mes.nav.group.' + group.dataset.navGroup;
  const saved = readPreference(key);
  if (group.dataset.current === 'true') group.open = true;
  else if (saved !== null) group.open = saved === 'true';
  group.addEventListener('toggle', () => writePreference(key, String(group.open)));
});
