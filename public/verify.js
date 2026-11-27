(function () {
  var v = document.querySelector('[data-verify]');
  if (!v) return;
  var q = function (s) { return v.querySelector(s); };
  var p1 = q('.vp1'), p2 = q('.vp2'), p3 = q('.vp3'), vid = q('video');
  var coach = q('[data-coach]'), ring = q('[data-ring]'), arrow = q('[data-arrow]'), manual = q('[data-manual]'), msg = q('.vmsg');
  var s1 = q('[data-s1]'), s2 = q('[data-s2]'), imgs = v.querySelectorAll('.shots img');
  var PROMPTS = {
    left: { t: 'Slowly turn your head to your left', a: 'left' },
    right: { t: 'Slowly turn your head to your right', a: 'right' },
    smile: { t: 'Give us a big smile', a: 'smile' }
  };
  var prompt = PROMPTS[v.dataset.prompt] || PROMPTS.smile;
  var stream = null, lm = null, shots = [], phase = 0, hold = 0, raf = 0, last = 0, pauseUntil = 0, manualMode = false;
  var bc = document.createElement('canvas');
  bc.width = bc.height = 24;
  var bx = bc.getContext('2d', { willReadFrequently: true });

  function say(text, state) { coach.textContent = text; ring.dataset.state = state || ''; }
  function stop() { cancelAnimationFrame(raf); if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }
  function grab() {
    var w = vid.videoWidth || 480, h = vid.videoHeight || 480, s = Math.min(1, 480 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    var x = c.getContext('2d');
    x.translate(c.width, 0); x.scale(-1, 1);
    x.drawImage(vid, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  function light() {
    bx.drawImage(vid, 0, 0, 24, 24);
    var d = bx.getImageData(0, 0, 24, 24).data, s = 0;
    for (var i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return s / (d.length / 4);
  }
  function vis(pt) {
    var w = vid.videoWidth, h = vid.videoHeight, m = Math.min(w, h);
    return { x: (pt.x * w - (w - m) / 2) / m, y: (pt.y * h - (h - m) / 2) / m };
  }
  function analyze(res) {
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) return null;
    var pts = res.faceLandmarks[0].map(vis);
    var minx = 9, maxx = -9, miny = 9, maxy = -9;
    pts.forEach(function (p) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; });
    var a = pts[234], b = pts[454], n = pts[1];
    var l = Math.min(a.x, b.x), r = Math.max(a.x, b.x);
    var bs = {};
    if (res.faceBlendshapes && res.faceBlendshapes[0]) res.faceBlendshapes[0].categories.forEach(function (c) { bs[c.categoryName] = c.score; });
    return { h: maxy - miny, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, yaw: (n.x - l) / (r - l || 1), smile: ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2 };
  }
  function capture(k) {
    shots.push(grab());
    hold = 0;
    ring.classList.add('flash');
    setTimeout(function () { ring.classList.remove('flash'); }, 400);
    if (k === 0) {
      phase = 1;
      s1.classList.remove('on'); s1.classList.add('done'); s2.classList.add('on');
      arrow.hidden = prompt.a === 'smile';
      arrow.dataset.dir = prompt.a;
      pauseUntil = performance.now() + 1300;
      say('Great! Now one small move.', 'good');
    } else {
      stop();
      imgs[0].src = shots[0]; imgs[1].src = shots[1];
      p2.hidden = true; p3.hidden = false;
    }
  }
  function tick() {
    raf = requestAnimationFrame(tick);
    var now = performance.now();
    if (now - last < 100 || vid.readyState < 2) return;
    last = now;
    if (now < pauseUntil) return;
    var res;
    try { res = lm.detectForVideo(vid, now); } catch (e) { return; }
    var f = analyze(res);
    if (!f) { hold = 0; say('I cannot see your face. Look at the camera.', 'bad'); return; }
    if (light() < 50) { hold = 0; say('It is too dark. Face a light.', 'warn'); return; }
    if (f.h < 0.38) { hold = 0; say('Move a little closer.', 'warn'); return; }
    if (f.h > 0.82) { hold = 0; say('Move back a little.', 'warn'); return; }
    if (phase === 0) {
      if (Math.abs(f.cx - 0.5) > 0.13 || Math.abs(f.cy - 0.5) > 0.15) { hold = 0; say('Center your face in the circle.', 'warn'); return; }
      if (Math.abs(f.yaw - 0.5) > 0.1) { hold = 0; say('Look straight at the camera.', 'warn'); return; }
      hold += 100;
      say('Good! Hold still...', 'good');
      if (hold >= 900) capture(0);
    } else {
      var ok = prompt.a === 'left' ? f.yaw > 0.62 : prompt.a === 'right' ? f.yaw < 0.38 : f.smile > 0.45;
      if (ok) { hold += 100; say('Good! Hold it...', 'good'); if (hold >= 500) capture(1); }
      else { hold = 0; say(prompt.t, 'warn'); }
    }
  }
  function useManual(why) {
    manualMode = true;
    manual.hidden = false;
    say(why || 'Line up your face in the circle, then tap Take photo.', '');
  }
  function loadModel() {
    var base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    var model = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    return import(base + '/vision_bundle.mjs').then(function (mod) {
      return mod.FilesetResolver.forVisionTasks(base + '/wasm').then(function (fs) {
        var make = function (delegate) {
          return mod.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: model, delegate: delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true });
        };
        return make('GPU').catch(function () { return make('CPU'); });
      });
    });
  }
  function start() {
    msg.textContent = '';
    shots = []; phase = 0; hold = 0; manualMode = false;
    s1.className = 'on'; s2.className = '';
    arrow.hidden = true; manual.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Your browser cannot open the camera here.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function (s) {
      stream = s; vid.srcObject = s;
      p1.hidden = true; p3.hidden = true; p2.hidden = false;
      say('Getting the guide ready...', '');
      var timeout = setTimeout(function () { if (!lm) useManual('The guide is taking too long. Line up your face, then tap Take photo.'); }, 15000);
      (lm ? Promise.resolve(lm) : loadModel()).then(function (m) {
        clearTimeout(timeout);
        lm = m;
        if (manualMode || !stream) return;
        say('Center your face in the circle.', 'warn');
        raf = requestAnimationFrame(tick);
      }).catch(function () { clearTimeout(timeout); useManual('The guide is not available. Line up your face, then tap Take photo.'); });
    }).catch(function () { msg.textContent = 'Allow camera access in your browser settings, then try again.'; });
  }
  v.addEventListener('click', function (e) {
    if (e.target.closest('[data-start]') || e.target.closest('[data-retake]')) { stop(); start(); return; }
    if (e.target.closest('[data-manual]')) {
      shots.push(grab());
      if (shots.length === 1) { s1.className = 'done'; s2.className = 'on'; arrow.hidden = prompt.a === 'smile'; arrow.dataset.dir = prompt.a; say(prompt.t, ''); return; }
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
