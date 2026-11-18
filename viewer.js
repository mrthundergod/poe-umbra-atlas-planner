const canvas = document.getElementById('c');
let ctx = canvas.getContext('2d'); // swapped for an offscreen canvas while exporting a PNG
let exporting = false;
const tip = document.getElementById('tip');
const header = document.querySelector('header');
const panel = document.getElementById('panel');
const MIN_ZOOM = 0.02, MAX_ZOOM = 1.5;
const MAX_PICK = 150; // the export still says 138; 150 is this season's limit
let TOP = 36;

const sheets = T.sheets.map(src => { const im = new Image(); im.onload = draw; im.src = (window.SPRITES && window.SPRITES[src]) || src; return im; });
const byId = new Map(T.nodes.map(n => [n.id, n]));
const START = T.start[3];
// edges between two Gateway (wormhole) nodes: a jump across the tree, not a drawn path
const GATEWAY_LINKS = T.edges.filter(([a, b]) => byId.get(a)?.k === 'wormhole' && byId.get(b)?.k === 'wormhole');
const adj = new Map();
for (const [a, b] of T.edges) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push(b);
  adj.get(b).push(a);
}
for (const n of T.nodes)
  n.text = [n.n, ...n.s, ...n.r, ...(n.v || []).map(v => v[0])].join(' ').replace(/\s+/g, ' ').toLowerCase();

let zoom = 0.1, camX = 0, camY = 0, dpr = 1;
const overlays = []; // extra drawing hooks (planner.js)

// background on/off, remembered in this browser
let showBg = true;
try { showBg = localStorage.getItem('atlas-bg') !== 'off'; } catch (e) {}
const bgButton = document.getElementById('bg');
function setBg(on) {
  showBg = on;
  bgButton.classList.toggle('on', on);
  try { localStorage.setItem('atlas-bg', on ? 'on' : 'off'); } catch (e) {}
  draw();
}
bgButton.onclick = () => setBg(!showBg);
bgButton.classList.toggle('on', showBg);
if (!T.bg) bgButton.style.display = 'none';

function resize() {
  TOP = header.offsetHeight;
  canvas.style.top = panel.style.top = TOP + 'px';
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = (innerHeight - TOP) + 'px';
  canvas.width = innerWidth * dpr;
  canvas.height = (innerHeight - TOP) * dpr;
  draw();
}

function panelW() {
  const w = panel.classList.contains('hidden') ? 0 : panel.offsetWidth;
  return w < innerWidth ? w : 0;
}

function lookAt(x, y) {
  camX = x + panelW() / 2 / zoom;
  camY = y;
  draw();
}

function fit() {
  const [x0, y0, x1, y1] = T.bounds;
  const w = innerWidth - panelW(), h = innerHeight - TOP;
  zoom = Math.min(w / (x1 - x0 + 800), h / (y1 - y0 + 1600));
  lookAt((x0 + x1) / 2, (y0 + y1) / 2);
}

function sprite(r, x, y, scale = 1) {
  if (!r) return;
  const im = sheets[r[0]];
  if (!im.complete || !im.naturalWidth) return;
  const w = r[5] * scale, h = r[6] * scale;
  ctx.drawImage(im, r[1], r[2], r[3], r[4], x - w / 2, y - h / 2, w, h);
}

let pending = false;
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(render);
}

function ring(n, color, width, gap) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width / zoom;
  ctx.beginPath();
  ctx.arc(n.x, n.y, Math.max(radius(n) + gap / zoom, 7 / zoom), 0, Math.PI * 2);
  ctx.stroke();
}

