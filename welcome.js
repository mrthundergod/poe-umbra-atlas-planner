// "How to use" popup: shown when the page opens (unless turned off, or a tree link was opened),
// then lets the user start from scratch or jump into the planner. Help button reopens it.
(() => {
  const box = document.getElementById('welcome');
  const hideBox = document.getElementById('wHide');
  let off = false;
  try { off = localStorage.getItem('atlas-welcome') === 'off'; } catch (e) {}
  hideBox.checked = off;
  hideBox.onchange = () => { try { localStorage.setItem('atlas-welcome', hideBox.checked ? 'off' : 'on'); } catch (e) {} };

  const open = () => { box.hidden = false; document.getElementById('wPlan').focus(); };
  const close = () => { box.hidden = true; };
  document.getElementById('helpBtn').onclick = open;
  document.getElementById('wClose').onclick = close;
  document.getElementById('wScratch').onclick = close;
  document.getElementById('wPlan').onclick = () => { close(); window.openPlanner(); };
  box.addEventListener('pointerdown', e => { if (e.target === box) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });

  // a shared tree link (#t=… / #s=…) opens straight to that tree
  const sharedTree = /#[ts]=/.test(location.hash);
  if (!off && !sharedTree) open();
})();
