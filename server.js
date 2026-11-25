const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const QRCode = require('qrcode');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || store.secret();
const PROD = process.env.NODE_ENV === 'production';
const BASE = (process.env.BASE_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const TRIAL_DAYS = 3;
const VERSION = process.env.RENDER_GIT_COMMIT || String(Date.now());

const RESERVED = new Set(['admin', 'support', 'login', 'logout', 'register', 'dashboard', 'api', 'photo', 'qr',
  'sitemap', 'robots', 'about', 'terms', 'privacy', 'pricing', 'help', 'static', 'public', 'cpglobal', 'cp_global']);
const USERNAME_RE = /^(?!.*\.\.)[a-z0-9_][a-z0-9._]{1,18}[a-z0-9_]$/;
const CATS = ['Creator', 'Professional', 'Business owner', 'Student', 'Artist', 'Other'];
const GOALS = ['Be found on Google', 'Share my work', 'Build my brand', 'Network', 'Just exploring'];
const SOURCES = ['TikTok', 'Instagram', 'Friend or family', 'Google', 'Other'];
const OPEN_TIERS = process.env.OPEN_TIERS === '1';
const GID = process.env.GOOGLE_CLIENT_ID;
const GSEC = process.env.GOOGLE_CLIENT_SECRET;
const pick = (v, list) => list.includes(v) ? v : null;
function cleanUrl(u) {
  u = String(u || '').trim().slice(0, 200);
  if (!u) return null;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
}

function usernameError(u) {
  if (!USERNAME_RE.test(u)) return 'Use 3 to 20 letters, numbers, dots or underscores.';
  if (RESERVED.has(u)) return 'That username is reserved.';
  return null;
}
function isLive(p) {
  const now = Date.now();
  if (p.status === 'active') return p.paid_until && new Date(p.paid_until).getTime() > now;
  return p.status === 'trial' && new Date(p.trial_ends_at).getTime() > now;
}
function ageOf(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(cookieParser());
app.use(express.static('public', { maxAge: '1h' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
const apiLimit = rateLimit({ windowMs: 60 * 1000, limit: 60 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.csrf = '';
  res.locals.base = BASE;
  res.locals.v = VERSION;
  res.set('Cache-Control', 'no-cache');
  try {
    const t = req.cookies.cp;
    if (t) {
      const d = jwt.verify(t, SECRET);
      req.user = { id: d.id, c: d.c };
      res.locals.user = req.user;
      res.locals.csrf = d.c;
    }
  } catch (e) { res.clearCookie('cp'); }
  next();
});

function authView(res, o) {
  res.render('auth', Object.assign({ mode: 'signup', error: null, v: {}, start: 0, stage: 'home', name: '', email: '' }, o));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}
function checkCsrf(req, res, next) {
  if (!req.body || req.body.csrf !== req.user.c) return res.status(403).render('message', { title: 'Request blocked', text: 'Reload the page and try again.' });
  next();
}
function startSession(res, id) {
  const token = jwt.sign({ id, c: crypto.randomBytes(16).toString('hex') }, SECRET, { expiresIn: '7d' });
  res.cookie('cp', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 864e5 });
}

app.get('/', (req, res) => res.render('home'));

app.get('/api/username', apiLimit, async (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  const err = usernameError(u);
  if (err) return res.json({ ok: false, msg: err });
  res.json(store.profileByUsername(u) ? { ok: false, msg: 'Taken' } : { ok: true, msg: 'Available' });
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  authView(res, { v: { username: String(req.query.u || '').toLowerCase().slice(0, 20) }, error: req.query.e === 'google' ? 'Google sign-in is not available yet. Use email for now.' : null });
});

app.post('/register', authLimit, async (req, res) => {
  const b = req.body;
  const v = {
    username: String(b.username || '').trim().toLowerCase(),
    email: String(b.email || '').trim().toLowerCase(),
    full_name: String(b.full_name || '').trim().slice(0, 60),
    country: String(b.country || '').trim().slice(0, 56)
  };
  const fail = (error, start, stage) => res.status(400).render('auth', { mode: 'signup', error, v, start: start || 0, stage: stage || 'email', name: '', email: '' });
  const uerr = usernameError(v.username);
  if (uerr) return fail(uerr, 2);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return fail('Enter a valid email.', 0);
  if (String(b.password || '').length < 8) return fail('Password needs at least 8 characters.', 1);
  if (!v.full_name) return fail('Enter your full name.', 2);
  if (b.age13 !== 'on' || b.terms !== 'on') return fail('Confirm you are 13 or older and accept the terms.', 0, 'home');
  try {
    const hash = await bcrypt.hash(String(b.password), 12);
    const id = store.createAccount({ email: v.email, hash, username: v.username, full_name: v.full_name, country: v.country, trialDays: TRIAL_DAYS });
    startSession(res, id);
    res.redirect('/welcome');
  } catch (e) {
    if (e.code === 'duplicate') return fail('That username or email is already taken.', 0);
    console.error(e);
    res.status(500).render('message', { title: 'Something went wrong', text: 'Try again in a moment.' });
  }
});

app.get('/login', (req, res) => req.user ? res.redirect('/dashboard') : authView(res, { mode: 'login', error: req.query.e === 'google' ? 'Google sign-in is not available yet. Use email for now.' : null }));

app.post('/login', authLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = store.userByEmail(email);
  const ok = u && await bcrypt.compare(String(req.body.password || ''), u.password_hash);
  if (!ok) return res.status(401).render('auth', { mode: 'login', error: 'Email or password is wrong.', v: { email }, start: 1, stage: 'email', name: '', email: '' });
  startSession(res, u.id);
  res.redirect('/dashboard');
});

app.post('/logout', requireAuth, checkCsrf, (req, res) => { res.clearCookie('cp'); res.redirect('/'); });

function myProfile(id) { return store.profileByUserId(id); }

app.get('/dashboard', requireAuth, async (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) { res.clearCookie('cp'); return res.redirect('/login'); }
  if (!p.onboarded) return res.redirect('/welcome');
  const daysLeft = p.status === 'trial' ? Math.max(0, Math.ceil((new Date(p.trial_ends_at) - Date.now()) / 864e5)) : null;
  res.render('dashboard', { p, live: isLive(p), daysLeft, msg: req.query.m || null, error: null });
});

app.post('/dashboard', requireAuth, checkCsrf, async (req, res) => {
  const b = req.body;
  const full = String(b.full_name || '').trim().slice(0, 60);
  const country = String(b.country || '').trim().slice(0, 56);
  let dob = String(b.dob || '').trim() || null;
  const back = async (error) => {
    const p = myProfile(req.user.id);
    res.status(400).render('dashboard', { p, live: isLive(p), daysLeft: null, msg: null, error });
  };
  if (!full) return back('Name cannot be empty.');
  if (dob) {
    const a = ageOf(dob);
    if (isNaN(new Date(dob)) || a === null || a < 13 || a > 120) return back('Enter a valid date of birth. You must be 13 or older.');
  }
  store.updateProfile(req.user.id, {
    full_name: full, country: country || null, show_name: b.show_name === 'on',
    show_country: b.show_country === 'on', show_age: b.show_age === 'on', show_photo: b.show_photo === 'on'
  }, dob);
  res.redirect('/dashboard?m=Saved');
});

app.post('/dashboard/photo', requireAuth, upload.single('photo'), checkCsrf, async (req, res) => {
  const type = req.file && sniffImage(req.file.buffer);
  if (!type) return res.redirect('/dashboard?m=Use a JPG, PNG or WebP image under 2 MB');
  store.setPhoto(req.user.id, req.file.buffer, type);
  res.redirect('/dashboard?m=Photo uploaded');
});

app.get('/auth/google', (req, res) => {
  const back = req.query.m === 'login' ? '/login' : '/register';
  if (!GID || !GSEC) return res.redirect(back + '?e=google');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('gs', state, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 6e5 });
  const q = new URLSearchParams({ client_id: GID, redirect_uri: BASE + '/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!GID || !GSEC || !req.query.code || req.query.state !== req.cookies.gs) return res.redirect('/register?e=google');
    res.clearCookie('gs');
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: GID, client_secret: GSEC, redirect_uri: BASE + '/auth/google/callback', grant_type: 'authorization_code' })
    });
    const t = await tr.json();
    if (!t.access_token) throw new Error('no token');
    const g = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
    if (!g.email || !g.email_verified) throw new Error('email not verified');
    const email = String(g.email).toLowerCase();
    const u = store.userByEmail(email);
    if (u) {
      if (!u.google) store.setGoogle(u.id, await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10));
      startSession(res, u.id);
      return res.redirect('/dashboard');
    }
    res.cookie('gp', jwt.sign({ email, name: g.name || '' }, SECRET, { expiresIn: '15m' }), { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 9e5 });
    res.redirect('/register/google');
  } catch (e) {
    console.error(e);
    res.redirect('/register?e=google');
  }
});