function render() {
  pending = false;
  const w = ctx.canvas.width / dpr, h = ctx.canvas.height / dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.bg && showBg ? '#0a0c14' : '#08090c'; // background image's edge color, so it blends in
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 - camX * zoom), dpr * (h / 2 - camY * zoom));
  ctx.imageSmoothingQuality = 'high';

  // round background, centered on the start node and framing the whole tree
  if (T.bg && showBg) {
    const [x0, y0, x1, y1] = T.bounds, [sx, sy] = T.start;
    const size = 2.3 * Math.max(sx - x0, x1 - sx, sy - y0, y1 - sy);
    const im = sheets[T.bg[0]];
    if (im.complete && im.naturalWidth)
      ctx.drawImage(im, T.bg[1], T.bg[2], T.bg[3], T.bg[4], sx - size / 2, sy - size / 2, size, size);
  }

  for (const [x, y, r] of T.groups) sprite(r, x, y);

  // links between the nodes
  ctx.strokeStyle = '#6b5a3c';
  ctx.lineWidth = Math.max(8, 1.5 / zoom);
  ctx.beginPath();
  for (const [ax, ay, bx, by] of T.lines) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
  for (const [cx, cy, r, a, d] of T.arcs) {
    ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.arc(cx, cy, r, a, a + d, d < 0);
  }
  ctx.stroke();

  const on = id => id === START || picked.has(id);
  const soon = id => on(id) || (preview && preview.add && preview.add.has(id));
  linkPass((a, b) => on(a) && on(b), '#e8c060');
  if (preview && preview.add) linkPass((a, b) => soon(a) && soon(b) && !(on(a) && on(b)), '#8fd080');

  // Gateway pairs are linked without a line in the tree art: draw the jump as a dashed line
  for (const [a, b] of GATEWAY_LINKS) {
    const A = byId.get(a), B = byId.get(b), both = on(a) && on(b);
    ctx.save();
    ctx.setLineDash(both ? [40, 30] : [25, 35]);
    ctx.strokeStyle = both ? '#e8c060' : 'rgba(107, 90, 60, 0.6)';
    ctx.lineWidth = both ? Math.max(10, 2.5 / zoom) : Math.max(6, 1.2 / zoom);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.restore();
  }

  sprite(T.start[2], T.start[0], T.start[1]);

  for (const n of T.nodes) {
    sprite(n.i, n.x, n.y);
    sprite(picked.has(n.id) && n.fa ? n.fa : n.fr, n.x, n.y);
  }

  // gold when allocated; orange for a multiple-choice node that still needs its choice
  for (const n of picked.values()) ring(n, n.v && !choice.has(n.id) ? '#e07a30' : '#e8c060', 2.5, 2);
  if (preview) for (const id of preview.add || preview.remove)
    ring(byId.get(id), preview.add ? '#8fd080' : '#e07050', 2.5, 2);
  if (exporting) return;
  for (const n of matches) ring(n, n === matches[cursor] ? '#ffffff' : '#4fc3ff', 2.5, 6);
  if (hover) ring(hover, '#e8d8a8', 2, 4);
  for (const f of overlays) f();

  document.getElementById('pct').textContent = Math.round(zoom * 1000) / 10 + '%';
}

function linkPass(test, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(10, 2.5 / zoom);
  ctx.beginPath();
  for (const [ax, ay, bx, by, a, b] of T.lines)
    if (test(a, b)) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
  for (const [cx, cy, r, s, d, a, b] of T.arcs)
    if (test(a, b)) { ctx.moveTo(cx + r * Math.cos(s), cy + r * Math.sin(s)); ctx.arc(cx, cy, r, s, s + d, d < 0); }
  ctx.stroke();
}

function radius(n) { return (n.fr ? n.fr[5] : n.i ? n.i[5] : 60) * 0.45; }

function toWorld(sx, sy) {
  const w = canvas.width / dpr, h = canvas.height / dpr;
  return [(sx - w / 2) / zoom + camX, (sy - TOP - h / 2) / zoom + camY];
}

function zoomAt(factor, sx, sy) {
  const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  const [wx, wy] = toWorld(sx, sy);
  camX = wx - (wx - camX) * zoom / nz;
  camY = wy - (wy - camY) * zoom / nz;
  zoom = nz;
  draw();
}

function centerOn(n) {
  zoom = Math.max(zoom, 0.3);
  lookAt(n.x, n.y);
}

// node selection logic
const picked = new Map();
const choice = new Map(); // multiple-choice node id -> index into its n.v
const selectable = n => n.k !== 'mastery';
const effects = n => n.v ? (choice.has(n.id) ? n.v[choice.get(n.id)][1] : []) : n.s;

function pathTo(n) {
  const prev = new Map();
  const queue = [START, ...picked.keys()];
  for (const id of queue) prev.set(id, null);
  for (let i = 0; i < queue.length && !prev.has(n.id); i++)
    for (const next of adj.get(queue[i]) || [])
      if (!prev.has(next)) { prev.set(next, queue[i]); queue.push(next); }
  if (!prev.has(n.id)) return null;
  const path = [];
  for (let id = n.id; id !== START && !picked.has(id); id = prev.get(id)) path.push(id);
  return path.reverse();
}

