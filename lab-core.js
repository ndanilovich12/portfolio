/* Analytics Lab core: data, statistics and charts.
   Plain JavaScript, no libraries. Used by index.html (preview) and lab.html (full tool). */
(function () {
  'use strict';
  var Lab = {};

  /* ---------- seeded random numbers (so every forecast run is repeatable) */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function gauss(r) {
    var u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  Lab.rng = mulberry32; Lab.hash = hash;

  /* ---------- formatting */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var fmt = Lab.fmt = {
    num: function (v, d) {
      if (v == null || !isFinite(v)) return '–';
      return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    },
    compact: function (v) {
      if (v == null || !isFinite(v)) return '–';
      var a = Math.abs(v);
      var z = function (x, d) { return x.toFixed(d).replace(/\.0$/, ''); };
      if (a >= 1e12) return z(v / 1e12, a >= 1e13 ? 1 : 2) + 'T';
      if (a >= 1e9) return z(v / 1e9, a >= 1e10 ? 0 : 1) + 'B';
      if (a >= 1e6) return z(v / 1e6, a >= 1e7 ? 0 : 1) + 'M';
      if (a >= 1e4) return z(v / 1e3, a >= 1e5 ? 0 : 1) + 'K';
      return fmt.num(v, a < 10 && a % 1 ? 2 : 0);
    },
    price: function (v) {
      if (v == null || !isFinite(v)) return '–';
      var a = Math.abs(v);
      return fmt.num(v, a >= 1000 ? 0 : a >= 1 ? 2 : 4);
    },
    money: function (v, compact) {
      if (v == null || !isFinite(v)) return '–';
      var s = v < 0 ? '-' : '';
      return s + '$' + (compact ? fmt.compact(Math.abs(v)) : fmt.num(Math.abs(v), Math.abs(v) < 100 ? 2 : 0));
    },
    pct: function (v, d, signed) {
      if (v == null || !isFinite(v)) return '–';
      var s = (v * 100).toFixed(d == null ? 1 : d) + '%';
      return signed && v > 0 ? '+' + s : s;
    },
    date: function (d) { return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); },
    monthLabel: function (y, m) { return MONTHS[m] + ' ’' + String(y).slice(2); }
  };

  /* ---------- statistics */
  var st = Lab.stats = {};
  st.mean = function (a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (a[i] != null) { s += a[i]; n++; } return n ? s / n : NaN; };
  st.std = function (a) {
    var m = st.mean(a), s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { s += (a[i] - m) * (a[i] - m); n++; }
    return n > 1 ? Math.sqrt(s / (n - 1)) : NaN;
  };
  st.returns = function (p) { var r = []; for (var i = 1; i < p.length; i++) r.push(p[i] / p[i - 1] - 1); return r; };
  st.sma = function (p, n) {
    var out = new Array(p.length).fill(null), s = 0;
    for (var i = 0; i < p.length; i++) { s += p[i]; if (i >= n) s -= p[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  };
  st.bollinger = function (p, n, k) {
    var mid = st.sma(p, n), lo = new Array(p.length).fill(null), hi = new Array(p.length).fill(null);
    for (var i = n - 1; i < p.length; i++) {
      var s = 0; for (var j = i - n + 1; j <= i; j++) s += (p[j] - mid[i]) * (p[j] - mid[i]);
      var sd = Math.sqrt(s / n); lo[i] = mid[i] - k * sd; hi[i] = mid[i] + k * sd;
    }
    return { mid: mid, lo: lo, hi: hi };
  };
  st.rsi = function (p, n) { /* Wilder's RSI */
    var out = new Array(p.length).fill(null); if (p.length <= n) return out;
    var g = 0, l = 0, i, d;
    for (i = 1; i <= n; i++) { d = p[i] - p[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (i = n + 1; i < p.length; i++) {
      d = p[i] - p[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  };
  st.maxDrawdown = function (p) {
    var peak = p[0], dd = 0, pi = 0, best = { dd: 0, peak: 0, trough: 0 };
    for (var i = 1; i < p.length; i++) {
      if (p[i] > peak) { peak = p[i]; pi = i; }
      dd = p[i] / peak - 1;
      if (dd < best.dd) best = { dd: dd, peak: pi, trough: i };
    }
    return best;
  };
  st.corr = function (a, b) {
    var n = Math.min(a.length, b.length), ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var sab = 0, saa = 0, sbb = 0;
    for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
  };
  st.beta = function (a, m) {
    var n = Math.min(a.length, m.length), ma = 0, mm = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mm += m[i]; } ma /= n; mm /= n;
    var cov = 0, vm = 0;
    for (i = 0; i < n; i++) { cov += (a[i] - ma) * (m[i] - mm); vm += (m[i] - mm) * (m[i] - mm); }
    return vm ? cov / vm : NaN;
  };
  st.linreg = function (y) { /* least squares on x = 0..n-1 */
    var n = y.length, sx = 0, sy = 0, sxy = 0, sxx = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += y[i]; sxy += i * y[i]; sxx += i * i; }
    var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), icpt = (sy - slope * sx) / n, res = 0;
    for (i = 0; i < n; i++) res += Math.pow(y[i] - (icpt + slope * i), 2);
    return { slope: slope, intercept: icpt, resid: Math.sqrt(res / Math.max(1, n - 2)) };
  };
  /* summary of one price window; ppy = trading periods per year */
  st.summary = function (p, ppy) {
    var r = st.returns(p), vol = st.std(r) * Math.sqrt(ppy), mean = st.mean(r) * ppy, dd = st.maxDrawdown(p);
    return {
      last: p[p.length - 1], ret: p[p.length - 1] / p[0] - 1, vol: vol, annRet: mean,
      rr: vol ? mean / vol : NaN, dd: dd, hi: Math.max.apply(null, p), lo: Math.min.apply(null, p),
      day: p.length > 1 ? p[p.length - 1] / p[p.length - 2] - 1 : 0
    };
  };

  /* ---------- real market snapshot (tech-data.js): seven big tech names and the Nasdaq-100 ETF */
  Lab.realMarket = function () {
    var R = window.LAB_REAL; if (!R || !R.c) return null;
    var d = new Date(R.start + 'T00:00:00Z'), dates = [new Date(d.getTime())], i;
    for (i = 0; i < R.gaps.length; i++) { d = new Date(d.getTime() + (+R.gaps.charAt(i)) * 864e5); dates.push(d); }
    var tok = R.c.split(' '), n = dates.length, series = {}, order = [];
    R.syms.forEach(function (s, k) {
      var close = []; for (var j = 0; j < n; j++) close.push((parseInt(tok[k * n + j], 36) + s.base) / 100);
      series[s.sym] = { sym: s.sym, name: s.name, sector: s.sector, color: s.color, close: close, volume: null, ppy: 252, unit: '$', dates: dates };
      order.push(s.sym);
    });
    return { dates: dates, series: series, order: order, index: R.index, simulated: false, real: true, asOf: dates[n - 1], source: R.source };
  };

  /* ---------- sample business data: real U.S. retail sales (retail-data.js) */
  Lab.sampleBusiness = function () {
    var R = window.LAB_RETAIL; if (!R) return { header: ['month', 'category', 'sales'], rows: [], name: 'No sample loaded', sample: true };
    var rows = [];
    R.months.forEach(function (m, i) {
      R.cats.forEach(function (c, k) { rows.push([m, c, String(R.v[k][i] * 1e6)]); });
    });
    return { header: ['month', 'category', 'sales'], rows: rows, name: R.name, source: R.source, sample: true, real: true };
  };

  /* ---------- CSV parsing and column typing */
  Lab.parseCSV = function (text) {
    text = String(text).replace(/^﻿/, '');
    var first = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
    var cand = [',', ';', '\t', '|'], delim = ',', best = 0;
    cand.forEach(function (c) { var k = first.split(c).length; if (k > best) { best = k; delim = c; } });
    var rows = [], row = [], cur = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') rows.push(row); }
    if (rows.length < 2) throw new Error('That file has no data rows. It needs a header row and at least one row under it.');
    var header = rows.shift().map(function (h, k) { return String(h).trim() || 'Column ' + (k + 1); });
    return { header: header, rows: rows };
  };
  Lab.parseNum = function (s) {
    if (s == null) return NaN;
    s = String(s).trim(); if (s === '') return NaN;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[$€£,\s%()]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    var v = parseFloat(s); return neg ? -v : v;
  };
  Lab.parseDate = function (s) {
    if (s == null) return null;
    s = String(s).trim(); var m;
    if ((m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(s))) return mk(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s))) return mk(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s)) { var t = Date.parse(s); if (!isNaN(t)) { var d = new Date(t); return mk(d.getFullYear(), d.getMonth() + 1, d.getDate()); } }
    return null;
    function mk(y, mo, da) {
      if (mo < 1 || mo > 12 || da < 1 || da > 31 || y < 1900 || y > 2200) return null;
      return new Date(Date.UTC(y, mo - 1, da));
    }
  };
  Lab.profile = function (data) {
    var n = data.rows.length, step = Math.max(1, Math.floor(n / 400));
    return data.header.map(function (name, c) {
      var seen = 0, num = 0, dat = 0, distinct = {}, dc = 0, money = false;
      for (var i = 0; i < n; i += step) {
        var v = data.rows[i][c]; if (v == null || String(v).trim() === '') continue;
        seen++;
        if (!isNaN(Lab.parseNum(v))) { num++; if (/[$€£]/.test(v)) money = true; }
        else if (Lab.parseDate(v)) dat++;
        if (dc <= 60 && !distinct[v]) { distinct[v] = 1; dc++; }
      }
      var type = !seen ? 'empty' : dat / seen >= 0.8 ? 'date' : num / seen >= 0.8 ? 'number' : dc <= 40 ? 'category' : 'text';
      if (type === 'number' && /revenue|sales|amount|total|price|cost|cogs|profit|spend|fee|paid/i.test(name)) money = true;
      return { name: name, index: c, type: type, distinct: dc, money: money };
    });
  };
  Lab.guessMap = function (cols) {
    function pick(type, re, fallback) {
      var c = cols.filter(function (x) { return x.type === type; });
      var hit = re ? c.filter(function (x) { return re.test(x.name); })[0] : null;
      return hit ? hit.index : (fallback !== false && c[0] ? c[0].index : -1);
    }
    var cost = pick('number', /cost|cogs|expense/i, false);
    var measure = pick('number', /revenue|sales|amount|total|net|gross/i);
    if (measure === cost) { var o = cols.filter(function (x) { return x.type === 'number' && x.index !== cost; })[0]; measure = o ? o.index : measure; }
    return { date: pick('date'), measure: measure, cost: cost, group: pick('category', /categor|product|type|segment|item|dept|service/i) };
  };

  /* ---------- business analysis: every figure here is a plain formula, shown next to the insight */
  function bigNum(a) { return a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : (a / 1e6).toFixed(1) + 'M'; }
  Lab.analyze = function (data, map, cols) {
    var isMoney = cols[map.measure] && cols[map.measure].money, f = function (v) { return isMoney ? (Math.abs(v) >= 1e8 ? '$' + (v < 0 ? '-' : '') + bigNum(Math.abs(v)) : fmt.money(v)) : fmt.num(v, Math.abs(v) < 100 && v % 1 ? 1 : 0); };
    var mName = cols[map.measure] ? cols[map.measure].name : 'value';
    var total = 0, costTotal = 0, n = 0, months = {}, groups = {}, days = {}, minD = null, maxD = null, skipped = 0;
    data.rows.forEach(function (r) {
      var v = Lab.parseNum(r[map.measure]); if (isNaN(v)) { skipped++; return; }
      var c = map.cost >= 0 ? Lab.parseNum(r[map.cost]) : NaN;
      total += v; n++; if (!isNaN(c)) costTotal += c;
      if (map.group >= 0) {
        var g = String(r[map.group] == null || r[map.group] === '' ? '(blank)' : r[map.group]).trim();
        var G = groups[g] || (groups[g] = { label: g, total: 0, cost: 0, n: 0, byMonth: {} });
        G.total += v; G.n++; if (!isNaN(c)) G.cost += c;
      }
      if (map.date >= 0) {
        var d = Lab.parseDate(r[map.date]); if (!d) return;
        if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d;
        var key = d.getUTCFullYear() * 12 + d.getUTCMonth();
        var M = months[key] || (months[key] = { key: key, total: 0, n: 0 }); M.total += v; M.n++;
        var dk = d.getTime(); days[dk] = (days[dk] || 0) + v;
        if (G) G.byMonth[key] = (G.byMonth[key] || 0) + v;
      }
    });
    var out = { total: total, n: n, avg: n ? total / n : NaN, f: f, isMoney: isMoney, measureName: mName, skipped: skipped, insights: [], months: [], groups: [], weekday: null, margin: null, minD: minD, maxD: maxD };
    if (map.cost >= 0 && total) out.margin = (total - costTotal) / total;

    /* groups */
    var gl = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.total - a.total; });
    gl.forEach(function (g) { g.share = total ? g.total / total : 0; g.margin = map.cost >= 0 && g.total ? (g.total - g.cost) / g.total : null; });
    out.groups = gl; out.groupName = map.group >= 0 ? cols[map.group].name : null;

    /* months */
    var keys = Object.keys(months).map(Number).sort(function (a, b) { return a - b; }), ml = [];
    if (keys.length) for (var k = keys[0]; k <= keys[keys.length - 1]; k++) {
      var M = months[k] || { key: k, total: 0, n: 0 };
      M.label = fmt.monthLabel(Math.floor(k / 12), k % 12); M.partial = false; ml.push(M);
    }
    var monthly = Object.keys(days).length <= keys.length;
    out.monthly = monthly;
    if (ml.length && !monthly) {
      var lastDay = new Date(Date.UTC(maxD.getUTCFullYear(), maxD.getUTCMonth() + 1, 0)).getUTCDate();
      if (maxD.getUTCDate() < lastDay) ml[ml.length - 1].partial = true;
      if (minD.getUTCDate() > 1 && ml.length > 1) ml[0].partial = true;
    }
    out.months = ml;
    var full = ml.filter(function (m) { return !m.partial; });
    out.fullMonths = full;

    /* projection: straight-line trend through the last six full months */
    out.projection = [];
    if (full.length >= 4) {
      var win = full.slice(-6), reg = st.linreg(win.map(function (m) { return m.total; }));
      for (var h = 1; h <= 3; h++) {
        var pk = win[win.length - 1].key + h, pv = Math.max(0, reg.intercept + reg.slope * (win.length - 1 + h));
        out.projection.push({ key: pk, label: fmt.monthLabel(Math.floor(pk / 12), pk % 12), value: pv, lo: Math.max(0, pv - reg.resid), hi: pv + reg.resid });
      }
      out.reg = reg; out.regN = win.length;
    }

    /* weekday pattern: average per calendar day */
    var dk = Object.keys(days);
    if (dk.length >= 14 && !monthly) {
      var sums = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
      dk.forEach(function (t) { var w = new Date(+t).getUTCDay(); sums[w] += days[t]; cnt[w]++; });
      out.weekday = [1, 2, 3, 4, 5, 6, 0].map(function (w) { return { label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w], value: cnt[w] ? sums[w] / cnt[w] : 0 }; });
    }

    /* ---- insights (rules, not a language model) */
    var ins = out.insights;
    if (full.length >= 2) {
      var a = full[full.length - 1], b = full[full.length - 2], ch = b.total ? a.total / b.total - 1 : NaN;
      if (isFinite(ch)) ins.push({
        tone: ch >= 0 ? 'up' : 'down',
        text: a.label + ' came in at ' + f(a.total) + ', ' + (ch >= 0 ? 'up ' : 'down ') + fmt.pct(Math.abs(ch)) + ' from ' + b.label + '.',
        math: '(' + f(a.total) + ' − ' + f(b.total) + ') ÷ ' + f(b.total) + ' = ' + fmt.pct(ch, 1, true)
      });
    }
    if (full.length >= 5) {
      var top = full.slice().sort(function (x, y) { return y.total - x.total; })[0], av = st.mean(full.map(function (m) { return m.total; }));
      ins.push({ tone: 'note', text: top.label + ' was the best full month: ' + f(top.total) + ', ' + fmt.pct(top.total / av - 1) + ' above the monthly average.', math: f(top.total) + ' ÷ average of ' + full.length + ' full months (' + f(av) + ') − 1' });
    }
    if (gl.length >= 2) {
      var cum = 0, k80 = 0; for (var gi = 0; gi < gl.length; gi++) { cum += gl[gi].share; k80++; if (cum >= 0.8) break; }
      ins.push({ tone: 'note', text: gl[0].label + ' is the biggest ' + out.groupName + ' at ' + fmt.pct(gl[0].share, 0) + ' of ' + mName + '.' + (k80 > 1 && k80 < gl.length ? ' The top ' + k80 + ' of ' + gl.length + ' make up ' + fmt.pct(cum, 0) + '.' : ''), math: f(gl[0].total) + ' ÷ ' + f(total) + ' = ' + fmt.pct(gl[0].share) });
    }
    if (gl.length >= 2 && full.length >= 6) {
      var r3 = full.slice(-3).map(function (m) { return m.key; }), p3 = full.slice(-6, -3).map(function (m) { return m.key; }), movers = [];
      gl.forEach(function (g) {
        var now = 0, was = 0; r3.forEach(function (k) { now += g.byMonth[k] || 0; }); p3.forEach(function (k) { was += g.byMonth[k] || 0; });
        if (was > 0 && g.share >= 0.03) movers.push({ g: g, ch: now / was - 1, now: now, was: was });
      });
      movers.sort(function (x, y) { return y.ch - x.ch; });
      if (movers.length) {
        var up = movers[0], dn = movers[movers.length - 1];
        if (up.ch > 0.05) ins.push({ tone: 'up', text: up.g.label + ' is growing fastest: ' + fmt.pct(up.ch, 0, true) + ' over the last three full months compared with the three before.', math: f(up.now) + ' ÷ ' + f(up.was) + ' − 1 = ' + fmt.pct(up.ch, 1, true) });
        if (dn.ch < -0.05 && dn !== up) ins.push({ tone: 'down', text: dn.g.label + ' is slipping: ' + fmt.pct(dn.ch, 0, true) + ' over the same stretch.', math: f(dn.now) + ' ÷ ' + f(dn.was) + ' − 1 = ' + fmt.pct(dn.ch, 1, true) });
      }
    }
    if (out.weekday) {
      var ws = out.weekday.slice().sort(function (x, y) { return y.value - x.value; }), hiD = ws[0], loD = ws[ws.length - 1];
      if (loD.value > 0 && hiD.value / loD.value > 1.25) ins.push({ tone: 'note', text: hiD.label + ' is the strongest day, averaging ' + f(hiD.value) + '. That is ' + (hiD.value / loD.value).toFixed(1) + '× a typical ' + loD.label + '.', math: 'average per ' + hiD.label + ' ' + f(hiD.value) + ' ÷ average per ' + loD.label + ' ' + f(loD.value) });
    }
    if (out.margin != null) {
      var mg = gl.filter(function (g) { return g.margin != null && g.share >= 0.03; }).sort(function (x, y) { return x.margin - y.margin; });
      var t = 'Gross margin is ' + fmt.pct(out.margin) + ' overall.';
      if (mg.length >= 2) t += ' ' + mg[0].label + ' is the thinnest at ' + fmt.pct(mg[0].margin) + ', ' + mg[mg.length - 1].label + ' the richest at ' + fmt.pct(mg[mg.length - 1].margin) + '.';
      ins.push({ tone: 'note', text: t, math: '(' + f(total) + ' − ' + f(costTotal) + ' cost) ÷ ' + f(total) + ' = ' + fmt.pct(out.margin) });
    }
    if (out.projection.length) {
      var p = out.projection[0];
      ins.push({ tone: 'proj', text: 'If the recent trend holds, ' + p.label + ' lands near ' + f(p.value) + ' (roughly ' + f(p.lo) + ' to ' + f(p.hi) + ').', math: 'straight line through the last ' + out.regN + ' full months: ' + (out.reg.slope >= 0 ? '+' : '−') + f(Math.abs(out.reg.slope)) + ' a month, typical miss ±' + f(out.reg.resid) });
    }
    return out;
  };

  /* ---------- year-ahead simulation
     Each run builds one possible future by replaying the stock's own real daily moves in random
     five-day chunks (so calm and wild stretches stay together), starting from the latest price.
     Drift is a blend of the stock's own trend (capped) and the long-run market average scaled by beta.
     Swings start at the recent volatility level and fade back to normal. */
  Lab.forecast = function (close, o) {
    o = o || {};
    var steps = o.steps || 252, runs = o.runs || 300, ppy = o.ppy || 252, rnd = mulberry32(o.seed || 1), block = 5;
    var ret = st.returns(close), n = ret.length, mean = st.mean(ret), sd = st.std(ret), s0 = close[close.length - 1];
    var shocks = ret.map(function (r) { return r - mean; });
    var own = Math.pow(s0 / close[0], ppy / n) - 1, ownC = Math.max(-0.25, Math.min(0.35, own));
    var beta = o.beta == null || !isFinite(o.beta) ? 1 : Math.max(0.5, Math.min(2, o.beta)), mkt = 0.07 * beta;
    var drift = 0.5 * ownC + 0.5 * mkt, dDaily = Math.pow(1 + drift, 1 / ppy) - 1;
    var recent = st.std(ret.slice(-30)), k0 = Math.max(0.6, Math.min(1.8, recent / (sd || 1)));
    var paths = [], ends = [], lows = [], highs = [], dds = [], i, t, b;
    for (i = 0; i < runs; i++) {
      var p = new Float32Array(steps + 1), lo = s0, hi = s0, peak = s0, dd = 0; p[0] = s0; t = 1;
      while (t <= steps) {
        var at = Math.floor(rnd() * (n - block + 1));
        for (b = 0; b < block && t <= steps; b++, t++) {
          var k = 1 + (k0 - 1) * Math.pow(0.5, t / 60), v = p[t - 1] * Math.max(0.05, 1 + dDaily + shocks[at + b] * k);
          p[t] = v; if (v < lo) lo = v; if (v > hi) hi = v; if (v > peak) peak = v; else if (v / peak - 1 < dd) dd = v / peak - 1;
        }
      }
      paths.push(p); ends.push(p[steps]); lows.push(lo); highs.push(hi); dds.push(dd);
    }
    function q(sorted, f) { var x = (sorted.length - 1) * f, a = Math.floor(x), c = Math.min(sorted.length - 1, a + 1); return sorted[a] + (sorted[c] - sorted[a]) * (x - a); }
    var bands = { p1: [], p5: [], p25: [], p50: [], p75: [], p95: [], p99: [], up: [] }, col = new Float64Array(runs);
    for (t = 0; t <= steps; t++) {
      var above = 0; for (i = 0; i < runs; i++) { col[i] = paths[i][t]; if (col[i] > s0) above++; }
      var srt = Array.prototype.slice.call(col).sort(function (x, y) { return x - y; });
      bands.p1.push(q(srt, 0.01)); bands.p5.push(q(srt, 0.05)); bands.p25.push(q(srt, 0.25)); bands.p50.push(q(srt, 0.5)); bands.p75.push(q(srt, 0.75)); bands.p95.push(q(srt, 0.95)); bands.p99.push(q(srt, 0.99)); bands.up.push(above / runs);
    }
    var se = ends.slice().sort(function (x, y) { return x - y; });
    function frac(arr, fn) { var c = 0; for (var j = 0; j < arr.length; j++) if (fn(arr[j])) c++; return c / arr.length; }
    return {
      s0: s0, steps: steps, runs: runs, paths: paths, ends: ends, bands: bands, quantile: q,
      stats: {
        median: q(se, 0.5), mean: st.mean(ends), p5: q(se, 0.05), p25: q(se, 0.25), p75: q(se, 0.75), p95: q(se, 0.95),
        pUp: frac(ends, function (e) { return e > s0; }), pUp20: frac(ends, function (e) { return e >= s0 * 1.2; }), pDn20: frac(ends, function (e) { return e <= s0 * 0.8; }),
        pDip20: frac(lows, function (l) { return l <= s0 * 0.8; }), pPeak20: frac(highs, function (h) { return h >= s0 * 1.2; }),
        medDD: q(dds.slice().sort(function (x, y) { return x - y; }), 0.5)
      },
      model: { own: own, ownC: ownC, beta: beta, mkt: mkt, drift: drift, sd: sd, vol: sd * Math.sqrt(ppy), recentVol: recent * Math.sqrt(ppy), k0: k0, days: n, block: block }
    };
  };
  /* the next n weekdays after a date */
  Lab.futureDates = function (last, n) {
    var out = [], d = new Date(last.getTime());
    while (out.length < n) { d = new Date(d.getTime() + 864e5); var wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d); }
    return out;
  };

  /* ---------- charts (SVG, one y-axis each, hover on every chart) */
  var css = '' +
    '.lc{position:relative;width:100%}.lc svg{display:block;width:100%;height:auto;overflow:visible}' +
    '.lc text{font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:10.5px;fill:var(--muted,#5d6878);font-variant-numeric:tabular-nums}' +
    '.lc .grid{stroke:var(--line,#d3dbe6);stroke-width:1;stroke-dasharray:2 5}.lc .axis{stroke:var(--line-strong,#aeb9c8);stroke-width:1}' +
    '.lc .ref{stroke:var(--muted,#5d6878);stroke-width:1;opacity:.55}.lc .ln{fill:none;stroke-linejoin:round;stroke-linecap:round}' +
    '.lc .xh{stroke:var(--ink,#0a1e3f);stroke-width:1;opacity:.5}.lc .endl{fill:var(--ink,#0a1e3f);font-weight:600}' +
    '.lc .tagt{fill:#fff;font-weight:600;font-size:11px}.lc .yh{stroke:var(--ink,#0a1e3f);stroke-width:1;opacity:.28;stroke-dasharray:3 4}' +
    '@keyframes lc-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}@keyframes lc-fade{from{opacity:0}to{opacity:1}}@keyframes lc-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes lc-ping{0%{r:4;opacity:.55}100%{r:15;opacity:0}}' +
    '.lc .anim .ln{stroke-dasharray:1;stroke-dashoffset:1;animation:lc-draw .95s cubic-bezier(.3,.1,.2,1) forwards}.lc .anim .ar,.lc .anim .late{opacity:0;animation:lc-fade .6s .55s ease-out forwards}.lc .anim .bar{transform-box:fill-box;transform-origin:50% 100%;animation:lc-rise .5s cubic-bezier(.2,.7,.2,1) both}' +
    '.lc .ping{fill:none;stroke-width:2;animation:lc-ping 1.8s ease-out infinite}' +
    '@media (prefers-reduced-motion:reduce){.lc .anim .ln,.lc .anim .ar,.lc .anim .late,.lc .anim .bar,.lc .ping{animation:none;stroke-dashoffset:0;opacity:1}.lc .ping{display:none}}' +
    '.lc .col{transition:opacity .12s}.lc .hit:hover + .col, .lc .col.on{opacity:.78}' +
    '.lab-tip{position:fixed;z-index:60;pointer-events:none;background:var(--ink,#0a1e3f);color:#fff;border-radius:8px;padding:8px 10px;font:500 12px/1.35 var(--body,system-ui,sans-serif);box-shadow:0 8px 24px rgba(10,30,63,.22);max-width:260px;opacity:0;transition:opacity .08s}' +
    '.lab-tip.on{opacity:1}.lab-tip .tt{font:500 10.5px var(--mono,ui-monospace,monospace);opacity:.72;margin-bottom:4px;letter-spacing:.02em}' +
    '.lab-tip .tr{display:flex;align-items:center;gap:8px;justify-content:space-between}.lab-tip .tr b{font-weight:700;font-variant-numeric:tabular-nums}' +
    '.lab-tip .tk{display:inline-block;width:12px;height:0;border-top:2.5px solid;border-radius:2px;margin-right:6px;vertical-align:middle}.lab-tip .tn{opacity:.82}' +
    '.lc-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 8px;font:500 12px var(--body,system-ui,sans-serif);color:var(--muted,#5d6878)}' +
    '.lc-legend span{display:inline-flex;align-items:center;gap:6px}.lc-legend i{display:inline-block;width:14px;height:0;border-top:2.5px solid;border-radius:2px}.lc-legend i.box{height:10px;width:10px;border:0;border-radius:2px}' +
    '.hb{display:grid;grid-template-columns:minmax(72px,max-content) 1fr max-content;gap:8px 12px;align-items:center;font:500 13px var(--body,system-ui,sans-serif)}' +
    '.hb .hl{color:var(--ink,#0a1e3f);overflow-wrap:anywhere}.hb .ht{height:14px;position:relative}.hb .hf{position:absolute;inset:0 auto 0 0;border-radius:0 4px 4px 0;min-width:2px;transition:opacity .12s}' +
    '.hb .hr:hover .hf{opacity:.78}.hb .hv{font-variant-numeric:tabular-nums;color:var(--ink,#0a1e3f);font-weight:650;text-align:right}.hb .hs{color:var(--muted,#5d6878);font-weight:500;margin-left:6px}.hb .hr{display:contents}';
  function injectCSS() {
    if (document.getElementById('lab-core-css')) return;
    var s = document.createElement('style'); s.id = 'lab-core-css'; s.textContent = css; document.head.appendChild(s);
  }
  var tipEl;
  function tip() {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'lab-tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(x, y, title, rows) {
    var t = tip(); t.textContent = '';
    if (title) { var h = document.createElement('div'); h.className = 'tt'; h.textContent = title; t.appendChild(h); }
    rows.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'tr';
      var l = document.createElement('span'); l.className = 'tn';
      if (r.color) { var k = document.createElement('i'); k.className = 'tk'; k.style.borderColor = r.color; l.appendChild(k); }
      l.appendChild(document.createTextNode(r.label));
      var v = document.createElement('b'); v.textContent = r.value;
      row.appendChild(l); row.appendChild(v); t.appendChild(row);
    });
    t.classList.add('on');
    var w = t.offsetWidth, hh = t.offsetHeight, vw = document.documentElement.clientWidth;
    var left = x + 14; if (left + w > vw - 8) left = x - w - 14; if (left < 8) left = 8;
    var top = y - hh - 12; if (top < 8) top = y + 16;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('on'); }
  Lab.hideTip = hideTip; Lab.showTip = showTip; Lab.injectCSS = injectCSS; Lab.niceTicks = niceTicks;

  function niceTicks(lo, hi, count) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / count))), err = span / count / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var t = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + step * 1e-6; v += step) t.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    return t;
  }
  /* one label style per axis: if any tick needs a K, they all get one */
  function axisLabels(ticks, yFmt) {
    var labs = ticks.map(yFmt);
    if (!labs.some(function (l) { return /\dK$/.test(l); }) || labs.some(function (l) { return /[MB]$/.test(l); })) return labs;
    var pre = /^\$/.test(yFmt(1)) ? '$' : '';
    return ticks.map(function (t) { return t === 0 ? pre + '0' : pre + String(Math.round(t / 100) / 10) + 'K'; });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dateTicks(dates, iw) {
    var n = dates.length, out = [], i, spanDays = (dates[n - 1] - dates[0]) / 864e5;
    if (spanDays <= 70) {
      for (i = 0; i < n; i++) if (i === 0 || dates[i].getUTCDay() < dates[i - 1].getUTCDay()) out.push({ i: i, label: MONTHS[dates[i].getUTCMonth()] + ' ' + dates[i].getUTCDate() });
    } else {
      for (i = 1; i < n; i++) if (dates[i].getUTCMonth() !== dates[i - 1].getUTCMonth()) {
        var m = dates[i].getUTCMonth();
        out.push({ i: i, label: m === 0 ? MONTHS[m] + ' ’' + String(dates[i].getUTCFullYear()).slice(2) : MONTHS[m] });
      }
    }
    var maxN = Math.max(2, Math.floor(iw / 58)), stepN = Math.ceil(out.length / maxN);
    return out.filter(function (_, k) { return k % stepN === 0; });
  }
  function legend(el, items) {
    if (!items || items.length < 2) return;
    var l = document.createElement('div'); l.className = 'lc-legend';
    items.forEach(function (it) {
      var s = document.createElement('span'), k = document.createElement('i');
      if (it.box) { k.className = 'box'; k.style.background = it.color; } else k.style.borderColor = it.color;
      s.appendChild(k); s.appendChild(document.createTextNode(it.name)); l.appendChild(s);
    });
    el.appendChild(l);
  }

  /* line chart: o = {dates, series:[{name,color,values,width,area}], band:{lo,hi,color}, height, yFmt, refs:[{y,label}], yDomain, endLabels, legend, bars:{values,color}, label} */
  var chartN = 0;
  Lab.lineChart = function (el, o) {
    injectCSS(); el.textContent = ''; el.classList.add('lc');
    if (o.legend !== false) legend(el, o.series.map(function (s) { return { name: s.name, color: s.color }; }).concat(o.band ? [{ name: o.band.name, color: o.band.color, box: true }] : []));
    var W = Math.max(260, Math.round(el.clientWidth || 600)), H = o.height || 280, n = o.dates.length;
    var yFmt = o.yFmt || fmt.price, lo = Infinity, hi = -Infinity;
    function scan(v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    o.series.forEach(function (s) { s.values.forEach(scan); });
    if (o.band) { o.band.lo.forEach(scan); o.band.hi.forEach(scan); }
    if (o.bars) { lo = 0; o.bars.values.forEach(scan); }
    if (o.yDomain) { lo = o.yDomain[0]; hi = o.yDomain[1]; }
    else if (!o.bars) { var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad; }
    else hi *= 1.08;
    var ticks = o.yTicks || niceTicks(lo, hi, H < 140 ? 2 : 4);
    var tipFmt = yFmt;
    if (!o.yFmt && ticks.length > 1) { var stp = Math.abs(ticks[1] - ticks[0]), dec = stp >= 1 ? 0 : stp >= 0.1 ? 1 : stp >= 0.01 ? 2 : 4; yFmt = function (v) { return fmt.num(v, dec); }; }
    var labs = axisLabels(ticks, yFmt), lw = 0; labs.forEach(function (t) { lw = Math.max(lw, t.length); });
    var tagTxt = o.lastTag && o.series[0] && o.series[0].values[n - 1] != null ? (o.series[0].fmt || tipFmt)(o.series[0].values[n - 1]) : null;
    var m = { t: 10, r: o.endLabels ? 58 : tagTxt ? Math.max(52, tagTxt.length * 7 + 22) : 14, b: o.noX ? 8 : 24, l: Math.max(34, lw * 6.6 + 12) };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var X = function (i) { return m.l + (n <= 1 ? iw / 2 : i / (n - 1) * iw); };
    var Y = function (v) { return m.t + (1 - (v - lo) / (hi - lo || 1)) * ih; };
    var uid = 'lc' + (++chartN), s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '"' + (o.animate ? ' class="anim"' : '') + '><defs>';
    o.series.forEach(function (sr, k) { if (sr.area) s += '<linearGradient id="' + uid + 'a' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:' + (sr.areaColor || sr.color) + ';stop-opacity:' + (sr.areaTop || 0.2) + '"/><stop offset="1" style="stop-color:' + (sr.areaColor || sr.color) + ';stop-opacity:0"/></linearGradient>'; });
    s += '</defs>';
    ticks.forEach(function (t, ti) {
      var y = Math.round(Y(t)) + 0.5;
      s += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (m.l - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(labs[ti]) + '</text>';
    });
    if (!o.noX) dateTicks(o.dates, iw).forEach(function (t) { s += '<text x="' + X(t.i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(t.label) + '</text>'; });
    (o.refs || []).forEach(function (r) {
      var y = Math.round(Y(r.y)) + 0.5;
      s += '<line class="ref" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/>' + (r.label ? '<text x="' + (W - m.r - 4) + '" y="' + (y - 4) + '" text-anchor="end">' + esc(r.label) + '</text>' : '');
    });
    if (o.bars) {
      var bw = Math.max(1, Math.min(8, iw / n - 1)), y0 = Y(0);
      o.bars.values.forEach(function (v, i) { if (v != null) s += '<rect class="bar" x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y0 - Y(v)).toFixed(1) + '" rx="' + Math.min(1.5, bw / 2).toFixed(1) + '" fill="' + (o.bars.colors ? o.bars.colors[i] : o.bars.color) + '" opacity=".6"' + (o.animate ? ' style="animation-delay:' + Math.round(i / n * 500) + 'ms"' : '') + '/>'; });
    }
    function path(vals) {
      var d = '', pen = false;
      for (var i = 0; i < n; i++) { var v = vals[i]; if (v == null || !isFinite(v)) { pen = false; continue; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }
      return d;
    }
    if (o.band) {
      var up = '', dn = '', started = false, i;
      for (i = 0; i < n; i++) if (o.band.hi[i] != null) { up += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(o.band.hi[i]).toFixed(1); started = true; }
      for (i = n - 1; i >= 0; i--) if (o.band.lo[i] != null) dn += 'L' + X(i).toFixed(1) + ' ' + Y(o.band.lo[i]).toFixed(1);
      if (up) s += '<path class="ar" d="' + up + dn + 'Z" fill="' + o.band.color + '" fill-opacity=".14"/>';
    }
    o.series.forEach(function (sr) {
      if (sr.area) {
        var first = sr.values.findIndex(function (v) { return v != null; });
        if (first >= 0) s += '<path class="ar" d="' + path(sr.values) + 'L' + X(n - 1).toFixed(1) + ' ' + (m.t + ih) + 'L' + X(first).toFixed(1) + ' ' + (m.t + ih) + 'Z" fill="url(#' + uid + 'a' + o.series.indexOf(sr) + ')"/>';
      }
    });
    o.series.forEach(function (sr) {
      s += '<path class="ln" pathLength="1" d="' + path(sr.values) + '" stroke="' + sr.color + '" stroke-width="' + (sr.width || 2) + '"' + '/>';
    });
    /* event markers: o.marks = [{i, v, color, label, tip}] */
    var markAt = {};
    (o.marks || []).forEach(function (mk) {
      if (mk.v == null || mk.i < 0 || mk.i >= n) return;
      markAt[mk.i] = mk;
      var mx = X(mk.i), my = Y(mk.v), up = mk.dir !== 'down', ly = up ? my - 11 : my + 18;
      s += '<circle class="late" cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="5.5" fill="' + mk.color + '" stroke="var(--surface,#fff)" stroke-width="2"/>';
      if (mk.label) s += '<text class="late" x="' + mx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" style="font-weight:600;fill:' + mk.color + '">' + esc(mk.label) + '</text>';
    });
    /* end markers and labels */
    var ends = [];
    o.series.forEach(function (sr) {
      var v = sr.values[n - 1]; if (v == null) return;
      if (!sr.noDot) s += (o.pulse && sr === o.series[0] ? '<circle class="ping" cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4" stroke="' + sr.color + '"/>' : '') + '<circle class="late" cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4" fill="' + sr.color + '" stroke="var(--surface,#fff)" stroke-width="2"/>';
      if (o.endLabels) ends.push({ y: Y(v), text: sr.short || sr.name });
    });
    if (ends.length) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 12) ends[e].y = ends[e - 1].y + 12;
      ends.forEach(function (en) { s += '<text class="endl" x="' + (W - m.r + 9) + '" y="' + (en.y + 3.5).toFixed(1) + '">' + esc(en.text) + '</text>'; });
    }
    if (tagTxt) {
      var ty = Math.max(m.t + 10, Math.min(m.t + ih - 10, Y(o.series[0].values[n - 1]))), tw = tagTxt.length * 7 + 12;
      s += '<g class="late"><rect x="' + (W - m.r + 7) + '" y="' + (ty - 10).toFixed(1) + '" width="' + tw + '" height="20" rx="5" fill="' + o.series[0].color + '"/><text class="tagt" x="' + (W - m.r + 7 + tw / 2) + '" y="' + (ty + 4).toFixed(1) + '" text-anchor="middle">' + esc(tagTxt) + '</text></g>';
    }
    s += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (m.t + ih + 0.5) + '" y2="' + (m.t + ih + 0.5) + '"/>';
    s += '<g class="hov" style="display:none"><line class="xh" y1="' + m.t + '" y2="' + (m.t + ih) + '"/><line class="yh" x1="' + m.l + '" x2="' + (W - m.r) + '"/>';
    o.series.forEach(function (sr, k) { s += '<circle data-k="' + k + '" r="4" fill="' + sr.color + '" stroke="var(--surface,#fff)" stroke-width="2"/>'; });
    s += '</g><rect class="cap" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent" tabindex="0" aria-label="' + esc((o.label || 'Chart') + '. Use left and right arrow keys to read values.') + '"/></svg>';
    var holder = document.createElement('div'); holder.innerHTML = s; var svg = holder.firstChild; el.appendChild(svg);
    var hov = svg.querySelector('.hov'), xh = hov.querySelector('.xh'), yh = hov.querySelector('.yh'), dots = hov.querySelectorAll('circle'), cap = svg.querySelector('.cap'), cur = n - 1;
    function at(i, cx, cy) {
      i = Math.max(0, Math.min(n - 1, i)); cur = i;
      hov.style.display = ''; xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i));
      var v0 = o.series[0] ? o.series[0].values[i] : null; if (v0 == null) yh.style.display = 'none'; else { yh.style.display = ''; yh.setAttribute('y1', Y(v0)); yh.setAttribute('y2', Y(v0)); }
      var rows = [];
      o.series.forEach(function (sr, k) {
        var v = sr.values[i];
        if (v == null) dots[k].style.display = 'none'; else { dots[k].style.display = ''; dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(v)); rows.push({ color: sr.color, label: sr.name, value: (sr.fmt || tipFmt)(v) }); }
      });
      if (markAt[i]) rows.push({ color: markAt[i].color, label: markAt[i].tipLabel || 'Move', value: markAt[i].tip });
      if (o.bars && o.bars.values[i] != null) rows.push({ label: o.bars.name, value: (o.bars.fmt || yFmt)(o.bars.values[i]) });
      if (o.band && o.band.hi[i] != null) rows.push({ label: o.band.name, value: tipFmt(o.band.lo[i]) + ' – ' + tipFmt(o.band.hi[i]) });
      var bb = svg.getBoundingClientRect(), sx = bb.width / W;
      showTip(cx != null ? cx : bb.left + X(i) * sx, cy != null ? cy : bb.top + m.t * sx + 20, fmt.date(o.dates[i]), rows);
      if (o.onHover) o.onHover(i);
    }
    cap.addEventListener('pointermove', function (ev) {
      var bb = svg.getBoundingClientRect(), px = (ev.clientX - bb.left) / bb.width * W;
      at(Math.round((px - m.l) / iw * (n - 1)), ev.clientX, ev.clientY);
    });
    function leave() { hov.style.display = 'none'; hideTip(); if (o.onHover) o.onHover(null); }
    cap.addEventListener('pointerleave', leave); cap.addEventListener('blur', leave);
    cap.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { at(cur - 1); ev.preventDefault(); } else if (ev.key === 'ArrowRight') { at(cur + 1); ev.preventDefault(); } else if (ev.key === 'Escape') leave();
    });
    cap.addEventListener('focus', function () { at(cur); });
  };

  /* column chart: o = {cats:[label], values:[n|null], under:[n|null], kinds:['a'|'p'], colors:{a,p,u}, line:{values,name,color}, height, yFmt, legend:[...], label, tipRows:fn(i)} */
  Lab.colChart = function (el, o) {
    injectCSS(); el.textContent = ''; el.classList.add('lc');
    if (o.legend) legend(el, o.legend);
    var W = Math.max(260, Math.round(el.clientWidth || 600)), H = o.height || 260, n = o.cats.length, yFmt = o.yFmt || fmt.compact;
    var hi = 0; (o.values || []).concat(o.under || [], o.line ? o.line.values : []).forEach(function (v) { if (v != null && v > hi) hi = v; }); hi = hi * 1.1 || 1;
    var ticks = niceTicks(0, hi, 4), labs = axisLabels(ticks, yFmt), lw = 0; labs.forEach(function (t) { lw = Math.max(lw, t.length); });
    var m = { t: 18, r: 10, b: 24, l: Math.max(34, lw * 6.6 + 12) }, iw = W - m.l - m.r, ih = H - m.t - m.b, band = iw / n, bw = Math.min(24, Math.max(3, band - 4));
    var X = function (i) { return m.l + band * (i + 0.5); }, Y = function (v) { return m.t + (1 - v / hi) * ih; }, y0 = m.t + ih;
    function col(i, v, fill, cls) {
      var x = X(i) - bw / 2, y = Y(v), h = y0 - y, r = Math.min(4, bw / 2, h);
      if (h <= 0.5) return '';
      return '<path class="' + cls + '" d="M' + x.toFixed(1) + ' ' + y0 + 'V' + (y + r).toFixed(1) + 'q0 ' + (-r) + ' ' + r + ' ' + (-r) + 'h' + (bw - 2 * r).toFixed(1) + 'q' + r + ' 0 ' + r + ' ' + r + 'V' + y0 + 'Z" fill="' + fill + '"/>';
    }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">';
    ticks.forEach(function (t, ti) { var y = Math.round(Y(t)) + 0.5; s += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (m.l - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(labs[ti]) + '</text>'; });
    var every = Math.ceil(n / Math.max(2, Math.floor(iw / 46)));
    o.cats.forEach(function (c, i) { if (i % every === 0 || i === n - 1 && (n - 1) % every >= every / 2) s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(c) + '</text>'; });
    var maxI = -1, maxV = -1;
    for (var i = 0; i < n; i++) {
      var u = o.under && o.under[i], v = o.values[i];
      s += '<g>';
      if (u != null) s += col(i, u, o.colors.u, 'col');
      if (v != null) { s += col(i, v, o.kinds && o.kinds[i] === 'p' ? o.colors.p : o.colors.a, 'col'); if ((!o.kinds || o.kinds[i] === 'a') && v > maxV) { maxV = v; maxI = i; } }
      s += '</g>';
    }
    if (maxI >= 0) s += '<text class="endl" x="' + X(maxI).toFixed(1) + '" y="' + (Y(maxV) - 6).toFixed(1) + '" text-anchor="middle">' + esc(yFmt(maxV)) + '</text>';
    if (o.line) {
      var d = '', pen = false;
      o.line.values.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      s += '<path class="ln" d="' + d + '" stroke="' + o.line.color + '" stroke-width="2"/>';
    }
    s += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (y0 + 0.5) + '" y2="' + (y0 + 0.5) + '"/>';
    for (i = 0; i < n; i++) s += '<rect class="hit" data-i="' + i + '" x="' + (m.l + band * i).toFixed(1) + '" y="' + m.t + '" width="' + band.toFixed(1) + '" height="' + ih + '" fill="transparent" tabindex="0" aria-label="' + esc(o.cats[i]) + '"/>';
    s += '</svg>';
    var holder = document.createElement('div'); holder.innerHTML = s; var svg = holder.firstChild; el.appendChild(svg);
    var groups = svg.querySelectorAll('g');
    function on(i, x, y) {
      groups.forEach(function (g, k) { g.style.opacity = k === i ? '.78' : ''; });
      var bb = svg.getBoundingClientRect(), sx = bb.width / W;
      showTip(x != null ? x : bb.left + X(i) * sx, y != null ? y : bb.top + 30, o.cats[i], o.tipRows(i));
    }
    function off() { groups.forEach(function (g) { g.style.opacity = ''; }); hideTip(); }
    svg.querySelectorAll('.hit').forEach(function (h) {
      var i = +h.getAttribute('data-i');
      h.addEventListener('pointermove', function (ev) { on(i, ev.clientX, ev.clientY); });
      h.addEventListener('pointerleave', off); h.addEventListener('focus', function () { on(i); }); h.addEventListener('blur', off);
    });
  };

  /* horizontal ranked bars in plain HTML: rows = [{label, value, sub}] */
  Lab.hbar = function (el, rows, o) {
    injectCSS(); el.textContent = ''; el.className = (el.className.replace(/\bhb\b/, '') + ' hb').trim();
    var max = 0; rows.forEach(function (r) { if (r.value > max) max = r.value; });
    rows.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'hr';
      var l = document.createElement('div'); l.className = 'hl'; l.textContent = r.label;
      var t = document.createElement('div'); t.className = 'ht';
      var f = document.createElement('div'); f.className = 'hf'; f.style.width = (max ? Math.max(0, r.value) / max * 100 : 0) + '%'; f.style.background = o.color; t.appendChild(f);
      var v = document.createElement('div'); v.className = 'hv'; v.textContent = o.fmt(r.value);
      if (r.sub) { var sb = document.createElement('span'); sb.className = 'hs'; sb.textContent = r.sub; v.appendChild(sb); }
      row.appendChild(l); row.appendChild(t); row.appendChild(v); el.appendChild(row);
    });
  };

  Lab.spark = function (values, color, w, h) {
    w = w || 84; h = h || 26;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), n = values.length, d = '';
    values.forEach(function (v, i) { d += (i ? 'L' : 'M') + (2 + i / (n - 1) * (w - 6)).toFixed(1) + ' ' + (3 + (1 - (v - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1); });
    var ly = 3 + (1 - (values[n - 1] - lo) / (hi - lo || 1)) * (h - 6);
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + (w - 4) + '" cy="' + ly.toFixed(1) + '" r="2.5" fill="' + color + '"/></svg>';
  };

  /* diverging colour for correlation: red (−1) · neutral grey (0) · blue (+1) */
  Lab.corrColor = function (v) {
    var a = [215, 38, 61], mid = [233, 237, 242], b = [42, 111, 219], t = Math.max(-1, Math.min(1, v)), from = mid, to = t < 0 ? a : b, k = Math.abs(t);
    var c = from.map(function (x, i) { return Math.round(x + (to[i] - x) * k); });
    return { bg: 'rgb(' + c.join(',') + ')', fg: (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 150 ? '#fff' : '#0a1e3f' };
  };

  Lab.onResize = function (el, fn) {
    var w = el.clientWidth, t;
    if (!('ResizeObserver' in window)) { window.addEventListener('resize', fn); return; }
    new ResizeObserver(function () {
      if (Math.abs(el.clientWidth - w) < 2) return; w = el.clientWidth;
      clearTimeout(t); t = setTimeout(fn, 80);
    }).observe(el);
  };

  window.Lab = Lab;
})();
