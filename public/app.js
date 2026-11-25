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

  var w = document.querySelector('[data-wiz]');
  if (w) {
    var slides = [].slice.call(w.querySelectorAll('.slide'));
    var bar = w.querySelector('.bar i'), lab = w.querySelector('.stepn');
    var back = w.querySelector('[data-back]'), next = w.querySelector('[data-next]'), done = w.querySelector('[data-done]');
    var i = 0;
    var show = function (n, dir) {
      slides.forEach(function (s, k) {
        s.classList.remove('on', 'bk');
        if (k === n) { s.classList.add('on'); if (dir < 0) s.classList.add('bk'); }
      });
      i = n;
      bar.style.width = ((n + 1) / slides.length * 100) + '%';
      lab.textContent = 'Step ' + (n + 1) + ' of ' + slides.length;
      back.style.visibility = n ? 'visible' : 'hidden';
      next.hidden = n === slides.length - 1;
      done.hidden = n !== slides.length - 1;
    };
    next.addEventListener('click', function () { if (i < slides.length - 1) show(i + 1, 1); });
    back.addEventListener('click', function () { if (i) show(i - 1, -1); });
    w.querySelectorAll('.chips input').forEach(function (r) {
      r.addEventListener('change', function () { setTimeout(function () { if (i < slides.length - 1) show(i + 1, 1); }, 280); });
    });
    show(0, 1);
  }

  var pf = document.querySelector('.pf');
  if (pf) {
    pf.querySelectorAll('input[name=tier]').forEach(function (r) {
      r.addEventListener('change', function () { pf.dataset.tier = r.value; });
    });
  }

  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.step,.b,.plan,details,.cta,.big,.eyebrow,.card2').forEach(function (el, k) {
      el.classList.add('rv');
      el.style.transitionDelay = ((k % 3) * 80) + 'ms';
      io.observe(el);
    });
  }
})();

(function () {
  var o = document.querySelector('[data-onb]');
  if (!o) return;
  var set = function (s) { o.dataset.s = s; };
  var seen = false;
  try { seen = sessionStorage.getItem('cpsplash'); } catch (e) {}
  if (seen) set('welcome');
  else setTimeout(function () { try { sessionStorage.setItem('cpsplash', '1'); } catch (e) {} set('welcome'); }, 3100);

  var slides = [].slice.call(o.querySelectorAll('.qs'));
  var bar = o.querySelector('.pbar i');
  var i = 0;
  function show(n, dir) {
    slides.forEach(function (s, k) {
      s.classList.toggle('on', k === n);
    });
    i = n;
    var s = slides[n], q = s.querySelector('.q');
    var t = q.dataset.t || (q.dataset.t = q.textContent.trim());
    var words = t.split(/\s+/);
    q.innerHTML = words.map(function (w, k) { return '<span style="animation-delay:' + (k * 65) + 'ms">' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'; }).join(' ');
    var base = words.length * 65 + 200;
    [].slice.call(s.querySelector('.ans').children).forEach(function (el, k) { el.style.animationDelay = (base + k * 90) + 'ms'; });
    bar.style.width = ((n + 1) / slides.length * 100) + '%';
  }
  o.querySelector('[data-ready]').addEventListener('click', function () { set('chat'); show(0, 1); });
  o.querySelector('[data-back]').addEventListener('click', function () { if (i) show(i - 1, -1); else set('welcome'); });
  o.addEventListener('click', function (e) {
    var t = e.target.closest('[data-next]');
    if (t && i < slides.length - 1) show(i + 1, 1);
  });
  o.addEventListener('change', function (e) {
    var s = e.target.closest('.qs');
    if (!s || i >= slides.length - 1) return;
    if (e.target.type === 'radio' && s.hasAttribute('data-auto')) setTimeout(function () { show(i + 1, 1); }, 300);
    if (e.target.hasAttribute('data-photo')) setTimeout(function () { show(i + 1, 1); }, 300);
  });
  o.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && i < slides.length - 1) { e.preventDefault(); show(i + 1, 1); }
  });
})();

(function () {
  var a = document.querySelector('[data-auth]');
  if (!a) return;
  var slides = [].slice.call(a.querySelectorAll('.as'));
  var form = a.querySelector('.af'), modal = a.querySelector('[data-modal]');
  var i = 0, pending = null;
  var set = function (s) { a.dataset.s = s; };
  function check() {
    var s = slides[i], b = s.querySelector('.nx'), t = s.dataset.v, ok = true;
    if (t === 'email') ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.querySelector('input').value.trim());
    else if (t === 'pass') ok = s.querySelector('input').value.length >= 8;
    else if (t === 'any') ok = s.querySelector('input').value.length > 0;
    else if (t === 'user') {
      var n = s.querySelector('[name=full_name]');
      ok = s.querySelector('[name=username]').value.trim().length >= 3 && (!n || n.value.trim().length > 0);
    }
    if (b) b.disabled = !ok;
    return ok;
  }
  function show(n) {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === n); });
    i = n;
    check();
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
    if (b) {
      pending = b;
      if (a.dataset.mode === 'login') go(b); else modal.hidden = false;
      return;
    }
    if (e.target.closest('[data-cancel]')) { modal.hidden = true; pending = null; return; }
    if (e.target.closest('[data-accept]')) { modal.hidden = true; go(pending); return; }
    if (e.target.closest('[data-aback]')) {
      if (i > 0) show(i - 1);
      else if (a.dataset.mode === 'google') location.href = '/';
      else set('home');
      return;
    }
    if (e.target.closest('[data-n]') && check()) show(i + 1);
  });
  a.addEventListener('input', check);
  a.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && slides[i].querySelector('[data-n]')) {
      e.preventDefault();
      if (check()) show(i + 1);
    }
  });
  show(parseInt(a.dataset.start, 10) || 0);
})();