function linked(without) {
  const reach = new Set([START]), stack = [START];
  while (stack.length)
    for (const next of adj.get(stack.pop()) || [])
      if (next !== without && picked.has(next) && !reach.has(next)) { reach.add(next); stack.push(next); }
  return reach;
}

function cut(n) {
  const reach = linked(n.id);
  return [...picked.keys()].filter(id => !reach.has(id));
}

let preview = null;
function makePreview(n) {
  if (!n || !selectable(n)) return null;
  if (picked.has(n.id)) return n.v ? null : { remove: new Set(cut(n)) }; // multiple-choice: the menu decides
  const path = pathTo(n);
  return path && { add: new Set(path) };
}

function unpick(n) {
  for (const id of cut(n)) { picked.delete(id); choice.delete(id); }
}

// Allocates the path to n; false if it doesn't fit in the points left.
function allocate(n) {
  const path = pathTo(n);
  if (!path) return false;
  if (picked.size + path.length > MAX_PICK) { flashFull(path.length); return false; }
  for (const id of path) picked.set(id, byId.get(id));
  return true;
}

function toggle(n) {
  if (!selectable(n)) return;
  if (picked.has(n.id)) unpick(n);
  else if (!allocate(n)) return;
  changed();
}

function choose(n, i) {
  if (!picked.has(n.id) && !allocate(n)) return;
  choice.set(n.id, i);
  changed();
}

function changed() {
  preview = makePreview(hover);
  selectionChanged();
}

// Menu for multiple-choice nodes: pick (or change) the choice, or remove the node.
const menu = document.getElementById('menu');
function openMenu(n, sx, sy) {
  if (!selectable(n) || (!picked.has(n.id) && !pathTo(n))) return;
  tip.style.display = 'none';
  menu.innerHTML = '';
  const title = document.createElement('b');
  title.textContent = n.n;
  menu.append(title);
  for (const s of n.s) {
    const d = document.createElement('div');
    d.className = 'stat';
    d.textContent = s;
    menu.append(d);
  }
  const cur = choice.get(n.id);
  n.v.forEach(([label], i) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (i === cur) b.className = 'on';
    b.onclick = () => { closeMenu(); choose(n, i); };
    menu.append(b);
  });
  if (picked.has(n.id)) {
    const k = cut(n).length;
    const b = document.createElement('button');
    b.className = 'rm';
    b.textContent = k === 1 ? 'Remove' : `Remove (${k} nodes: this one and those linked through it)`;
    b.onclick = () => { closeMenu(); toggle(n); };
    menu.append(b);
  } else {
    const k = pathTo(n).length;
    const d = document.createElement('div');
    d.className = 'hint';
    d.textContent = `Choose one to allocate (${k} ${k === 1 ? 'point' : 'points'})`;
    menu.append(d);
  }
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(sx + 12, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(TOP + 4, Math.min(sy + 12, innerHeight - r.height - 8)) + 'px';
}
const menuOpen = () => menu.style.display === 'block';
function closeMenu() { menu.style.display = 'none'; }
addEventListener('pointerdown', e => { if (menuOpen() && !menu.contains(e.target) && e.target !== canvas) closeMenu(); });

let fullTimer = 0;
function flashFull(need) {
  const c = document.getElementById('count');
  c.textContent = `Path needs ${need} points, ${MAX_PICK - picked.size} left`;
  c.classList.add('full');
  clearTimeout(fullTimer);
  fullTimer = setTimeout(updatePanel, 1500);
}

// the tree's links, as share.js reads them
const GRAPH = {
  start: START,
  edges: T.edges,
  v: Object.fromEntries(T.nodes.filter(n => n.v).map(n => [n.id, n.v.length])),
};

function writeHash() {
  const code = Share.encode(GRAPH, new Map([...picked.keys()].map(id => [id, choice.get(id)])));
  history.replaceState(null, '', code ? '#t=' + code : location.pathname + location.search);
}

const selectionHooks = []; // called after every change to the selection (planner.js)
function selectionChanged() {
  for (const f of selectionHooks) f();
  document.getElementById('notice').hidden = true; // a new tree replaces the link that failed
  writeHash();
  updatePanel();
  draw();
}

