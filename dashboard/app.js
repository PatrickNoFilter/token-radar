// Token Radar dashboard, model radar-2. Reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, a filterable
// sortable table, a per-protocol detail view with the model's own inputs
// and the protocol's farm plan, and a Live-token tab. No network: every
// byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic. radar-2 adds
  // breadth: 1 + 0.02 per extra chain, up to five extra chains.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + Math.max(0, Math.min((row.chains ? row.chains.length : 1) - 1, model.breadth_max_chains)) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }
  function factorsOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + Math.max(0, Math.min((row.chains ? row.chains.length : 1) - 1, model.breadth_max_chains)) * model.breadth_per_chain;
    return { base: row.tvl_usd * model.base_multiple, growth: growth, growthMult: growthMult, maturity: maturity, breadth: breadth, age: age };
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) { return chain === 'Ethereum' ? 'about $5 to $10 of gas' : 'about $1 to $3 of gas'; }
  function catKey(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'dex';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'perps';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    return 'general';
  }
  function actionFor(p, capital, chain) {
    var name = p.name;
    switch (catKey(p)) {
      case 'lending': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow $20 of USDC against it, keeping the loan healthy.';
      case 'dex': return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position in range.';
      case 'yield': return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.';
      case 'bridge': return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
      case 'staking': return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
      case 'perps': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
      case 'prediction': return 'Fund $' + capital + ' on ' + name + ' and place one market position on ' + chain + '.';
      case 'stable': return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
      case 'rwa': return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
      case 'insurance': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    }
  }
  function weeklyFor(p) {
    switch (catKey(p)) {
      case 'lending': return 'Make one qualifying action each week: add $10 of supply, repay and re-borrow $10, or vote in one governance poll.';
      case 'dex': return 'Make one qualifying action each week: swap $10 through the pool, add $10 of liquidity, or claim and re-stake the fees.';
      case 'yield': return 'Make one qualifying action each week: deposit another $10, move $10 between vaults, or claim the vault yield.';
      case 'bridge': return 'Make one qualifying action each week: bridge $10 in either direction or use the bridged funds in one app transaction.';
      case 'staking': return 'Make one qualifying action each week: stake another $10, restake the rewards, or vote with the staked position.';
      case 'perps': return 'Make one qualifying action each week: open and close one small trade, keeping the total size under $25.';
      case 'prediction': return 'Make one qualifying action each week: place one small market position of $5 to $10 and settle it.';
      case 'stable': return 'Make one qualifying action each week: mint $10, swap $10 through the stable asset, or hold it in the protocol app.';
      case 'rwa': return 'Make one qualifying action each week: mint another $10 of the yield asset or claim and re-mint the yield.';
      case 'insurance': return 'Make one qualifying action each week: renew or top up $10 of cover, or file one test claim on the policy page.';
      default: return 'Make one qualifying action each week: a deposit, a swap, a vote, or one transaction in the protocol app.';
    }
  }
  function farmSteps(p) {
    var chain = chainOf(p), capital = capitalFor(p), hold = holdDaysFor(p.age_days), gas = gasFor(chain);
    return [
      'Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with $' + capital + ' plus gas money. Cost: ' + gas + ' for the first transaction. Time: 5 minutes.',
      actionFor(p, capital, chain) + ' Cost: $' + capital + ' of capital and ' + gas + '. Time: 15 minutes to set up.',
      weeklyFor(p) + ' Cost: about $2 of gas a week. Time: 10 minutes a week.',
      'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early. Cost: the $' + capital + ' stays in the position. Time: ' + hold + ' days.',
      "Each month, open " + p.name + "'s own points or rewards page from the link its app publishes and check whether your wallet qualifies. Cost: no fee to check, and never pay to claim. Time: 10 minutes a month.",
      "After 30 days, compare the protocol's TVL and 7-day growth with the board: if TVL has fallen by more than half, unwind half the position. Cost: about $2 of gas to unwind. Time: 10 minutes.",
      'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.'
    ];
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.selected) params.set('p', state.selected);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    var s = params.toString();
    history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || '') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if ((r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av = key === 'tvl' ? a.tvl_usd : key === 'growth' ? (a.change_7d || 0) : key === 'age' ? (a.age_days || 0) : a.implied_value_usd;
      var bv = key === 'tvl' ? b.tvl_usd : key === 'growth' ? (b.change_7d || 0) : key === 'age' ? (b.age_days || 0) : b.implied_value_usd;
      return state.dir * (av - bv);
    });
    return rows;
  }

  function render() {
    writeHash();
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var shell = el('div', { class: 'shell' });
    var top = el('div', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · radar-2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Floor ' + fmtUsd(DATA.floor_usd) }),
        el('span', { text: DATA.watchlist_size + ' on watchlist' }),
        el('span', { text: DATA.board_size + ' ranked' })));
    shell.appendChild(top);
    var lede = el('div', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }),
        el('p', { html: 'Every protocol below <b>records no token</b> in the sealed DefiLlama snapshot — never that it has none. The board ranks them by an implied value built only from that snapshot: TVL, seven-day growth, how long it has run with no token, and how many chains its TVL sits on.' })),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))));
    shell.appendChild(lede);
    var model = el('section', { class: 'model' },
      el('h2', { text: 'The model, in full' }),
      el('p', { html: 'implied = TVL × <code>0.25</code> × growth × maturity × breadth, where growth = 1 + clamp(7d change, −60%, +120%) × <code>0.5</code>, maturity = <code>0.6</code> to <code>1.0</code> over 1,095 days with no token, and breadth = 1 + <code>0.02</code> per extra chain (max five). The same function scores every row; no name is special-cased. Click any row to see its own arithmetic.' }));
    shell.appendChild(model);

    var categories = ['all'].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category; }).filter(Boolean))).sort());
    var chains = ['all'].concat(Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort());
    var controls = el('div', { class: 'controls' });
    var qInput = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search protocols' });
    qInput.addEventListener('input', function () { state.q = qInput.value; render(); });
    controls.appendChild(el('div', { class: 'field' }, el('label', { text: 'Search' }), qInput));
    var catSel = el('select', { 'aria-label': 'Category' });
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c === 'all' ? 'All categories' : c })); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; render(); });
    controls.appendChild(el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel));
    var chainSel = el('select', { 'aria-label': 'Chain' });
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c === 'all' ? 'All chains' : c })); });
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
    controls.appendChild(el('div', { class: 'field' }, el('label', { text: 'Chain' }), chainSel));
    var sortSel = el('select', { 'aria-label': 'Sort by' });
    [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age']].forEach(function (o) { sortSel.appendChild(el('option', { value: o[0], text: o[1] })); });
    sortSel.value = state.sort;
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    controls.appendChild(el('div', { class: 'field' }, el('label', { text: 'Sort by' }), sortSel));
    var tabs = el('div', { class: 'tabs' },
      el('button', { 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } }),
      el('button', { 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } }));
    controls.appendChild(tabs);
    shell.appendChild(controls);

    if (state.tab === 'live') {
      var livePanel = el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }));
      var lt = el('table', null);
      lt.appendChild(el('thead', null, el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: '7d' }))));
      var lb = el('tbody', null);
      DATA.live.forEach(function (r) {
        lb.appendChild(el('tr', null,
          el('td', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
          el('td', null, el('span', { class: 'tag', text: r.category || '—' })),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''), text: fmtPct(r.change_7d) })));
      });
      lt.appendChild(lb);
      livePanel.firstChild.appendChild(lt);
      shell.appendChild(livePanel);
      shell.appendChild(el('p', { class: 'note', text: 'Live-token protocols already trade, so the board shows the market\u2019s own value for them and never ranks them against the pre-token board.' }));
      app.appendChild(shell);
      return;
    }

    var rows = filteredRows();
    var panel = el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }));
    var table = el('table', null);
    table.appendChild(el('thead', null, el('tr', null,
      el('th', { class: 'num', text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: '7d' }),
      el('th', { class: 'num', text: 'Age' }), el('th', { class: 'num', text: 'Implied value' }))));
    var tbody = el('tbody', null);
    if (rows.length === 0) {
      tbody.appendChild(el('tr', null, el('td', { colspan: 8, class: 'empty', text: 'No protocols match this filter.' })));
    }
    rows.slice(0, 100).forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = r.slug; render(); } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
        el('td', null, el('span', { class: 'tag', text: r.category || '—' })),
        el('td', { text: (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.firstChild.appendChild(table);
    shell.appendChild(panel);
    var count = el('p', { class: 'note', text: rows.length + ' protocols match · showing first 100 · click a row for its detail view and farm plan' });
    shell.appendChild(count);

    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    if (selected) {
      var f = factorsOf(selected, DATA.model);
      var check = impliedOf(selected, DATA.model);
      var detail = el('section', { class: 'detail' },
        el('h2', { text: '#' + selected.rank + ' · ' + selected.name }),
        el('p', { class: 'sub', text: selected.slug + ' · ' + (selected.category || 'no category') + ' · ' + (selected.chains || []).join(', ') + ' · listed ' + (selected.listed_at || 'unknown') + ' · records no token' }),
        el('div', { class: 'detail-grid' },
          el('div', null,
            el('h3', { text: 'Model breakdown' }),
            el('div', { class: 'breakdown' },
              el('div', null, el('span', { text: 'TVL × 0.25 (base)' }), el('b', { text: fmtUsd(f.base) })),
              el('div', null, el('span', { text: 'Growth ' + fmtPct(f.growth) + ' → ×' + f.growthMult.toFixed(4) }), el('b', { text: '×' + f.growthMult.toFixed(4) })),
              el('div', null, el('span', { text: 'Maturity, ' + fmtAge(selected.age_days) + ' with no token' }), el('b', { text: '×' + f.maturity.toFixed(4) })),
              el('div', null, el('span', { text: 'Breadth, ' + (selected.chains || []).length + ' chain(s)' }), el('b', { text: '×' + f.breadth.toFixed(4) })),
              el('div', null, el('span', { text: 'Implied value (recomputed on this page)' }), el('b', { text: fmtUsd(check) })),
              el('div', null, el('span', { text: 'Implied value (board.json)' }), el('b', { text: fmtUsd(selected.implied_value_usd) })))),
          el('div', null,
            el('h3', { text: 'How to farm it — 7 steps' }),
            el('ol', { class: 'steps' }, farmSteps(selected).map(function (s) { return el('li', { text: s }); })))));
      shell.appendChild(detail);
    }
    app.appendChild(shell);
  }

  readHash();
  render();
})();
