(function () {
  var input = document.querySelector('[data-check]');
  var msg = document.getElementById('uMsg');
  if (input && msg) {
    var timer;
    var run = function () {
      var u = input.value.trim().toLowerCase();
      if (!u) { msg.textContent = ''; msg.className = ''; return; }
      fetch('/api/username?u=' + encodeURIComponent(u))
        .then(function (r) { return r.json(); })
        .then(function (d) { msg.textContent = d.msg; msg.className = d.ok ? 'good' : 'bad'; })
        .catch(function () {});
    };
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 300); });
    if (input.value) run();
  }
})();

(function () {
  var o = document.querySelector('[data-onb]');
  if (!o) return;
  var set = function (s) { o.dataset.s = s; };
  var slides = [].slice.call(o.querySelectorAll('.qs'));
  var bar = o.querySelector('.pbar i');
  var i = 0;
  function ageOf(v) {
    var d = new Date(v);
    if (isNaN(d)) return null;
    var n = new Date(), a = n.getFullYear() - d.getFullYear();
    if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
    return a;
  }
  function problem(s) {
    var t = s.dataset.v;
    if (t === 'dob') {
      var v = s.querySelector('[name=dob]').value;
      if (!v) return 'Enter your date of birth.';
      var a = ageOf(v);
      if (a === null || a < 0 || a > 120) return 'Enter a valid date of birth.';
      if (a < 13) return 'You must be 13 or older to use CP Global.';
    }
    if (t === 'country' && !s.querySelector('[name=country]').value.trim()) return 'Enter your country to continue.';
    return '';
  }
  function showErr(s, msg) {
    var ans = s.querySelector('.ans'), e = ans.querySelector('.ferr');
    if (!msg) { if (e) e.remove(); return; }
    if (!e) { e = document.createElement('p'); e.className = 'ferr'; ans.insertBefore(e, ans.firstChild); }
    e.textContent = msg;
  }
  function show(n, dir) {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === n); s.classList.toggle('bk', k === n && dir < 0); });
    i = n;
    var s = slides[n], q = s.querySelector('.q');
    var t = q.dataset.t || (q.dataset.t = q.textContent.trim());
    var words = t.split(/\s+/);
    q.innerHTML = words.map(function (w, k) { return '<span style="animation-delay:' + (k * 65) + 'ms">' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'; }).join(' ');
    var base = words.length * 65 + 200;
    [].slice.call(s.querySelector('.ans').children).forEach(function (el, k) { el.style.animationDelay = (base + k * 90) + 'ms'; });
    bar.style.width = ((n + 1) / slides.length * 100) + '%';
  }
  function next() {
    var s = slides[i], p = problem(s);
    if (p) { showErr(s, p); return; }
    showErr(s, '');
    if (i < slides.length - 1) show(i + 1, 1);
  }
  if (o.dataset.s === 'chat') show(parseInt(o.dataset.start, 10) || 0, 1);
  else {
    var seen = false;
    try { seen = sessionStorage.getItem('cpsplash'); } catch (e) {}
    if (seen) set('welcome');
    else setTimeout(function () { try { sessionStorage.setItem('cpsplash', '1'); } catch (e) {} set('welcome'); }, 3100);
  }
  o.querySelector('[data-ready]').addEventListener('click', function () { set('chat'); show(0, 1); });
  o.querySelector('[data-back]').addEventListener('click', function () { if (i) show(i - 1, -1); else set('welcome'); });
  o.addEventListener('click', function (e) {
    if (e.target.closest('[data-next]')) { next(); return; }
    if (e.target.closest('[data-other-next]')) {
      var s = slides[i], inp = s.querySelector('[name=category_other]');
      if (!inp.value.trim()) { showErr(s, 'Tell us what you do.'); return; }
      showErr(s, ''); show(i + 1, 1);
    }
  });
  o.addEventListener('input', function (e) {
    if (e.target.name === 'dob') {
      var a = ageOf(e.target.value), out = o.querySelector('[data-agev]');
      out.textContent = a === null ? '' : (a < 13 ? 'You must be 13 or older to use CP Global.' : 'You are ' + a + ' years old.');
      out.className = 'agev' + (a !== null && a < 13 ? ' bad' : '');
      showErr(slides[i], '');
    }
    if (e.target.name === 'country') showErr(slides[i], '');
  });
  o.addEventListener('change', function (e) {
    var s = e.target.closest('.qs');
    if (!s || i >= slides.length - 1) return;
    if (e.target.type === 'radio') {
      if (e.target.name === 'category') {
        var box = s.querySelector('.other-box');
        if (e.target.value === 'Other') { box.hidden = false; setTimeout(function () { box.querySelector('input').focus(); }, 50); return; }
        box.hidden = true;
      }
      if (s.hasAttribute('data-auto')) setTimeout(function () { show(i + 1, 1); }, 300);
    }
    if (e.target.hasAttribute('data-photo')) setTimeout(function () { show(i + 1, 1); }, 300);
  });
  o.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && i < slides.length - 1) { e.preventDefault(); next(); }
  });
})();