// logic for stacking node effects that can be stacked
// e.g. nodes 43934 (Betrayal Chance) and 34644 (Obsessed with Vengeance)
// both have "your maps have % chance to contain jun", or the percentage for betrayal scarab drop
// numerical values for both affixes add up, so 10+20 = 30% to contain jun, and same for scarabs (10+20)
const NUM = /\d+(?:\.\d+)?/g;
function summableIndexes(s) {
  const pct = [];
  let count = 0;
  s.replace(NUM, (m, off) => { if (s[off + m.length] === '%') pct.push(count); count++; return m; });
  return pct.length ? pct : count === 1 ? [0] : [];
}
function summarize(nodes) {
  const groups = new Map();
  for (const n of nodes) for (const s of effects(n)) {
    const key = s.replace(NUM, '#');
    const nums = (s.match(NUM) || []).map(Number);
    const g = groups.get(key);
    if (!g) groups.set(key, { text: s, nums, count: 1, sum: summableIndexes(s) });
    else { g.count++; for (const i of g.sum) g.nums[i] += nums[i]; }
  }
  return [...groups.values()].map(g => {
    let i = 0;
    const text = g.count > 1 && g.sum.length
      ? g.text.replace(NUM, m => g.sum.includes(i) ? String(Math.round(g.nums[i++] * 100) / 100) : (i++, m))
      : g.text;
    return { text, count: g.count };
  }).sort((a, b) => a.text.localeCompare(b.text));
}

function updatePanel() {
  const n = picked.size;
  const c = document.getElementById('count');
  c.textContent = `${n} / ${MAX_PICK} selected`;
  c.classList.toggle('full', n >= MAX_PICK);
  document.getElementById('badge').textContent = n;
  document.getElementById('empty').style.display = n ? 'none' : '';

  const eff = document.getElementById('effects');
  eff.innerHTML = '';
  for (const e of summarize(picked.values())) {
    const li = document.createElement('li');
    li.textContent = e.text;
    if (e.count > 1) {
      const k = document.createElement('span');
      k.className = 'n';
      k.textContent = '×' + e.count;
      li.append(k);
    }
    eff.append(li);
  }

  const list = document.getElementById('picked');
  list.innerHTML = '';
  for (const node of picked.values()) {
    const li = document.createElement('li');
    li.className = node.k;
    const name = document.createElement('span');
    name.textContent = node.n;
    name.title = 'Show on the tree';
    name.onclick = () => centerOn(node);
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Remove';
    x.onclick = () => toggle(node);
    li.append(name, x);
    if (node.v) {
      const sel = document.createElement('select');
      sel.title = 'Choice for this node';
      if (!choice.has(node.id)) sel.append(new Option('Choose one…', '', true, true));
      node.v.forEach(([label], i) => sel.append(new Option(label, i, false, choice.get(node.id) === i)));
      sel.onchange = () => choose(node, +sel.value);
      li.append(sel);
    }
    list.append(li);
  }
}

document.getElementById('max').textContent = MAX_PICK;
document.getElementById('clear').onclick = () => { picked.clear(); choice.clear(); selectionChanged(); };
// Save / load the selection as a JSON file
document.getElementById('save').onclick = () => {
  if (!picked.size) { alert('Select some nodes first.'); return; }
  const name = prompt('Name for this tree:', 'My atlas tree');
  if (name === null) return;
  const code = Share.encode(GRAPH, new Map([...picked.keys()].map(id => [id, choice.get(id)])));
  const data = {
    name,
    saved: new Date().toISOString(),
    points: picked.size,
    code,
    nodes: [...picked.values()].map(n => {
      const o = { id: n.id, name: n.n };
      if (n.v && choice.has(n.id)) { o.choice = choice.get(n.id); o.choiceLabel = n.v[choice.get(n.id)][0]; }
      return o;
    }),
    effects: summarize(picked.values()).map(e => e.count > 1 ? `${e.text} (x${e.count})` : e.text),
  };
  const goal = window.atlasGoal && window.atlasGoal.get();
  if (goal) data.goal = { points: goal.points, code: Share.encode(GRAPH, new Map([...goal.ids].map(id => [id, choice.get(id)]))) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'atlas-tree') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const fileInput = document.getElementById('file');
document.getElementById('open').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    let items = data.code ? Share.decode(GRAPH, data.code) : null;
    if (!items && Array.isArray(data.nodes)) items = data.nodes.map(n => [n.id, n.choice]);
    if (!items) throw new Error('no nodes in file');
    picked.clear(); choice.clear();
    load(items);
    selectionChanged();
    if (window.atlasGoal) {
      const g = data.goal && data.goal.code ? Share.decode(GRAPH, data.goal.code) : null;
      window.atlasGoal.set(g ? g.map(([id]) => id) : null, data.goal ? data.goal.points : MAX_PICK);
    }
    panel.classList.remove('hidden');
    document.getElementById('toggle').classList.add('on');
  } catch (e) {
    alert("Couldn't load that file: " + e.message);
  }
};
document.getElementById('toggle').onclick = () => {
  panel.classList.toggle('hidden');
  document.getElementById('toggle').classList.toggle('on', !panel.classList.contains('hidden'));
};

