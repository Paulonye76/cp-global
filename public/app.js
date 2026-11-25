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
