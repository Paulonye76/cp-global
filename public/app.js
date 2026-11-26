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
  var seen = false;
  try { seen = sessionStorage.getItem('cpsplash'); } catch (e) {}
  if (seen) set('welcome');
  else setTimeout(function () { try { sessionStorage.setItem('cpsplash', '1'); } catch (e) {} set('welcome'); }, 3100);
  var slides = [].slice.call(o.querySelectorAll('.qs'));
  var bar = o.querySelector('.pbar i');
  var i = 0;
  function show(n) {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === n); });
    i = n;
    var s = slides[n], q = s.querySelector('.q');
    var t = q.dataset.t || (q.dataset.t = q.textContent.trim());
    var words = t.split(/\s+/);
    q.innerHTML = words.map(function (w, k) { return '<span style="animation-delay:' + (k * 65) + 'ms">' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'; }).join(' ');
    var base = words.length * 65 + 200;
    [].slice.call(s.querySelector('.ans').children).forEach(function (el, k) { el.style.animationDelay = (base + k * 90) + 'ms'; });
    bar.style.width = ((n + 1) / slides.length * 100) + '%';
  }
  o.querySelector('[data-ready]').addEventListener('click', function () { set('chat'); show(0); });
  o.querySelector('[data-back]').addEventListener('click', function () { if (i) show(i - 1); else set('welcome'); });
  o.addEventListener('click', function (e) {
    if (e.target.closest('[data-next]') && i < slides.length - 1) show(i + 1);
  });
  o.addEventListener('change', function (e) {
    var s = e.target.closest('.qs');
    if (!s || i >= slides.length - 1) return;
    if (e.target.type === 'radio' && s.hasAttribute('data-auto')) setTimeout(function () { show(i + 1); }, 300);
    if (e.target.hasAttribute('data-photo')) setTimeout(function () { show(i + 1); }, 300);
  });
  o.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && i < slides.length - 1) { e.preventDefault(); show(i + 1); }
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
  var v = document.querySelector('[data-verify]');
  if (!v) return;
  var p1 = v.querySelector('.vp1'), p2 = v.querySelector('.vp2'), p3 = v.querySelector('.vp3');
  var vid = v.querySelector('video'), q = v.querySelector('.vq'), msg = v.querySelector('.vmsg');
  var imgs = v.querySelectorAll('.shots img');
  var shots = [], stream = null;
  function stop() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }
  function grab() {
    var w = vid.videoWidth || 480, h = vid.videoHeight || 480, s = Math.min(1, 480 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    var x = c.getContext('2d');
    x.translate(c.width, 0); x.scale(-1, 1);
    x.drawImage(vid, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }
  function start() {
    msg.textContent = '';
    shots = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Your browser cannot open the camera here.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function (s) {
      stream = s; vid.srcObject = s;
      p1.hidden = true; p3.hidden = true; p2.hidden = false;
      q.textContent = 'Look straight at the camera';
    }).catch(function () { msg.textContent = 'Allow camera access in your browser settings, then try again.'; });
  }
  v.addEventListener('click', function (e) {
    if (e.target.closest('[data-start]') || e.target.closest('[data-retake]')) { start(); return; }
    if (e.target.closest('[data-snap]')) {
      shots.push(grab());
      if (shots.length === 1) { q.textContent = v.dataset.prompt; return; }
      stop();
      imgs[0].src = shots[0]; imgs[1].src = shots[1];
      p2.hidden = true; p3.hidden = false;
      return;
    }
    if (e.target.closest('[data-send]')) {
      msg.textContent = 'Sending...';
      fetch('/verify/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf': v.dataset.csrf }, body: JSON.stringify({ a: shots[0], b: shots[1], prompt: v.dataset.prompt }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) location.href = '/notifications'; else msg.textContent = 'Could not send. Try again.'; })
        .catch(function () { msg.textContent = 'Could not send. Try again.'; });
    }
  });
})();
