// Path planner wizard: 1st target -> optional 2nd target -> what to route through -> points.
// Uses globals from viewer.js: T, START, byId, picked, choice, selectionChanged,
// centerOn, draw, ring, overlays, panel, MAX_PICK.
(() => {
  const graph = Solver.build(T.edges);

  // group nodes by mechanic: nearest mastery (that's how the game lays out clusters)
  const masteries = T.nodes.filter(n => n.k === 'mastery');
  // notables that sit nearer another cluster than the one they belong to
  const OVERRIDE = { 'Stacked Odds': 'Mercenaries', 'Divide and Conquer': 'Breach' };
  const nearest = n => {
    let best = null, d = Infinity;
    for (const m of masteries) { const e = (m.x - n.x) ** 2 + (m.y - n.y) ** 2; if (e < d) { d = e; best = m; } }
    if (!best) return 'Other';
    return OVERRIDE[n.n] || best.n;
  };
  // keystones, plus the free-standing "select a type of content" choice notables
  // (Blended Realities, Merged Worlds, Outside Entities) that behave like keystones
  const isKeystone = n => n.k === 'keystone' || (n.k === 'notable' && n.s.some(t => /^Select a type of content/i.test(t)));
  const keystones = [];
  const groups = new Map(); // name -> { name, notables, minors }
  const group = name => groups.get(name) || groups.set(name, { name, notables: [], minors: [] }).get(name);
  for (const n of T.nodes) {
    if (!graph.index.has(n.id)) continue;
    if (isKeystone(n)) keystones.push(n);
    else if (n.k === 'notable') group(nearest(n)).notables.push(n);
    else if (n.k === 'normal') group(nearest(n)).minors.push(n);
  }
  for (const [k, g] of groups) if (!g.notables.length) groups.delete(k);
  for (const g of groups.values()) g.notables.sort((a, b) => a.n.localeCompare(b.n));
  // the two eldritch influences get their own question, not the mechanic lists
  const ELDRITCH = [['The Searing Exarch', 'Searing Exarch'], ['The Eater of Worlds', 'Eater of Worlds']].filter(([name]) => groups.has(name));
  const isEldritch = name => ELDRITCH.some(([e]) => e === name);
  const groupList = [...groups.values()].filter(g => !isEldritch(g.name)).sort((a, b) => a.name.localeCompare(b.name));
  keystones.sort((a, b) => (a.k === 'keystone') - (b.k === 'keystone') || a.n.localeCompare(b.n));

  // words that mark a text as being about a mechanic (default: the mechanic's own name)
  const KEYWORDS = {
    'Torment': ['tormented spirit'], 'Essence': ['essence', 'imprisoned monster'], 'Shrines': ['shrine'],
    'Beyond': ['beyond', 'demonic evocator'], 'Viridian Wildwood': ['wildwood'], 'Sentinels': ['sentinel'],
    'Settlers of Kalguur': ['kalguur', 'ore deposit'], 'Strongboxes': ['strongbox'], 'Mercenaries': ['mercenar'],
    'Rogue Exiles': ['rogue exile'], 'Betrayal': ['betrayal', 'syndicate'], 'Atlas Anomalies': ['anomal'],
    'Divination Cards': ['divination card'], 'Threads': ['thread'], 'Bestiary': ['beast'], 'Conquerors': ['conqueror'],
    'The Shaper and Elder': ['shaper', 'elder'], 'Atlas Memories': ['memor'], 'Expedition': ['expedition'],
    'Delirium': ['delirium'], 'Mirage': ['mirage'], 'Maps': [],
  };
  const keywords = name => KEYWORDS[name] || [name.toLowerCase().replace(/^the /, '')];
  const about = (text, name) => !!name && keywords(name).some(k => text.toLowerCase().includes(k));
  // which of the chosen mechanics a keystone (or one of its options) is about
  const keyMatches = (n, names) => n.v
    ? n.v.map(([label], i) => [i, names.filter(m => about(label, m))]).filter(([, ms]) => ms.length)
    : names.filter(m => about([n.n, ...n.s, ...n.r].join(' '), m)).length ? [[null, names.filter(m => about([n.n, ...n.s, ...n.r].join(' '), m))]] : [];

  // what to route through on the way
  const minorsAll = T.nodes.filter(n => n.k === 'normal' && graph.index.has(n.id));
  // generic travel-node categories to route through, in the order the user ranks them
  const CATS = [
    { key: 'pack', label: 'Pack size', desc: 'Map Pack Size: 1% increased Pack Size each', names: ['Map Pack Size'] },
    { key: 'threads', label: 'Threads', desc: 'Thread Drop Chance: 3–4% increased Threads found each', names: ['Thread Drop Chance'] },
    { key: 'maps', label: 'Map drops', desc: 'Map Drop Chance: 2% increased Maps found each', names: ['Map Drop Chance'] },
    { key: 'rare', label: 'Rare monsters', desc: 'Map Rare Monsters: 3–5% more Rare Monsters each', names: ['Map Rare Monsters'] },
    { key: 'magic', label: 'Magic monsters', desc: 'Map Magic Monsters: 3–5% more Magic Monsters each', names: ['Map Magic Monsters', 'Magic Monsters'] },
    { key: 'rarity', label: 'Item rarity', desc: 'Item Rarity: 1% increased Rarity of Items found each', names: ['Item Rarity'] },
    { key: 'tier', label: 'Higher map tier', desc: 'Higher Map Tier Chance: 5% chance for maps to drop 1 tier higher', names: ['Higher Map Tier Chance'] },
    { key: 'modeff', label: 'Map modifier effect', desc: 'Map Modifier Effect: 2% increased effect of explicit map mods', names: ['Map Modifier Effect'] },
  ];
  for (const c of CATS) c.nodes = minorsAll.filter(n => c.names.includes(n.n));
  const cat = key => CATS.find(c => c.key === key);
  // cluster nodes: a mechanic's own minor nodes (not generic travel nodes like Map Drop Chance)
  const travelNames = new Set(CATS.flatMap(c => c.names));
  const clusterOf = name => name ? groups.get(name).minors.filter(n => !travelNames.has(n.n)) : [];
  const NONE = { key: 'none', label: 'No preference', desc: 'Just the shortest routes. Spare points go to minor nodes of your chosen mechanics.', nodes: [] };
  const POINTS = [55, 100, 150];

  // settings (remembered in this browser)
  let state = { first: null, seconds: [], eldritch: [], eldPri: 'before', off: [], keys: [], keyChoice: {}, pref: 'pack', backups: ['threads', 'rare'], points: 100, custom: false, fill: true, thorough: false, goal: true, gateways: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem('atlas-plan2') || '{}')); } catch (e) {}
  if (state.first && !groups.has(state.first)) state.first = null;
  if (state.second && !state.seconds.length) state.seconds = [state.second]; // older saved settings
  delete state.second;
  if (isEldritch(state.first)) state.first = null;
  state.seconds = state.seconds.filter(name => groups.has(name) && !isEldritch(name) && name !== state.first).slice(0, 2);
  state.eldritch = state.eldritch.filter(isEldritch).slice(0, 1); // one influence only (older settings may have both)
  if ('eldMust' in state) { state.eldPri = state.eldMust ? 'must' : 'with'; delete state.eldMust; } // older saved settings
  if (!['must', 'before', 'with'].includes(state.eldPri)) state.eldPri = 'before';
  const ELD_PRI = { must: 'must have', before: 'before secondary mechanics', with: 'together with secondary mechanics' };
  const MAX_SECOND = 2;
  if (state.pref !== 'none' && !cat(state.pref)) state.pref = 'pack';
  state.backups = (state.backups || []).filter(k => cat(k) && k !== state.pref);
  // ranked list of categories: main first, then backups in order
  const ranked = () => state.pref === 'none' ? [] : [cat(state.pref), ...state.backups.map(cat)];
  const off = new Set(state.off);
  const keys = new Set(state.keys.filter(id => keystones.some(n => n.id === id)));
  const save = () => {
    state.off = [...off];
    state.keys = [...keys];
    try { localStorage.setItem('atlas-plan2', JSON.stringify(state)); } catch (e) {}
  };

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dlg = $('plan'), body = $('pBody'), back = $('pBack'), next = $('pNext'), stepLbl = $('pStep');
  const statText = n => (n.v ? n.v.map(v => '• ' + v[0]) : n.s).join('\n');
  const chosen = name => name ? groups.get(name).notables.filter(n => !off.has(n.id)) : [];

  let step = 0;
  const STEPS = ['Main mechanic', 'Secondary mechanics', 'Eldritch influence', 'Keystones', 'On the way', 'Then', 'Points', 'Summary'];
  const ELD_STEP = 2, KEY_STEP = 3, PREF_STEP = 4, THEN_STEP = 5, POINTS_STEP = 6;
  const eldName = name => ELDRITCH.find(([e]) => e === name)[1];

  // tickable notable list for one mechanic
  function notableList(container, name, onChange) {
    const g = groups.get(name);
    const head = el('div', 'dhead');
    head.append(el('b', null, (isEldritch(name) ? eldName(name) : name) + ' notables'), el('span', null, `${chosen(name).length} of ${g.notables.length} targeted`));
    container.append(head);
    const ul = el('ul');
    for (const n of g.notables) {
      const li = el('li'), lab = el('label'), cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !off.has(n.id);
      cb.onchange = () => { cb.checked ? off.delete(n.id) : off.add(n.id); save(); onChange(); };
      lab.append(cb, el('span', null, n.n + (n.v ? ' (choice)' : '')));
      li.append(lab, el('div', 'st', statText(n)));
      ul.append(li);
    }
    container.append(ul);
    const c = clusterOf(name).length;
    if (c) container.append(el('div', 'cl', `+ ${c} cluster nodes, always included`));
  }
  const chosenKeys = () => keystones.filter(n => keys.has(n.id));

  // mechanic picker shared by steps 1 and 2
  function mechanicStep(which) {
    const isFirst = which === 'first';
    body.append(el('h3', null, isFirst ? 'Which notables do you want first?' : 'Anything else, if points are left? (optional)'));
    body.append(el('p', 'hint', isFirst
      ? 'Pick your main mechanic. The path heads there first and covers its notables before anything else.'
      : `Pick up to ${MAX_SECOND} secondary mechanics. They share whatever points are left after your main mechanic (and keystones) are covered.`));
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = 'Filter (e.g. betrayal, scarab, gold)';
    filter.autocomplete = 'off';
    body.append(filter);
    const grid = el('div', 'grid'), detail = el('div', 'detail');
    body.append(grid, detail);

    const renderGrid = () => {
      const q = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      grid.innerHTML = '';
      if (!isFirst) {
        const none = el('button', 'chip' + (state.seconds.length ? '' : ' on'), 'None');
        none.onclick = () => { state.seconds = []; save(); renderGrid(); renderDetail(); update(); };
        grid.append(none);
      }
      const isOn = name => isFirst ? state.first === name : state.seconds.includes(name);
      for (const g of groupList) {
        if (!isFirst && g.name === state.first) continue;
        if (q.length && !q.every(w => g.name.toLowerCase().includes(w) || g.notables.some(n => n.text.includes(w)))) continue;
        const b = el('button', 'chip' + (isOn(g.name) ? ' on' : ''));
        b.append(el('span', null, g.name), el('small', null, String(g.notables.length)));
        b.title = g.notables.map(n => n.n).join('\n');
        b.onclick = () => {
          if (isFirst) {
            state.first = g.name;
            state.seconds = state.seconds.filter(x => x !== g.name);
          } else if (state.seconds.includes(g.name)) {
            state.seconds = state.seconds.filter(x => x !== g.name);
          } else {
            // already two: the newest pick replaces the oldest
            state.seconds = [...state.seconds, g.name].slice(-MAX_SECOND);
          }
          save(); renderGrid(); renderDetail(); update();
        };
        grid.append(b);
      }
    };
    const renderDetail = () => {
      detail.innerHTML = '';
      for (const name of isFirst ? [state.first].filter(Boolean) : state.seconds) renderGroup(name);
    };
    const renderGroup = name => notableList(detail, name, () => { renderDetail(); update(); });
    filter.addEventListener('input', renderGrid);
    renderGrid();
    renderDetail();
    setTimeout(() => filter.focus(), 0);
  }

  function eldritchStep() {
    body.append(el('h3', null, 'Eldritch influence?'));
    body.append(el('p', 'hint', 'Searing Exarch or Eater of Worlds notables (eldritch altars). You can only take one of the two.'));
    const opts = [
      ['Searing Exarch', [ELDRITCH[0][0]]],
      ['Eater of Worlds', [ELDRITCH[1][0]]],
      ['Neither', []],
    ];
    const row = el('div', 'grid');
    for (const [label, names] of opts) {
      const on = names.length === state.eldritch.length && names.every(x => state.eldritch.includes(x));
      const b = el('button', 'chip big wide' + (on ? ' on' : ''), label);
      b.onclick = () => { state.eldritch = names; save(); render(); };
      row.append(b);
    }
    body.append(row);
    if (!state.eldritch.length) return;
    const secNames = state.seconds.length ? state.seconds.join(' and ') : 'your secondary mechanics';
    body.append(el('h3', 'sub', `Prioritise ${state.eldritch.map(eldName).join(' / ')} altars over ${secNames}?`));
    const pri = el('div', 'cards');
    for (const [key, label, desc] of [
      ['must', 'Must have', 'Same priority as your main mechanic.'],
      ['before', 'Yes, before secondary mechanics', `Covered right after your main mechanic. ${secNames} only get the points left after that.`],
      ['with', 'No, together with secondary mechanics', `Shares the leftover points equally with ${secNames}.`],
    ]) {
      const b = el('button', 'card' + (state.eldPri === key ? ' on' : ''));
      b.append(el('b', null, label), el('span', null, desc));
      b.onclick = () => { state.eldPri = key; save(); render(); };
      pri.append(b);
    }
    body.append(pri);
    const detail = el('div', 'detail');
    detail.style.marginTop = '12px';
    body.append(detail);
    const renderDetail = () => {
      detail.innerHTML = '';
      for (const name of state.eldritch) notableList(detail, name, () => { renderDetail(); update(); });
    };
    renderDetail();
  }

  function keystoneStep() {
    const mechs = [state.first, ...state.seconds, ...state.eldritch].filter(Boolean);
    body.append(el('h3', null, 'Any keystones you want? (optional)'));
    body.append(el('p', 'hint', `Showing keystones for ${mechs.map(m => isEldritch(m) ? eldName(m) : m).join(', ')}. Ticked ones are must-haves, just like your first target. ★ marks the option that fits your mechanics.`));
    let showAll = false;
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = 'Filter keystones';
    filter.autocomplete = 'off';
    body.append(filter);
    const box = el('div', 'detail keys');
    body.append(box);
    const renderKeys = () => {
      const q = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      box.innerHTML = '';
      const head = el('div', 'dhead');
      head.append(el('b', null, 'Keystones'), el('span', null, `${keys.size} selected`));
      box.append(head);
      const ul = el('ul');
      let hidden = 0, shown = 0;
      for (const n of keystones) {
        const matches = keyMatches(n, mechs);
        if (!showAll && !matches.length && !keys.has(n.id)) { hidden++; continue; }
        if (q.length && !q.every(w => n.text.includes(w))) continue;
        shown++;
        const li = el('li' , keys.has(n.id) ? 'on' : ''), lab = el('label'), cb = el('input');
        cb.type = 'checkbox';
        cb.checked = keys.has(n.id);
        cb.onchange = () => {
          if (cb.checked) {
            keys.add(n.id);
            // choice keystone: default to the option for your first mechanic (else second)
            if (n.v && state.keyChoice[n.id] == null && matches.length) {
              const best = matches.find(([, ms]) => ms.includes(state.first)) || matches[0];
              state.keyChoice[n.id] = best[0];
            }
          } else keys.delete(n.id);
          save(); renderKeys(); update();
        };
        const tag = matches.length ? [...new Set(matches.flatMap(([, ms]) => ms))].join(', ') : 'general';
        lab.append(cb, el('span', null, n.n), el('small', 'tag', (n.k === 'keystone' ? 'keystone' : 'choice') + ' · ' + tag));
        li.append(lab);
        if (n.v) {
          const sel = el('select');
          sel.append(new Option('Decide later', ''));
          const starred = new Set(matches.map(([i]) => i));
          n.v.forEach(([label], i) => sel.append(new Option((starred.has(i) ? '★ ' : '') + label, i, false, state.keyChoice[n.id] === i)));
          sel.onchange = () => {
            if (sel.value === '') delete state.keyChoice[n.id]; else state.keyChoice[n.id] = +sel.value;
            if (sel.value !== '' && !keys.has(n.id)) keys.add(n.id);
            save(); renderKeys(); update();
          };
          li.append(sel);
        } else li.append(el('div', 'st', statText(n)));
        ul.append(li);
      }
      box.append(ul);
      if (!shown) box.append(el('p', 'hint', `No keystones for ${mechs.join(' or ')}.`));
      if (hidden || showAll) {
        const t = el('button', 'more', showAll ? 'Show only keystones for my mechanics' : `Show ${hidden} other keystone${hidden > 1 ? 's' : ''}`);
        t.onclick = () => { showAll = !showAll; renderKeys(); };
        box.append(t);
      }
    };
    filter.addEventListener('input', renderKeys);
    renderKeys();
  }

  function prefStep() {
    body.append(el('h3', null, 'What should the path go through on the way?'));
    body.append(el('p', 'hint', 'Your main pick. When two routes reach the same notables, the planner takes the one through more of these, and spare points go to them first. You rank backups next.'));
    const list = el('div', 'cards');
    for (const c of [...CATS, NONE]) {
      const b = el('button', 'card' + (state.pref === c.key ? ' on' : ''));
      const t = el('b', null, c.label);
      if (c.nodes.length) t.append(el('small', null, ` ${c.nodes.length} nodes`));
      b.append(t, el('span', null, c.desc));
      b.onclick = () => {
        state.pref = c.key;
        state.backups = state.backups.filter(k => k !== c.key);
        save(); render();
      };
      list.append(b);
    }
    body.append(list);
  }

  function thenStep() {
    body.append(el('h3', null, `After ${cat(state.pref).label.toLowerCase()}, what next?`));
    body.append(el('p', 'hint', `Used where no ${cat(state.pref).label.toLowerCase()} nodes are close. Click in order of priority: 1st, 2nd, 3rd… Click again to remove.`));
    const list = el('div', 'cards ranked');
    for (const c of CATS) {
      if (c.key === state.pref) continue;
      const r = state.backups.indexOf(c.key);
      const b = el('button', 'card' + (r >= 0 ? ' on' : ''));
      const t = el('b');
      if (r >= 0) t.append(el('span', 'rank', String(r + 1)));
      t.append(c.label, el('small', null, ` ${c.nodes.length} nodes`));
      b.append(t, el('span', null, c.desc));
      b.onclick = () => {
        state.backups = r >= 0 ? state.backups.filter(k => k !== c.key) : [...state.backups, c.key];
        save(); render();
      };
      list.append(b);
    }
    body.append(list);
    if (state.backups.length) {
      const clr = el('button', 'more', 'Clear all');
      clr.onclick = () => { state.backups = []; save(); render(); };
      body.append(clr);
    }
  }

  function pointsStep() {
    body.append(el('h3', null, 'How many points do you have?'));
    const row = el('div', 'pts');
    for (const v of POINTS) {
      const b = el('button', 'chip big' + (!state.custom && state.points === v ? ' on' : ''), String(v));
      b.onclick = () => { state.points = v; state.custom = false; save(); render(); };
      row.append(b);
    }
    const cb = el('button', 'chip big' + (state.custom ? ' on' : ''), 'Custom');
    cb.onclick = () => { state.custom = true; save(); render(); };
    row.append(cb);
    body.append(row);
    if (state.custom) {
      const lab = el('label', 'custom', 'Points ');
      const inp = el('input');
      inp.type = 'number'; inp.min = 1; inp.max = pointCap(); inp.step = 1; inp.value = state.points;
      inp.oninput = () => { state.points = Math.floor(+inp.value) || 0; save(); update(); };
      inp.onkeydown = e => { if (e.key === 'Enter' && !next.disabled) next.click(); };
      lab.append(inp, el('small', null, ` (1–${pointCap()})` + (noLimit ? ' · point limit off' : '')));
      body.append(lab);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }
    const opts = el('div', 'opts');
    const opt = (key, text) => {
      const lab = el('label', 'opt'), c = el('input');
      c.type = 'checkbox'; c.checked = state[key];
      c.onchange = () => { state[key] = c.checked; save(); };
      lab.append(c, el('span', null, text));
      opts.append(lab);
    };
    opt('fill', 'Spend leftover points (on the nodes from the previous step)');
    opt('gateways', 'Allow Gateway jumps (a Gateway lets you continue from its linked Gateway across the tree)');
    opt('thorough', 'Thorough search (about 12 s instead of 3 s)');
    if (state.points < MAX_PICK) opt('goal', `Also plan the ${MAX_PICK}-point version to work toward (it keeps all ${state.points} nodes)`);
    body.append(opts);

  }

  // last step: everything in priority order, with links back to edit
  function summaryStep() {
    body.append(el('h3', null, 'Check your plan'));
    body.append(el('p', 'hint', 'This is the order the planner fills your points in. Click Edit to change anything.'));
    const sum = el('div', 'summary');
    const section = (num, title, goTo, rows) => {
      const sec = el('div', 'sec');
      const head = el('div', 'shead');
      if (num) head.append(el('span', 'rank', String(num)));
      head.append(el('b', null, title));
      if (goTo != null) {
        const e = el('button', 'edit', 'Edit');
        e.onclick = () => { step = goTo; render(); };
        head.append(e);
      }
      sec.append(head);
      for (const r of rows) sec.append(typeof r === 'string' ? el('div', 'row', r) : r);
      sum.append(sec);
    };
    const mech = (name, label) => {
      const g = groups.get(name), on = chosen(name), offList = g.notables.filter(n => off.has(n.id));
      const row = el('div', 'row');
      row.append(el('span', 'nm', label || name), ` ${on.length} notable${on.length === 1 ? '' : 's'} + ${clusterOf(name).length} cluster nodes`);
      if (offList.length) row.append(el('div', 'sub', 'Left out: ' + offList.map(n => n.n).join(', ')));
      return row;
    };
    const keyRow = n => {
      const row = el('div', 'row');
      row.append(el('span', 'nm', n.n));
      if (n.v) row.append(' ', el('span', 'sub', state.keyChoice[n.id] != null ? '→ ' + n.v[state.keyChoice[n.id]][0] : '(option: decide later)'));
      return row;
    };
    const eld = state.eldritch.map(name => mech(name, eldName(name)));

    let num = 0;
    section(++num, 'Must have', null, [
      ...[mech(state.first)].map(r => (r.prepend(el('small', 'tag', 'Main')), r)),
      ...(state.eldPri === 'must' ? eld.map(r => (r.prepend(el('small', 'tag', 'Eldritch')), r)) : []),
      ...chosenKeys().map(n => { const r = keyRow(n); r.prepend(el('small', 'tag', 'Keystone')); return r; }),
    ]);
    if (state.eldPri === 'before' && eld.length)
      section(++num, 'Eldritch altars, before secondary mechanics', ELD_STEP, eld);
    const second = [
      ...state.seconds.map(name => mech(name)),
      ...(state.eldPri === 'with' ? eld.map(r => (r.prepend(el('small', 'tag', 'Eldritch')), r)) : []),
    ];
    section(++num, 'If points are left', 1, second.length ? second : ['Nothing']);
    const tiers = ranked();
    section(++num, 'On the way', PREF_STEP, tiers.length
      ? [tiers.map(c => `${c.label} (${c.nodes.length})`).join('  →  ')]
      : ['No preference: shortest routes']);

    // relevant keystones that will be avoided
    const mechs = [state.first, ...state.seconds, ...state.eldritch].filter(Boolean);
    const avoided = keystones.filter(n => !keys.has(n.id) && keyMatches(n, mechs).length);
    section(0, 'Avoided keystones', KEY_STEP, avoided.length
      ? [avoided.map(n => n.n).join(', '), el('div', 'sub', 'Never allocated, not even as a pass-through. Their cluster is still taken up to them.')]
      : ['None for your mechanics']);
    section(0, 'Settings', POINTS_STEP, [
      `${state.points} points`,
      state.fill ? 'Spend leftover points on travel nodes' : 'Leftover points stay unspent',
      state.gateways ? 'Gateway jumps allowed' : 'No Gateway jumps',
      state.thorough ? 'Thorough search (about 12 s)' : 'Quick search (about 3 s)',
      ...(state.points < MAX_PICK ? [state.goal ? `Also plans the ${MAX_PICK}-point goal, grown from this tree` : `No ${MAX_PICK}-point goal`] : []),
    ]);
    body.append(sum);
    // main mechanic / secondary edit links (sections 1 and 2 cover several steps)
    const mainEdit = el('div', 'edits');
    for (const [label, s2] of [['Main mechanic', 0], ['Secondary', 1], ['Eldritch', ELD_STEP], ['Keystones', KEY_STEP]]) {
      const b = el('button', 'edit', 'Edit ' + label.toLowerCase());
      b.onclick = () => { step = s2; render(); };
      mainEdit.append(b);
    }
    sum.children[0].querySelector('.shead').append(mainEdit);
  }

  function update() {
    const ok = [
      () => chosen(state.first).length > 0,
      () => true,
      () => true,
      () => true,
      () => true,
      () => true,
      () => state.points >= 1 && state.points <= pointCap(),
      () => chosen(state.first).length > 0 && state.points >= 1 && state.points <= pointCap(),
    ][step]();
    next.disabled = !ok;
    next.textContent = step === STEPS.length - 1 ? 'Find best path' : (step === 1 && !state.seconds.length) || (step === ELD_STEP && !state.eldritch.length) || (step === KEY_STEP && !keys.size) || (step === THEN_STEP && !state.backups.length) ? 'Skip' : 'Next';
    back.style.visibility = step ? '' : 'hidden';
    stepLbl.textContent = `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`;
  }

  function render() {
    body.innerHTML = '';
    $('pStatus').textContent = '';
    [() => mechanicStep('first'), () => mechanicStep('second'), eldritchStep, keystoneStep, prefStep, thenStep, pointsStep, summaryStep][step]();
    update();
  }

  // missed targets drawn with a red ring after a plan
  let missed = [];
  overlays.push(() => { for (const n of missed) ring(n, '#e05050', 2.5, 6); });

  const openDlg = () => { step = 0; dlg.hidden = false; render(); };
  const closeDlg = () => { dlg.hidden = true; };
  let running = false;

  async function run() {
    const budget = state.points;
    const eld = state.eldritch.flatMap(chosen);
    const first = [...chosen(state.first), ...(state.eldPri === 'must' ? eld : [])];
    const middle = state.eldPri === 'before' ? eld : [];
    const second = [...state.seconds.flatMap(chosen), ...(state.eldPri === 'with' ? eld : [])];
    const tiers = ranked(); // each rank counts 60% of the one before
    const mechMinors = [state.first, ...state.seconds, ...state.eldritch].filter(Boolean).flatMap(name => groups.get(name).minors);
    // cluster nodes: a mechanic's own minor nodes (not generic travel nodes like Map Drop Chance)
    const cluster = clusterOf;
    const eldCluster = state.eldritch.flatMap(cluster);
    const mainCluster = [...cluster(state.first), ...(state.eldPri === 'must' ? eldCluster : [])];
    const middleCluster = state.eldPri === 'before' ? eldCluster : [];
    const secondCluster = [...state.seconds.flatMap(cluster), ...(state.eldPri === 'with' ? eldCluster : [])];
    // keystones you didn't tick are never allocated, not even as a pass-through
    const blocked = keystones.filter(n => !keys.has(n.id)).map(n => n.id);
    if (!state.gateways) for (const n of T.nodes) if (n.k === 'wormhole') blocked.push(n.id);

    // strict tiers, each worth more than everything below it put together:
    //   must-haves 1e6 (cluster 8e5) > eldritch "before" 1000 (800) > secondary 1 (0.8) > travel nodes 0.005…
    const weights = new Map(), tie = new Map();
    // with "spend leftover" off, preferred minors only steer the route (no extra points on them)
    for (const n of mechMinors) tie.set(n.id, 1e-4);
    tiers.forEach((c, r) => {
      for (const n of c.nodes) state.fill ? weights.set(n.id, 0.005 * 0.6 ** r) : tie.set(n.id, 1e-3 * 0.6 ** r);
    });
    // cluster nodes belong to their mechanic: same tier as its notables (a notable still edges out one minor node)
    for (const n of secondCluster) weights.set(n.id, 0.8);
    for (const n of middleCluster) weights.set(n.id, 800);
    for (const n of mainCluster) weights.set(n.id, 8e5);
    for (const n of second) weights.set(n.id, 1);
    for (const n of middle) weights.set(n.id, 1000);
    for (const n of first) weights.set(n.id, 1e6);
    const keyNodes = chosenKeys();
    for (const n of keyNodes) weights.set(n.id, 1e6);
    if (picked.size && !confirm(`Replace your current ${picked.size}-point selection with a planned one?`)) return;

    track('plan-run', `Plan: ${state.first || 'none'}, ${budget} pts`);
    for (const m of [state.first, ...state.seconds]) if (m) track('mechanic/' + m, 'Mechanic: ' + m);
    running = true;
    next.disabled = back.disabled = true;
    const status = $('pStatus');
    const firstIds = first.map(n => n.id), secondIds = second.map(n => n.id);
    const countIn = (best, ids) => best ? ids.filter(id => best.tree[graph.index.get(id)]).length : 0;
    const wantGoal = state.goal && budget < MAX_PICK;

    // one plan: search, then spend leftover points; fixed = a smaller plan this one must contain
    async function search(points, fixed, label) {
      const res = await Solver.solve(graph, START, weights, points, {
        tieWeights: tie,
        blocked,
        fixed,
        timeMs: state.thorough ? 12000 : 3000,
        onProgress: (r, best) => {
          status.textContent = `${label}: ${r} attempts. Best so far: must-haves ${countIn(best, firstIds)}/${firstIds.length}` +
            (keyNodes.length ? `, keystones ${countIn(best, keyNodes.map(n => n.id))}/${keyNodes.length}` : '') +
            (second.length ? `, secondary ${countIn(best, secondIds)}/${secondIds.length}` : '') + ` in ${best ? best.size : 0} points`;
        },
      });
      let ids = res.ids;
      if (state.fill && points > ids.length) {
        const fillW = new Map();
        for (const n of mechMinors) fillW.set(n.id, tiers.length ? 0.1 : 1);
        for (const n of secondCluster) fillW.set(n.id, 1.5);
        for (const n of mainCluster) fillW.set(n.id, 2);
        tiers.forEach((c, r) => { for (const n of c.nodes) fillW.set(n.id, 0.6 ** r); });
        ids = Solver.extend(graph, START, ids, fillW, points, blocked);
      }
      return { points, ids: outward(ids) };
    }

    const now = await search(budget, null, wantGoal ? `Searching (1 of 2, ${budget} points)` : 'Searching…');
    const goalPlan = wantGoal ? await search(MAX_PICK, now.ids, `Searching (2 of 2, ${MAX_PICK}-point goal)`) : null;
    running = false;
    back.disabled = false;

    lastRun = { first, middle, second, keyNodes, tiers, clusterAll: [...mainCluster, ...middleCluster, ...secondCluster] };
    requirements = buildRequirements(budget, !!goalPlan);
    goal = goalPlan ? { points: MAX_PICK, ids: new Set(goalPlan.ids) } : null;
    plans = { now, goal: goalPlan };
    viewing = 'now';
    applyPlan(now);
    panel.classList.remove('hidden');
    $('toggle').classList.add('on');
    closeDlg();
  }

  // order nodes by distance from the start so the panel list reads outward
  function outward(ids) {
    const set = new Set(ids), seen = new Set([START]), queue = [START];
    for (let i = 0; i < queue.length; i++) {
      const a = graph.index.get(queue[i]);
      for (let k = graph.off[a]; k < graph.off[a + 1]; k++) {
        const v = graph.ids[graph.nb[k]];
        if (set.has(v) && !seen.has(v)) { seen.add(v); queue.push(v); }
      }
    }
    return queue.slice(1);
  }

  let lastRun = null, plans = null, viewing = 'now';
  let requirements = null; // [{ heading, lines: [text] }] describing the last plan

  function buildRequirements(points, withGoal) {
    const mechLine = (name, label) => {
      const on = chosen(name), left = groups.get(name).notables.filter(n => off.has(n.id));
      return `${label || name}: ${on.length} notable${on.length === 1 ? '' : 's'} + ${clusterOf(name).length} cluster nodes` +
        (left.length ? ` (left out: ${left.map(n => n.n).join(', ')})` : '');
    };
    const mechs = [state.first, ...state.seconds, ...state.eldritch].filter(Boolean);
    const avoided = keystones.filter(n => !keys.has(n.id) && keyMatches(n, mechs).length);
    const tiers = ranked();
    return [
      { heading: 'Points', lines: [`${points}` + (withGoal ? ` (also planned a ${MAX_PICK}-point goal)` : '')] },
      { heading: 'Main mechanic (must have)', lines: [mechLine(state.first)] },
      { heading: 'Secondary mechanics', lines: state.seconds.length ? state.seconds.map(n => mechLine(n)) : ['None'] },
      { heading: 'Eldritch influence', lines: state.eldritch.length
        ? state.eldritch.map(n => mechLine(n, eldName(n)) + ` — ${ELD_PRI[state.eldPri]}`) : ['None'] },
      { heading: 'Keystones (must have)', lines: chosenKeys().length
        ? chosenKeys().map(n => n.n + (n.v && state.keyChoice[n.id] != null ? ` → ${n.v[state.keyChoice[n.id]][0]}` : ''))
        : ['None'] },
      { heading: 'On the way', lines: [tiers.length ? tiers.map(c => c.label).join(' → ') : 'No preference (shortest routes)'] },
      { heading: 'Avoided keystones', lines: [avoided.length ? avoided.map(n => n.n).join(', ') : 'None'] },
      { heading: 'Options', lines: [
        state.gateways ? 'Gateway jumps allowed' : 'No Gateway jumps',
        state.fill ? 'Leftover points spent on travel nodes' : 'Leftover points left unspent',
      ] },
    ];
  }
  window.atlasPlan = { requirements: () => requirements };
  // a mechanic's own nodes (notables, cluster nodes, keystones; not generic travel nodes), for the map highlight
  window.atlasMechanic = name => groups.has(name)
    ? [...groups.get(name).notables, ...clusterOf(name), ...keystones.filter(k => nearest(k) === name)]
    : [];
  let goal = null; // { points, ids:Set } – the bigger tree to grow into

  function applyPlan(plan) {
    picked.clear();
    choice.clear();
    for (const id of plan.ids) picked.set(id, byId.get(id));
    for (const n of lastRun.keyNodes) if (picked.has(n.id) && n.v && state.keyChoice[n.id] != null) choice.set(n.id, state.keyChoice[n.id]);
    applying = true;
    selectionChanged();
    applying = false;
    report(plan);
    renderGoalBar();
    draw();
  }

  function report(plan) {
    const R = lastRun, covered = new Set(plan.ids);
    missed = [...R.first, ...R.keyNodes, ...R.middle, ...R.second].filter(n => !covered.has(n.id));
    const box = $('planres');
    box.innerHTML = '';
    const head = el('div');
    head.append(el('b', null, plans.goal ? (plan === plans.goal ? `Planned path: ${plan.points}-point goal` : `Planned path: ${plan.points} points now`) : 'Planned path'));
    const hide = el('button', null, '×');
    hide.title = 'Hide this report and the red rings';
    hide.onclick = () => { box.hidden = true; missed = []; draw(); };
    head.append(hide);
    box.append(head);
    const got = list => list.filter(n => covered.has(n.id)).length;
    const mainList = chosen(state.first);
    box.append(el('div', null, `Main, ${state.first}: ${got(mainList)} / ${mainList.length} notables`));
    if (R.keyNodes.length) box.append(el('div', null, `Keystones: ${got(R.keyNodes)} / ${R.keyNodes.length}`));
    for (const name of state.seconds) {
      const list = chosen(name);
      if (list.length) box.append(el('div', null, `Secondary, ${name}: ${got(list)} / ${list.length} notables`));
    }
    for (const name of state.eldritch) {
      const list = chosen(name);
      if (list.length) box.append(el('div', null, `Eldritch (${ELD_PRI[state.eldPri]}), ${eldName(name)}: ${got(list)} / ${list.length} notables`));
    }
    if (R.clusterAll.length) box.append(el('div', null, `Cluster nodes: ${got(R.clusterAll)} / ${R.clusterAll.length}`));
    if (R.tiers.length) box.append(el('div', null, 'On the way: ' + R.tiers.map(c => `${c.label} ${got(c.nodes)}`).join(' · ')));
    box.append(el('div', 'dim', `${plan.ids.length} / ${plan.points} points used.`));
    const jumps = GATEWAY_LINKS.filter(([a, b]) => covered.has(a) && covered.has(b));
    if (jumps.length) box.append(el('div', 'gate', `Uses ${jumps.length === 1 ? 'a Gateway jump' : jumps.length + ' Gateway jumps'} (${jumps.map(([a]) => byId.get(a).n).join(', ')}): the gold dashed line. The part past it is connected through the Gateway.`));
    if (missed.length) {
      const m = el('div', 'miss', 'Not reached (red rings): ');
      missed.forEach((n, i) => {
        const a = el('a', null, n.n);
        a.onclick = () => centerOn(n);
        m.append(a, i < missed.length - 1 ? ', ' : '');
      });
      box.append(m);
    }
    const needChoice = [...picked.values()].filter(n => n.v && !choice.has(n.id)).length;
    if (needChoice) box.append(el('div', 'ch', `${needChoice} multiple-choice node(s) need an option picked (orange rings, dropdowns below).`));
    box.hidden = false;
  }

  // goal bar: switch between your tree and the goal; the goal's missing nodes get purple rings
  let applying = false, savedNow = null;
  function renderGoalBar() {
    const bar = $('goalbar');
    bar.innerHTML = '';
    if (!goal) { bar.hidden = true; return; }
    bar.hidden = false;
    const left = [...goal.ids].filter(id => !picked.has(id)).length;
    const seg = el('div', 'seg');
    const nowB = el('button', viewing === 'now' ? 'on' : '', viewing === 'now' ? `My tree · ${picked.size}` : 'My tree');
    const goalB = el('button', viewing === 'goal' ? 'on' : '', `${goal.points}-point goal`);
    nowB.onclick = () => showView('now');
    goalB.onclick = () => showView('goal');
    seg.append(nowB, goalB);
    const x = el('button', 'x', '×');
    x.title = 'Forget the goal';
    x.onclick = () => { if (viewing === 'goal') showView('now'); goal = null; plans && (plans.goal = null); renderGoalBar(); draw(); };
    const top = el('div', 'gtop');
    top.append(seg, x);
    bar.append(top);
    bar.append(el('div', 'gtxt', viewing === 'goal'
      ? `Showing the ${goal.points}-point goal. Changes you make here edit the goal.`
      : left ? `${left} more node${left > 1 ? 's' : ''} to reach your goal (dashed purple rings).` : 'Your tree contains the whole goal.'));
  }
  function showView(which) {
    if (which === viewing || !goal) return;
    if (which === 'goal') {
      savedNow = { ids: [...picked.keys()], choice: new Map(choice) };
      viewing = 'goal';
      if (plans && plans.goal && setEq(goal.ids, plans.goal.ids)) applyPlan(plans.goal);
      else applyIds(outward([...goal.ids]));
    } else {
      viewing = 'now';
      const back = savedNow || { ids: [], choice: new Map() };
      if (plans && plans.now && back.ids.length === plans.now.ids.length && back.ids.every(id => plans.now.ids.includes(id))) {
        applyPlan(plans.now);
        for (const [id, c] of back.choice) if (picked.has(id)) choice.set(id, c);
      } else {
        applyIds(back.ids);
        for (const [id, c] of back.choice) if (picked.has(id)) choice.set(id, c);
      }
      applying = true; selectionChanged(); applying = false;
    }
    renderGoalBar();
  }
  const setEq = (a, b) => a.size === b.length && b.every(id => a.has(id));
  function applyIds(ids) {
    const keepChoice = new Map(choice);
    picked.clear();
    choice.clear();
    for (const id of ids) if (byId.has(id)) picked.set(id, byId.get(id));
    for (const [id, c] of keepChoice) if (picked.has(id)) choice.set(id, c);
    applying = true; selectionChanged(); applying = false;
    $('planres').hidden = true;
    missed = [];
    renderGoalBar();
    draw();
  }
  // keep the goal bar in sync with manual edits; edits while viewing the goal change the goal
  selectionHooks.push(() => {
    if (applying || !goal) return;
    if (viewing === 'goal') goal.ids = new Set(picked.keys());
    setTimeout(renderGoalBar, 0);
  });
  overlays.push(() => {
    if (!goal || viewing !== 'now') return;
    ctx.save();
    ctx.setLineDash([6 / zoom, 5 / zoom]);
    for (const id of goal.ids) if (!picked.has(id)) ring(byId.get(id), '#b080ff', 2, 3);
    ctx.restore();
  });
  // used by Save / Load in viewer.js
  window.atlasGoal = {
    get: () => goal,
    set: (ids, points) => {
      requirements = null; // a loaded tree wasn't made by this plan
      viewing = 'now';
      goal = ids && ids.length ? { points: points || MAX_PICK, ids: new Set(ids) } : null;
      plans = null;
      renderGoalBar();
      draw();
    },
  };

  next.onclick = () => {
    if (running) return;
    if (step < STEPS.length - 1) { step++; if (step === THEN_STEP && state.pref === 'none') step++; render(); }
    else run();
  };
  back.onclick = () => { if (step && !running) { step--; if (step === THEN_STEP && state.pref === 'none') step--; render(); } };
  $('planBtn').onclick = openDlg;
  window.openPlanner = openDlg;
  $('pClose').onclick = () => { if (!running) closeDlg(); };
  dlg.addEventListener('pointerdown', e => { if (e.target === dlg && !running) closeDlg(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !dlg.hidden && !running) closeDlg(); });
  $('clear').addEventListener('click', () => { missed = []; requirements = null; $('planres').hidden = true; draw(); });
})();