// The taken path is saved in the url as a short code (share.js): "#t=<code>".
// Links in the original form still open: node IDs separated by commas, "id:choice"
// for multiple-choice nodes ("#s=64048,22125,12826:0,...").
function load(items) {
  for (const [id, c] of items) {
    const n = byId.get(id);
    if (!n || !selectable(n) || picked.size >= MAX_PICK) continue;
    picked.set(n.id, n);
    if (n.v && n.v[c]) choice.set(n.id, c);
  }
  const reach = linked(null);
  for (const id of [...picked.keys()]) if (!reach.has(id)) { picked.delete(id); choice.delete(id); }
  if (picked.size) writeHash(); // long links become short ones
}

function showPanel() {
  panel.classList.remove('hidden');
  document.getElementById('toggle').classList.add('on');
}

// A short code made before the tree last changed is read with the tree as it was
// then (build_atlas.py keeps those in T.old). Its checksum tells which one fits.
function loadOld(code) {
  const fail = () => {
    const p = document.getElementById('notice');
    p.textContent = "This tree link couldn't be opened: it's probably incomplete (make sure the whole link was copied).";
    p.hidden = false;
    showPanel();
  };
  if (!T.old) return fail();
  const s = document.createElement('script');
  s.src = T.old;
  s.onerror = fail;
  s.onload = () => {
    for (const g of OLD_GRAPHS) {
      const items = Share.decode(g, code);
      if (items) {
        load(items);
        if (picked.size) showPanel();
        return selectionChanged();
      }
    }
    fail();
  };
  document.head.append(s);
}

const longLink = /#s=([\d,:]+)/.exec(location.hash);
const shortLink = /#t=([\w-]+)/.exec(location.hash);

if (longLink) {
  load(longLink[1].split(',').map(item => item.split(':').map(Number)));
} else if (shortLink) {
  const items = Share.decode(GRAPH, shortLink[1]);
  if (items) load(items);
  else loadOld(shortLink[1]);
}
if (innerWidth < 900 && !picked.size && document.getElementById('notice').hidden) panel.classList.add('hidden');
document.getElementById('toggle').classList.toggle('on', !panel.classList.contains('hidden'));
updatePanel();

const q = document.getElementById('q');
const hits = document.getElementById('hits');
let matches = [], cursor = -1;

// search text for nodes (name, description)
function search() {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  matches = words.length ? T.nodes.filter(n => words.every(w => n.text.includes(w))) : [];
  cursor = -1;
  hits.textContent = words.length ? (matches.length ? matches.length + ' found' : 'no match') : '';
  draw();
}
q.addEventListener('input', search);
q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && matches.length) {
    cursor = (cursor + (e.shiftKey ? matches.length - 1 : 1)) % matches.length;
    hits.textContent = `${cursor + 1} / ${matches.length}`;
    centerOn(matches[cursor]);
  } else if (e.key === 'Escape') {
    q.value = '';
    search();
    q.blur();
  }
});