function googlePending(req) {
  try { return jwt.verify(req.cookies.gp, SECRET); } catch (e) { return null; }
}

app.get('/register/google', (req, res) => {
  const g = googlePending(req);
  if (!g) return res.redirect('/register');
  authView(res, { mode: 'google', stage: 'email', email: g.email });
});

app.post('/register/google', authLimit, async (req, res) => {
  const g = googlePending(req);
  if (!g) return res.redirect('/register');
  const username = String(req.body.username || '').trim().toLowerCase();
  const fail = (error) => res.status(400).render('auth', { mode: 'google', error, v: { username }, start: 0, stage: 'email', name: '', email: g.email });
  const uerr = usernameError(username);
  if (uerr) return fail(uerr);
  try {
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const id = store.createAccount({ email: g.email, hash, google: true, username, full_name: (g.name || g.email.split('@')[0]).slice(0, 60), country: '', trialDays: TRIAL_DAYS });
    res.clearCookie('gp');
    startSession(res, id);
    res.redirect('/welcome');
  } catch (e) {
    if (e.code === 'duplicate') return fail('That username is already taken.');
    console.error(e);
    fail('Something went wrong. Try again.');
  }
});

app.get('/discover', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  const cat = pick(String(req.query.cat || ''), CATS);
  const loc = String(req.query.loc || '').trim().toLowerCase().slice(0, 60);
  let list = store.allProfiles().filter(isLive).map(p => ({
    username: p.username,
    name: p.show_name && p.full_name ? p.full_name : null,
    category: p.tier >= 2 ? p.category : null,
    place: p.show_country ? [p.city, p.country].filter(Boolean).join(', ') : '',
    photo: !!(p.photo_verified && p.show_photo && p.has_photo),
    views: p.views || 0
  }));
  if (q) list = list.filter(x => x.username.includes(q) || (x.name && x.name.toLowerCase().includes(q)) || (x.category && x.category.toLowerCase().includes(q)));
  if (cat) list = list.filter(x => x.category === cat);
  if (loc) list = list.filter(x => x.place.toLowerCase().includes(loc));
  list.sort((a, b) => b.views - a.views);
  res.render('discover', { list: list.slice(0, 24), q: String(req.query.q || '').slice(0, 60), cat: cat || '', loc: String(req.query.loc || '').slice(0, 60), CATS, searching: !!(q || cat || loc) });
});