(function () {
  var a = document.querySelector('[data-auth]');
  if (!a) return;
  var slides = [].slice.call(a.querySelectorAll('.as'));
  var form = a.querySelector('.af'), modal = a.querySelector('[data-modal]');
  var i = 0, pending = null;
  var set = function (s) { a.dataset.s = s; };
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function problem(s) {
    var t = s.dataset.v;
    if (t === 'email') return EMAIL.test(s.querySelector('input').value.trim()) ? '' : 'Enter a valid email address.';
    if (t === 'pass') return s.querySelector('input').value.length >= 8 ? '' : 'Use at least 8 characters.';
    if (t === 'any') return s.querySelector('input').value.length > 0 ? '' : 'Enter your password.';
    if (t === 'user') {
      if (s.querySelector('[name=username]').value.trim().length < 3) return 'Your username needs at least 3 characters.';
      var n = s.querySelector('[name=full_name]');
      if (n && !n.value.trim()) return 'Enter your full name.';
    }
    return '';
  }
  function check(report) {
    var s = slides[i], b = s.querySelector('.nx'), p = problem(s);
    if (b) b.classList.toggle('off', !!p);
    var e = s.querySelector('.ferr');
    if (report && p) {
      if (!e) { e = document.createElement('p'); e.className = 'ferr'; s.insertBefore(e, b); }
      e.textContent = p;
    } else if (e) e.remove();
    return !p;
  }
  function show(n) {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === n); });
    i = n;
    check(false);
  }
  function go(b) {
    if (!b) return;
    form.querySelectorAll('[name=age13],[name=terms]').forEach(function (h) { h.value = 'on'; });
    if (b.dataset.href) { location.href = b.dataset.href; return; }
    set('email');
    show(0);
  }
  a.addEventListener('click', function (e) {
    var b = e.target.closest('[data-agree]');
    if (b) { pending = b; if (a.dataset.mode === 'login') go(b); else modal.hidden = false; return; }
    if (e.target.closest('[data-cancel]')) { modal.hidden = true; pending = null; return; }
    if (e.target.closest('[data-accept]')) { modal.hidden = true; go(pending); return; }
    if (e.target.closest('[data-aback]')) {
      if (i > 0) show(i - 1);
      else if (a.dataset.mode === 'google') location.href = '/';
      else set('home');
      return;
    }
    if (e.target.closest('[data-n]') && check(true)) show(i + 1);
  });
  ['input', 'change', 'keyup', 'blur'].forEach(function (ev) { a.addEventListener(ev, function () { check(false); }, true); });
  setInterval(function () { if (a.dataset.s === 'email') check(false); }, 400);
  a.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && slides[i].querySelector('[data-n]')) {
      e.preventDefault();
      if (check(true)) show(i + 1);
    }
  });
  form.addEventListener('submit', function (e) { if (!check(true)) e.preventDefault(); });
  show(parseInt(a.dataset.start, 10) || 0);
})();

(function () {
  var pf = document.querySelector('.pf');
  if (pf) {
    var tn = pf.querySelector('[data-tn]');
    pf.querySelectorAll('input[name=tier]').forEach(function (r) {
      r.addEventListener('change', function () { pf.dataset.tier = r.value; if (tn) tn.textContent = 'Tier ' + r.value; });
    });
  }
  document.querySelectorAll('textarea[maxlength]').forEach(function (t) {
    var c = document.createElement('small');
    c.className = 'cnt';
    t.parentNode.appendChild(c);
    var u = function () { c.textContent = t.value.length + ' / ' + t.maxLength; };
    t.addEventListener('input', u);
    u();
  });

  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.step,.b,.plan,details,.cta,.big,.eyebrow,.card2,.nt2').forEach(function (el, k) {
      el.classList.add('rv');
      el.style.transitionDelay = ((k % 3) * 80) + 'ms';
      io.observe(el);
    });
  }
})();