// hover logic
let hover = null;
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function showTip(n, sx, sy) {
  let html = '<b>' + esc(n.n) + '</b>';
  for (const s of n.s) html += '<div class="stat">' + esc(s) + '</div>';
  if (n.v) {
    const cur = choice.get(n.id);
    html += '<div class="choices">' + n.v.map(([label], i) =>
      '<div' + (i === cur ? ' class="on"' : '') + '>' + esc(label) + '</div>').join('') + '</div>';
  }
  for (const s of n.r) html += '<div class="rem">' + esc(s) + '</div>';
  if (n.f.length) html += '<div class="fl">' + n.f.map(esc).join('<br>') + '</div>';
  if (n.v && picked.has(n.id)) {
    html += '<div class="hint">' + (choice.has(n.id) ? 'Click to change the choice or remove' : 'Click to choose one') + '</div>';
  } else if (preview) {
    const k = (preview.add || preview.remove).size, left = MAX_PICK - picked.size;
    const pts = k + (k === 1 ? ' point' : ' points');
    html += '<div class="hint">' + (preview.remove
      ? (k === 1 ? 'Click to remove' : `Click to remove ${k} nodes (this one and those linked through it)`)
      : k > left ? `Path needs ${pts}, only ${left} left`
      : n.v ? `Click to choose one and allocate (${pts})`
      : `Click to allocate (${pts})`) + '</div>';
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(sx + 16, innerWidth - r.width - 8) + 'px';
  tip.style.top = Math.min(sy + 16, innerHeight - r.height - 8) + 'px';
}
function pick(sx, sy) {
  const [wx, wy] = toWorld(sx, sy);
  let best = null, bestD = Infinity;
  for (const n of T.nodes) {
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d < radius(n) && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

// moving around the tree
let drag = null;
canvas.addEventListener('pointerdown', e => {
  // a click on the tree while the choice menu is open only closes the menu
  const swallow = menuOpen();
  closeMenu();
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, swallow };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    canvas.classList.add('drag');
    camX -= (e.clientX - drag.x) / zoom;
    camY -= (e.clientY - drag.y) / zoom;
    drag.x = e.clientX;
    drag.y = e.clientY;
    tip.style.display = 'none';
    draw();
    return;
  }
  const n = pick(e.clientX, e.clientY);
  if (n !== hover) { hover = n; preview = makePreview(n); draw(); }
  if (n && !menuOpen()) showTip(n, e.clientX, e.clientY); else tip.style.display = 'none';
});
canvas.addEventListener('pointerup', e => {
  const click = drag && !drag.moved && !drag.swallow;
  drag = null;
  canvas.classList.remove('drag');
  if (!click) return;
  const n = pick(e.clientX, e.clientY);
  if (n && n.v) openMenu(n, e.clientX, e.clientY);
  else if (n) {
    toggle(n);
    if (e.pointerType === 'mouse') showTip(n, e.clientX, e.clientY);
  }
});
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('drag'); });
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; if (hover) { hover = preview = null; draw(); } });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  closeMenu();
  zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY);
}, { passive: false });

const center = () => [(innerWidth - panelW()) / 2, TOP + (innerHeight - TOP) / 2];
document.getElementById('in').onclick = () => zoomAt(1.25, ...center());
document.getElementById('out').onclick = () => zoomAt(0.8, ...center());
document.getElementById('fit').onclick = fit;
addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
  if (e.key === '-') zoomAt(0.8, ...center());
  if (e.key === '0') fit();
  if (e.key === 'b') setBg(!showBg);
  if (e.key === '/' || (e.key === 'f' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); q.focus(); q.select(); }
});
addEventListener('resize', resize);

resize();
fit();

// High-resolution PNG of the whole tree (current selection, current background setting)
// High-resolution PNG: the tree in the middle, plan requirements on the left,
// multiple-choice notables (and their chosen options) on the right.
const EXPORT_UI = { bg: '#0c0509', panel: '#160a17', border: '#735cdd', title: '#b3c2f2', head: '#a597ee', text: '#dfe3f5', dim: '#8f87a8', warn: '#f0a860' };

function exportBoxes() {
  const reqs = window.atlasPlan && window.atlasPlan.requirements();
  const left = reqs
    ? reqs.map(r => ({ heading: r.heading, lines: r.lines.map(t => ({ text: t })) }))
    : [{ heading: 'No plan', lines: [{ text: 'This tree was built by hand or loaded from a file, so there are no planner requirements to show.', color: EXPORT_UI.dim }] }];
  const choiceNodes = [...picked.values()].filter(n => n.v).sort((a, b) => a.n.localeCompare(b.n));
  const right = choiceNodes.length
    ? choiceNodes.map(n => ({
        heading: n.n,
        lines: choice.has(n.id)
          ? [{ text: n.v[choice.get(n.id)][0] }]
          : [{ text: 'No option chosen yet', color: EXPORT_UI.warn }],
      }))
    : [{ heading: 'None', lines: [{ text: 'No multiple-choice notables are allocated.', color: EXPORT_UI.dim }] }];
  return {
    left: { title: 'Plan requirements', sub: `${picked.size} / ${MAX_PICK} points allocated`, sections: left },
    right: { title: 'Multiple-choice notables', sub: `${choiceNodes.length} allocated`, sections: right },
  };
}

