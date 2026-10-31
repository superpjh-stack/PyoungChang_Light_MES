/* Progressive enhancement only: all workflow forms operate without JavaScript. */
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-print]')) window.print();
});