(function () {
  var back = document.querySelector('[data-hback]');
  if (back) back.addEventListener('click', function () {
    var same = false;
    try { same = !!document.referrer && new URL(document.referrer).host === location.host; } catch (e) {}
    if (back.dataset.strict !== '1' && same && history.length > 1) history.back();
    else location.href = back.dataset.fallback || '/';
  });

  var top = document.querySelector('[data-top]');
  if (top) {
    var onScroll = function () { top.classList.toggle('show', window.scrollY > 320); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  var dr = document.querySelector('[data-drawer]'), sc = document.querySelector('[data-scrim]');
  var lo = document.querySelector('[data-lo]');
  function menu(o) {
    if (!dr) return;
    dr.classList.toggle('open', o);
    sc.classList.toggle('open', o);
    dr.setAttribute('aria-hidden', o ? 'false' : 'true');
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) { menu(true); return; }
    if (e.target.closest('[data-menu-close]') || e.target === sc || e.target.closest('.drawer a')) menu(false);
    if (lo) {
      if (e.target.closest('[data-logout]')) { lo.hidden = false; return; }
      if (e.target.closest('[data-lo-cancel]') || e.target === lo) { lo.hidden = true; return; }
      if (e.target.closest('[data-lo-ok]')) document.getElementById('logoutForm').submit();
    }
    var b = e.target.closest('[data-share]');
    if (b) {
      var label = b.querySelector('span');
      var counted = function () { fetch('/api/share', { method: 'POST', headers: { 'x-csrf': b.dataset.csrf } }).catch(function () {}); };
      if (navigator.share) navigator.share({ title: b.dataset.title, url: b.dataset.url }).then(counted).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.url).then(function () { counted(); if (label) label.textContent = 'Link copied'; });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { menu(false); if (lo) lo.hidden = true; }
  });
})();

(function () {
  var edit = document.querySelector('.edit');
  if (edit) {
    var csrf = edit.dataset.csrf;
    var sh = document.querySelector('[data-sheet]'), sc = document.querySelector('[data-sheet-scrim]');
    var f = sh.querySelector('form'), fld = f.querySelector('[name=field]'), st = sh.querySelector('[data-st]');
    var body = sh.querySelector('[data-sf]'), hint = sh.querySelector('[data-sh]'), save = sh.querySelector('[data-save]');
    var pm = document.querySelector('[data-pmodal]'), pf = document.querySelector('[data-photo-file]');
    var closeSheet = function () { sh.classList.remove('open'); sc.classList.remove('open'); };
    var openSheet = function (row) {
      var d = row.dataset, el;
      fld.value = d.edit; st.textContent = d.label;
      hint.textContent = d.locked || d.hint || '';
      body.innerHTML = '';
      if (d.type === 'textarea') { el = document.createElement('textarea'); el.rows = 4; }
      else if (d.type === 'select') {
        el = document.createElement('select');
        JSON.parse(d.options).forEach(function (o) { var op = document.createElement('option'); op.textContent = o; if (o === d.value) op.selected = true; el.appendChild(op); });
      } else { el = document.createElement('input'); el.type = d.type || 'text'; }
      el.name = 'value'; el.className = 'big-in2';
      if (d.type !== 'select') el.value = d.value || '';
      if (+d.max) el.maxLength = +d.max;
      if (d.locked) { el.disabled = true; save.hidden = true; } else save.hidden = false;
      body.appendChild(el);
      if (d.edit === 'category') {
        var ot = document.createElement('input');
        ot.name = 'other'; ot.className = 'big-in2'; ot.maxLength = 40; ot.placeholder = 'Tell us what you do'; ot.value = d.other || '';
        var tog = function () { ot.hidden = el.value !== 'Other'; };
        el.addEventListener('change', tog); tog();
        body.appendChild(ot);
      }
      sh.classList.add('open'); sc.classList.add('open');
      if (!d.locked && d.type !== 'date' && d.type !== 'select') setTimeout(function () { el.focus(); }, 380);
    };
    document.addEventListener('click', function (e) {
      var r = e.target.closest('[data-edit]');
      if (r) { openSheet(r); return; }
      if (e.target.closest('[data-sheet-close]') || e.target === sc) { closeSheet(); return; }
      if (e.target.closest('[data-photo-warn]')) { pm.hidden = false; return; }
      if (e.target.closest('[data-pm-cancel]') || e.target === pm) { pm.hidden = true; return; }
      if (e.target.closest('[data-pm-ok]')) { pm.hidden = true; pf.click(); return; }
      var c = e.target.closest('[data-copy]');
      if (c && navigator.clipboard) navigator.clipboard.writeText(c.dataset.copy);
    });
    pf.addEventListener('change', function () { if (pf.files.length) document.getElementById('photoForm').submit(); });
    document.querySelectorAll('[data-toggle]').forEach(function (t) {
      t.addEventListener('change', function () {
        fetch('/api/toggle', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf': csrf }, body: 'field=' + t.dataset.toggle + '&on=' + (t.checked ? 1 : 0) }).catch(function () {});
      });
    });
  }
  document.addEventListener('submit', function (e) {
    var b = e.submitter, m = b && b.dataset && b.dataset.confirm;
    if (m && !window.confirm(m)) e.preventDefault();
  });
})();

(function () {
  var cs = document.querySelector('select[data-cat]'), ob = document.querySelector('[data-other]');
  if (!cs || !ob) return;
  var up = function () { ob.hidden = cs.value !== 'Other'; };
  cs.addEventListener('change', up);
  up();
})();