function wrapLines(c, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (c.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

// draws one box; returns the height used (dry run when draw = false)
function drawBox(c, box, x, y, w, maxH, f, drawIt) {
  const pad = f * 1.2, inner = w - 2 * pad;
  let cy = y + pad;
  const font = (px, weight = 'normal') => `${weight} ${Math.round(px)}px Verdana, Geneva, sans-serif`;
  const ops = [];
  const text = (t, px, color, weight) => {
    c.font = font(px, weight);
    for (const line of wrapLines(c, t, inner)) {
      ops.push([line, x + pad, cy + px, px, color, weight]);
      cy += px * 1.35;
    }
  };
  text(box.title, f * 1.6, EXPORT_UI.title);
  text(box.sub, f * 0.95, EXPORT_UI.dim);
  cy += f * 0.6;
  for (const s of box.sections) {
    cy += f * 0.5;
    text(s.heading, f * 1.05, EXPORT_UI.head, 'bold');
    cy += f * 0.15;
    for (const l of s.lines) text(l.text, f, l.color || EXPORT_UI.text);
  }
  const h = Math.min(maxH, cy - y + pad);
  if (drawIt) {
    c.fillStyle = EXPORT_UI.panel;
    c.strokeStyle = EXPORT_UI.border;
    c.lineWidth = Math.max(2, f * 0.12);
    c.fillRect(x, y, w, h);
    c.strokeRect(x, y, w, h);
    c.textBaseline = 'alphabetic';
    for (const [t, tx, ty, px, color, weight] of ops) { c.font = font(px, weight); c.fillStyle = color; c.fillText(t, tx, ty); }
  }
  return cy - y + pad;
}

function exportPNG(size) {
  const [x0, y0, x1, y1] = T.bounds, pad = 500;
  const W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
  const scale = size / Math.max(W, H);
  const treeW = Math.round(W * scale), treeH = Math.round(H * scale);
  const col = Math.round(treeH * 0.24), gap = Math.round(treeH * 0.02);
  const off = document.createElement('canvas');
  off.width = treeW + 2 * (col + gap);   // symmetric columns keep the tree centred
  off.height = treeH;
  const saved = { ctx, zoom, camX, camY, dpr };
  try {
    ctx = off.getContext('2d');
    if (!ctx) throw new Error('canvas too large for this browser');
    zoom = scale; camX = (x0 + x1) / 2; camY = (y0 + y1) / 2; dpr = 1;
    exporting = true;
    render();
    // side columns (UI colours; the map itself is untouched)
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = EXPORT_UI.bg;
    c.fillRect(0, 0, col + gap, treeH);
    c.fillRect(off.width - col - gap, 0, col + gap, treeH);
    const boxes = exportBoxes(), margin = Math.round(treeH * 0.03), avail = treeH - 2 * margin;
    for (const [box, x] of [[boxes.left, margin * 0.5], [boxes.right, off.width - col]]) {
      const w = col - margin * 0.5;
      let f = treeH / 70;                       // shrink the text until the box fits
      while (f > treeH / 400 && drawBox(c, box, x, margin, w, avail, f, false) > avail) f *= 0.92;
      drawBox(c, box, x, margin, w, avail, f, true);
    }
  } finally {
    exporting = false;
    ({ ctx, zoom, camX, camY, dpr } = saved);
    draw();
  }
  return new Promise((resolve, reject) => off.toBlob(blob => {
    if (!blob) return reject(new Error('the browser could not encode an image this large'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `atlas-tree-${picked.size}pts-${off.width}px.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    resolve({ width: off.width, height: off.height, bytes: blob.size });
  }, 'image/png'));
}
(() => {
  const btn = document.getElementById('png'), pop = document.getElementById('pngMenu');
  btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
  for (const b of pop.querySelectorAll('button[data-size]')) b.onclick = async () => {
    const msg = pop.querySelector('.msg');
    msg.textContent = 'Rendering…';
    await new Promise(r => setTimeout(r, 30));
    try {
      const r = await exportPNG(+b.dataset.size);
      msg.textContent = `Saved ${r.width}×${r.height} px (${(r.bytes / 1048576).toFixed(1)} MB)`;
    } catch (err) {
      msg.textContent = "Couldn't create the image: " + (/tainted/i.test(err.message)
        ? 'the browser blocked it because the tree images were loaded from another site. Reload the page and try again.'
        : err.message);
    }
  };
})();