app.post('/api/share', requireAuth, (req, res) => {
  if (req.get('x-csrf') !== req.user.c) return res.sendStatus(403);
  store.incr(req.user.id, 'shares');
  res.json({ ok: true });
});

app.get('/welcome', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  if (p.onboarded) return res.redirect('/dashboard');
  res.render('welcome', { p, CATS, GOALS, SOURCES });
});

app.post('/welcome', requireAuth, upload.single('photo'), checkCsrf, (req, res) => {
  const b = req.body;
  let dob = String(b.dob || '').trim() || null;
  if (dob) { const a = ageOf(dob); if (isNaN(new Date(dob)) || a === null || a < 13 || a > 120) dob = null; }
  store.updateProfile(req.user.id, {
    country: String(b.country || '').trim().slice(0, 56) || null,
    city: String(b.city || '').trim().slice(0, 60) || null,
    show_age: b.show_age === 'on',
    category: pick(b.category, CATS), goal: pick(b.goal, GOALS), source: pick(b.source, SOURCES),
    onboarded: true
  }, dob);
  const type = req.file && sniffImage(req.file.buffer);
  if (type) store.setPhoto(req.user.id, req.file.buffer, type);
  res.redirect('/dashboard');
});

app.get('/publish', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  if (!p.onboarded) return res.redirect('/welcome');
  res.render('publish', { p, live: isLive(p), open: OPEN_TIERS, CATS, msg: req.query.m || null });
});

app.post('/publish', requireAuth, checkCsrf, (req, res) => {
  const p = myProfile(req.user.id);
  const b = req.body;
  const tier = Math.min(3, Math.max(1, parseInt(b.tier, 10) || 1));
  const f = {
    full_name: String(b.full_name || '').trim().slice(0, 60) || p.full_name,
    country: String(b.country || '').trim().slice(0, 56) || null,
    category: pick(b.category, CATS) || p.category,
    show_name: b.show_name === 'on', show_country: b.show_country === 'on',
    show_photo: b.show_photo === 'on', show_age: b.show_age === 'on'
  };
  if (tier >= 2) f.bio = String(b.bio || '').trim().slice(0, 150);
  if (tier === 3) {
    f.bio_long = String(b.bio_long || '').trim().slice(0, 1000);
    f.achievements = String(b.achievements || '').split('\n').map(x => x.trim().slice(0, 100)).filter(Boolean).slice(0, 6).join('\n');
    f.links = [b.link1, b.link2, b.link3].map(cleanUrl).filter(Boolean);
    f.public_email = String(b.public_email || '').trim().slice(0, 120) || null;
    f.contact_address = String(b.contact_address || '').trim().slice(0, 200) || null;
    f.show_contact = b.show_contact === 'on';
  }
  const goBack = (m) => res.redirect('/publish?m=' + encodeURIComponent(m));
  if (tier > 1 && !OPEN_TIERS) {
    store.updateProfile(req.user.id, f);
    return goBack('Saved. Paid plans open soon, so this tier cannot go live yet. Choose Tier 1 to go live free now.');
  }
  if (!isLive(p)) {
    if (p.trial_used) { store.updateProfile(req.user.id, f); return goBack('Your free trial has ended. Plans open soon.'); }
    f.status = 'trial'; f.trial_used = true;
    f.trial_ends_at = new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString();
  }
  f.tier = tier;
  store.updateProfile(req.user.id, f);
  res.redirect('/dashboard?m=' + encodeURIComponent('You are live on Google.'));
});

app.get('/photo/:username', async (req, res) => {
  const p = store.profileByUsername(req.params.username.toLowerCase());
  if (!p || !p.has_photo) return res.sendStatus(404);
  const owner = req.user && req.user.id === p.user_id;
  const pub = p.photo_verified && p.show_photo && isLive(p);
  if (!owner && !pub) return res.sendStatus(404);
  res.set('Content-Type', p.photo_type);
  res.set('Cache-Control', pub ? 'public, max-age=300' : 'private, no-store');
  res.send(store.photo(p.user_id));
});

app.get('/qr/:username', async (req, res) => {
  const u = req.params.username.toLowerCase();
  if (!store.profileByUsername(u)) return res.sendStatus(404);
  const svg = await QRCode.toString(BASE + '/' + u, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

app.get('/sitemap.xml', async (req, res) => {
  const urls = [BASE + '/', BASE + '/discover'].concat(store.allProfiles().filter(isLive).map(x => BASE + '/' + x.username));
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map(u => '<url><loc>' + u + '</loc></url>').join('') + '</urlset>');
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /login\nDisallow: /register\nSitemap: ' + BASE + '/sitemap.xml\n');
});

app.get('/:username', async (req, res, next) => {
  const u = req.params.username.toLowerCase();
  if (!USERNAME_RE.test(u)) return next();
  const p = store.profileByUsername(u);
  if (!p) return next();
  if (!isLive(p)) return res.render('message', { title: 'This page is paused', text: '@' + p.username + ' is not live right now.', noindex: true });
  if (!req.user || req.user.id !== p.user_id) store.incr(p.user_id, 'views');
  const showName = p.show_name && p.full_name;
  const name = showName ? p.full_name : '@' + p.username;
  const photoPublic = p.photo_verified && p.show_photo && p.has_photo;
  const age = p.show_age ? ageOf(p.dob) : null;
  const country = p.show_country ? p.country : null;
  const ach = p.tier === 3 ? String(p.achievements || '').split('\n').filter(Boolean) : [];
  const ld = { '@context': 'https://schema.org', '@type': 'Person', name, alternateName: '@' + p.username, url: BASE + '/' + p.username };
  if (photoPublic) ld.image = BASE + '/photo/' + p.username;
  if (country) ld.address = { '@type': 'PostalAddress', addressCountry: country };
  if (p.tier >= 2 && p.bio) ld.description = p.bio;
  if (p.tier >= 2 && p.category) ld.jobTitle = p.category;
  if (p.tier === 3 && p.links && p.links.length) ld.sameAs = p.links;
  if (ach.length) ld.award = ach;
  if (p.tier === 3 && p.show_contact && p.public_email) ld.email = p.public_email;
  res.render('profile', {
    p, name, country, age, photoPublic, ach,
    place: country ? [p.city, country].filter(Boolean).join(', ') : '',
    since: p.joined ? new Date(p.joined).getFullYear() : null,
    title: '@' + p.username + (showName ? ' | ' + p.full_name : '') + ' | CP Global',
    desc: (p.tier >= 2 && p.bio) ? p.bio : name + ' on CP Global' + (country ? ', ' + country : '') + '. Find @' + p.username + ' first.',
    canonical: BASE + '/' + p.username,
    image: photoPublic ? BASE + '/photo/' + p.username : null,
    ld: JSON.stringify(ld).replace(/</g, '\\u003c')
  });
});

app.use((req, res) => res.status(404).render('message', { title: 'Page not found', text: 'Check the address and try again.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('message', { title: 'Something went wrong', text: 'Try again in a moment.' });
});

app.listen(PORT, () => console.log('CP Global running on ' + BASE));
