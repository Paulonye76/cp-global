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
  'sitemap', 'robots', 'about', 'terms', 'privacy', 'pricing', 'help', 'static', 'public', 'cpglobal', 'cp_global', 'discover', 'notifications', 'verify', 'publish', 'welcome', 'features', 'plans', 'faq', 'how', 'auth', 'cpadmin']);
const USERNAME_RE = /^(?!.*\.\.)[a-z0-9_][a-z0-9._]{1,18}[a-z0-9_]$/;
const CATS = ['Creator', 'Professional', 'Business owner', 'Student', 'Artist', 'Other'];
const GOALS = ['Be found on Google', 'Share my work', 'Build my brand', 'Network', 'Just exploring'];
const SOURCES = ['TikTok', 'Instagram', 'Friend or family', 'Google', 'Other'];
const OPEN_TIERS = process.env.OPEN_TIERS === '1';
const tiersOpen = () => OPEN_TIERS || store.settings().openTiers;
const GID = process.env.GOOGLE_CLIENT_ID;
const GSEC = process.env.GOOGLE_CLIENT_SECRET;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const pick = (v, list) => list.includes(v) ? v : null;
const LINK_RE = /(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|me|ng|app|dev|ly|link|site|xyz|info|biz|tv|gg|ai|store|online|shop)\b|@[a-z0-9._-]+\.[a-z]{2,})/i;
const hasLink = (t) => LINK_RE.test(String(t || ''));
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
  if (p.suspended || p.unpublished) return false;
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: Object.assign({}, helmet.contentSecurityPolicy.getDefaultDirectives(), {
      'script-src': ["'self'", 'https://cdn.jsdelivr.net', "'wasm-unsafe-eval'"],
      'connect-src': ["'self'", 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com'],
      'worker-src': ["'self'", 'blob:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'blob:']
    })
  }
}));
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
  res.locals.unread = 0;
  res.locals.admin = false;
  res.locals.liveNow = false;
  res.locals.announce = store.settings().announcement || '';
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
      res.locals.unread = store.unread(d.id);
      const me = store.userById(d.id);
      req.admin = !!(me && ADMIN_EMAIL && me.email === ADMIN_EMAIL);
      res.locals.admin = req.admin;
      const pr = store.profileByUserId(d.id);
      res.locals.liveNow = !!(pr && isLive(pr));
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
  if (!store.settings().signupsOpen) return fail('Sign-ups are paused right now. Please check back soon.', 0, 'home');
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
  res.redirect(u.email === ADMIN_EMAIL ? '/admin' : '/dashboard');
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
    res.status(400).render('profile-edit', { p, msg: null, error, unlock: '', CATS });
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
  res.redirect('/dashboard/profile?m=Saved');
});

app.post('/dashboard/photo', requireAuth, upload.single('photo'), checkCsrf, async (req, res) => {
  const type = req.file && sniffImage(req.file.buffer);
  if (!type) return res.redirect('/dashboard/profile?m=Use a JPG, PNG or WebP image under 2 MB');
  store.setPhoto(req.user.id, req.file.buffer, type);
  store.notify(req.user.id, 'verify', { title: 'Verify your profile', body: 'Your new photo needs to be verified before it can show on Google.', label: 'Verify now', url: '/verify' });
  res.redirect('/dashboard/profile?m=Photo uploaded');
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
    category: p.tier >= 2 ? p.category_label : null,
    catKey: p.tier >= 2 ? p.category : null,
    place: p.show_country ? [p.city, p.country].filter(Boolean).join(', ') : '',
    photo: !!(p.photo_verified && p.show_photo && p.has_photo),
    views: p.views || 0,
    featured: !!p.featured,
    verified: p.verify_status === 'verified'
  }));
  if (q) list = list.filter(x => x.username.includes(q) || (x.name && x.name.toLowerCase().includes(q)) || (x.category && x.category.toLowerCase().includes(q)));
  if (cat) list = list.filter(x => x.catKey === cat);
  if (loc) list = list.filter(x => x.place.toLowerCase().includes(loc));
  list.sort((a, b) => b.views - a.views);
  res.render('discover', { list: list.slice(0, 24), q: String(req.query.q || '').slice(0, 60), cat: cat || '', loc: String(req.query.loc || '').slice(0, 60), CATS, searching: !!(q || cat || loc) });
});

app.post('/api/share', requireAuth, (req, res) => {
  if (req.get('x-csrf') !== req.user.c) return res.sendStatus(403);
  store.incr(req.user.id, 'shares');
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!req.admin) return res.status(404).render('message', { title: 'Page not found', text: 'Check the address and try again.' });
  next();
}

app.get('/dashboard/profile', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  const last = p.username_changed_at ? Date.parse(p.username_changed_at) : 0;
  const locked = (p.username_changes || 0) >= 2 && Date.now() - last < 30 * 864e5;
  const unlock = locked ? new Date(last + 30 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  res.render('profile-edit', { p, msg: req.query.m || null, error: null, unlock, CATS });
});

app.post('/dashboard/field', requireAuth, checkCsrf, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  const id = req.user.id;
  const f = String(req.body.field || '');
  const v = String(req.body.value || '').trim();
  const back = (m) => res.redirect('/dashboard/profile?m=' + encodeURIComponent(m));
  if (f === 'full_name') {
    if (!v) return back('Name cannot be empty.');
    store.updateProfile(id, { full_name: v.slice(0, 60) });
  } else if (f === 'username') {
    const u = v.toLowerCase();
    if (u === p.username) return back('That is already your username.');
    const e = usernameError(u);
    if (e) return back(e);
    const last = p.username_changed_at ? Date.parse(p.username_changed_at) : 0;
    const n = p.username_changes || 0;
    if (n >= 2 && Date.now() - last < 30 * 864e5) return back('You can change your username again on ' + new Date(last + 30 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '.');
    if (store.profileByUsername(u)) return back('That username is taken.');
    store.updateProfile(id, { username: u, username_changes: n >= 2 ? 1 : n + 1, username_changed_at: new Date().toISOString() });
  } else if (f === 'country') store.updateProfile(id, { country: v.slice(0, 56) || null });
  else if (f === 'city') store.updateProfile(id, { city: v.slice(0, 60) || null });
  else if (f === 'category') {
    const c = pick(v, CATS);
    if (!c) return back('Choose a profession.');
    const o = String(req.body.other || '').trim().slice(0, 40);
    if (c === 'Other' && !o) return back('Tell us what you do.');
    store.updateProfile(id, { category: c, category_other: c === 'Other' ? o : '' });
  } else if (f === 'bio') {
    const t = v.slice(0, (p.tier || 1) === 1 ? 20 : 150);
    if (hasLink(t)) return back('Links are not allowed in your bio.');
    store.updateProfile(id, { bio: t });
  }
  else if (f === 'links') store.updateProfile(id, { links: v.split('\n').map(cleanUrl).filter(Boolean).slice(0, 3) });
  else if (f === 'dob') {
    const d = v || null;
    if (d) { const a = ageOf(d); if (isNaN(new Date(d)) || a === null || a < 13 || a > 120) return back('Enter a valid date. You must be 13 or older.'); }
    store.updateProfile(id, {}, d);
  } else return back('Something went wrong.');
  back('Saved');
});

app.post('/api/toggle', requireAuth, (req, res) => {
  if (req.get('x-csrf') !== req.user.c) return res.sendStatus(403);
  const f = String(req.body.field || '');
  if (['show_name', 'show_country', 'show_age', 'show_photo'].indexOf(f) < 0) return res.sendStatus(400);
  store.updateProfile(req.user.id, { [f]: req.body.on === '1' });
  res.json({ ok: true });
});

['how-it-works', 'features', 'plans', 'faq'].forEach(n => app.get('/' + n, (req, res) => res.render(n === 'how-it-works' ? 'how' : n)));

app.get('/dashboard/qr', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  res.render('qr', { p });
});

app.get('/notifications', requireAuth, (req, res) => {
  const list = store.notifications(req.user.id);
  store.markRead(req.user.id);
  res.render('notifications', { list });
});

const PROMPTS = ['left', 'right', 'smile'];

app.get('/verify', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  res.render('verify', { p, prompt: PROMPTS[Math.floor(Math.random() * PROMPTS.length)] });
});

function dataJpeg(s) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  return b.length > 1000 && b.length < 700000 && sniffImage(b) === 'image/jpeg' ? b : null;
}

app.post('/verify/submit', requireAuth, express.json({ limit: '2mb' }), (req, res) => {
  if (req.get('x-csrf') !== req.user.c) return res.sendStatus(403);
  const p = myProfile(req.user.id);
  const a = dataJpeg(req.body.a), b = dataJpeg(req.body.b);
  if (!p || !p.has_photo || !a || !b || p.verify_status === 'verified') return res.status(400).json({ ok: false });
  store.saveSelfies(req.user.id, [a, b]);
  store.updateProfile(req.user.id, { verify_status: 'pending', verify_prompt: String(req.body.prompt || '').slice(0, 80), verify_note: '' });
  store.notify(req.user.id, 'verify', { title: 'Verification under review', body: 'We review each request by hand. You will get a message here when it is done.' });
  res.json({ ok: true });
});

function tally(list, f) {
  const m = {};
  list.forEach(p => { const k = f(p); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
}

app.get('/admin', requireAdmin, (req, res) => {
  const users = store.allUsers();
  const ps = store.allProfiles();
  const sum = (k) => ps.reduce((t, p) => t + (p[k] || 0), 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = d.toISOString().slice(0, 10);
    days.push({ l: d.toLocaleDateString('en-GB', { weekday: 'short' }), n: users.filter(u => String(u.created_at).slice(0, 10) === key).length });
  }
  const live = ps.filter(isLive);
  const s = {
    total: ps.length, live: live.length,
    verified: ps.filter(p => p.verify_status === 'verified').length,
    pending: ps.filter(p => p.verify_status === 'pending').length,
    views: sum('views'), shares: sum('shares'),
    funnel: [['Registered', ps.length], ['Finished onboarding', ps.filter(p => p.onboarded).length], ['Published a page', ps.filter(p => p.trial_used || p.status === 'active').length], ['Verified', ps.filter(p => p.verify_status === 'verified').length], ['Live right now', live.length]],
    days,
    sources: tally(ps, p => p.source), cats: tally(ps, p => p.category_label), countries: tally(ps, p => p.country),
    tiers: tally(live, p => 'Tier ' + (p.tier || 1)),
    top: ps.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).filter(p => p.views).map(p => ({ username: p.username, views: p.views }))
  };
  res.render('admin', { s });
});

app.get('/admin/users', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  let list = store.allUsers();
  if (q) list = list.filter(u => (u.username + ' ' + u.email + ' ' + u.full_name).toLowerCase().includes(q));
  list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.render('admin-users', { list: list.slice(0, 100), q, ADMIN_EMAIL, live: isLive, msg: req.query.m || null });
});

app.post('/admin/users/:id', requireAdmin, checkCsrf, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = store.profileByUserId(id);
  const u = store.userById(id);
  const back = '/admin/users?q=' + encodeURIComponent(String(req.body.q || ''));
  if (!p || !u || u.email === ADMIN_EMAIL) return res.redirect(back);
  const a = req.body.action;
  if (a === 'suspend') { store.updateProfile(id, { suspended: true }); store.notify(id, 'admin', { title: 'Your page is hidden', body: 'An administrator hid your page. Contact us if you think this is a mistake.' }); }
  else if (a === 'unsuspend') { store.updateProfile(id, { suspended: false }); store.notify(id, 'admin', { title: 'Your page is visible again', body: 'An administrator restored your page.' }); }
  else if (a === 'feature') store.updateProfile(id, { featured: true });
  else if (a === 'unfeature') store.updateProfile(id, { featured: false });
  else if (a === 'verify') { store.updateProfile(id, { verify_status: 'verified', verified_at: new Date().toISOString(), photo_verified: true }); store.notify(id, 'verify', { title: 'You are verified', body: 'Your profile now carries the CP Global verified badge.', label: 'View my profile', url: '/' + p.username }); }
  else if (a === 'unverify') store.updateProfile(id, { verify_status: 'none', verified_at: null, photo_verified: false });
  else if (a === 'delete') store.deleteUser(id);
  res.redirect(back);
});

app.get('/admin/settings', requireAdmin, (req, res) => res.render('admin-settings', { s: store.settings(), msg: req.query.m || null }));

app.post('/admin/settings', requireAdmin, checkCsrf, (req, res) => {
  const b = req.body;
  store.setSettings({
    announcement: String(b.announcement || '').trim().slice(0, 200),
    trialDays: Math.min(30, Math.max(1, parseInt(b.trialDays, 10) || 3)),
    openTiers: b.openTiers === 'on', signupsOpen: b.signupsOpen === 'on'
  });
  res.redirect('/admin/settings?m=Saved');
});

app.get('/admin/broadcast', requireAdmin, (req, res) => res.render('admin-broadcast', { msg: req.query.m || null }));

app.post('/admin/broadcast', requireAdmin, checkCsrf, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 80);
  const body = String(req.body.body || '').trim().slice(0, 300);
  if (!title) return res.redirect('/admin/broadcast?m=' + encodeURIComponent('Add a title.'));
  let url = String(req.body.url || '').trim();
  if (!/^\/[A-Za-z0-9\/_\-?=&.]*$/.test(url)) url = '';
  const label = url ? (String(req.body.label || '').trim().slice(0, 30) || 'Open') : '';
  const key = 'bc' + Date.now();
  const all = store.allProfiles();
  all.forEach(p => store.notify(p.user_id, key, { title, body, label, url }));
  res.redirect('/admin/broadcast?m=' + encodeURIComponent('Sent to ' + all.length + ' people.'));
});

app.get('/admin/verify', requireAdmin, (req, res) => {
  res.render('admin-verify', { list: store.allProfiles().filter(p => p.verify_status === 'pending') });
});

app.get('/admin/verify/img/:id/:n', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = store.profileByUserId(id);
  const photo = req.params.n === 'photo';
  const buf = photo ? (p && p.has_photo ? store.photo(id) : null) : store.selfie(id, parseInt(req.params.n, 10));
  if (!buf) return res.sendStatus(404);
  res.set('Content-Type', photo ? p.photo_type : 'image/jpeg');
  res.set('Cache-Control', 'private, no-store');
  res.send(buf);
});

app.post('/admin/verify/:id', requireAdmin, checkCsrf, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = store.profileByUserId(id);
  if (!p || p.verify_status !== 'pending') return res.redirect('/admin/verify');
  const note = String(req.body.note || 'The photos did not match.').slice(0, 140);
  if (req.body.action === 'approve') {
    store.updateProfile(id, { verify_status: 'verified', verified_at: new Date().toISOString(), photo_verified: true, verify_note: '' });
    store.notify(id, 'verify', { title: 'You are verified', body: 'Your profile now carries the CP Global verified badge, and your photo can show on Google.', label: 'View my profile', url: '/' + p.username });
  } else {
    store.updateProfile(id, { verify_status: 'rejected', verify_note: note });
    store.notify(id, 'verify', { title: 'Verification did not pass', body: note + ' Try again with a clear, well-lit photo.', label: 'Try again', url: '/verify' });
  }
  store.clearSelfies(id);
  res.redirect('/admin/verify');
});

app.get('/welcome', requireAuth, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  if (p.onboarded) return res.redirect('/dashboard');
  const E = { dob: [3, 'Enter your date of birth to continue.'], country: [5, 'Enter your country to continue.'], other: [0, 'Tell us what you do.'] }[req.query.e];
  res.render('welcome', { p, CATS, GOALS, SOURCES, err: E ? E[1] : '', start: E ? E[0] : 0 });
});

app.post('/welcome', requireAuth, upload.single('photo'), checkCsrf, (req, res) => {
  const b = req.body;
  const redo = (code) => res.redirect('/welcome?e=' + code);
  const dob = String(b.dob || '').trim();
  const a = dob ? ageOf(dob) : null;
  if (!dob || isNaN(new Date(dob)) || a === null || a > 120 || new Date(dob) > new Date()) return redo('dob');
  if (a < 13) {
    store.deleteUser(req.user.id);
    res.clearCookie('cp');
    return res.render('message', { title: 'You must be 13 or older', text: 'CP Global is for people 13 and over, so this sign-up has been removed.' });
  }
  const country = String(b.country || '').trim().slice(0, 56);
  if (!country) return redo('country');
  const category = pick(b.category, CATS);
  const other = String(b.category_other || '').trim().slice(0, 40);
  if (category === 'Other' && !other) return redo('other');
  store.updateProfile(req.user.id, {
    country,
    city: String(b.city || '').trim().slice(0, 60) || null,
    show_age: b.show_age === 'on',
    category, category_other: category === 'Other' ? other : '',
    goal: pick(b.goal, GOALS), source: pick(b.source, SOURCES),
    onboarded: true
  }, dob);
  const type = req.file && sniffImage(req.file.buffer);
  if (type) store.setPhoto(req.user.id, req.file.buffer, type);
  store.notify(req.user.id, 'verify', { title: 'Verify your profile', body: 'Confirm it is really you to unlock your verified badge and show your photo on Google.', label: 'Verify now', url: '/verify' });
  res.redirect('/dashboard');
});

function pubProfile(req, res) {
  const p = myProfile(req.user.id);
  if (!p) { res.redirect('/login'); return null; }
  if (!p.onboarded) { res.redirect('/welcome'); return null; }
  return p;
}

app.get('/publish', requireAuth, (req, res) => {
  const p = pubProfile(req, res);
  if (p) res.render('publish', { p, live: isLive(p), open: tiersOpen(), plans: false, msg: req.query.m || null });
});

app.get('/publish/plans', requireAuth, (req, res) => {
  const p = pubProfile(req, res);
  if (p) res.render('publish', { p, live: isLive(p), open: tiersOpen(), plans: true, msg: req.query.m || null });
});

app.get('/publish/:tier', requireAuth, (req, res) => {
  const p = pubProfile(req, res);
  if (!p) return;
  const tier = parseInt(req.params.tier, 10);
  if ([1, 2, 3].indexOf(tier) < 0) return res.redirect('/publish/plans');
  res.render('publish-form', { p, tier, open: tiersOpen(), CATS, msg: req.query.m || null, err: req.query.e || null });
});

app.post('/publish/:tier', requireAuth, checkCsrf, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  const b = req.body;
  const tier = Math.min(3, Math.max(1, parseInt(req.params.tier, 10) || 1));
  const goBack = (m, e) => res.redirect('/publish/' + tier + (e ? '?e=' : '?m=') + encodeURIComponent(m));
  const bio = String(b.bio || '').trim().slice(0, tier === 1 ? 20 : 150);
  if (hasLink(bio)) return goBack('Links are not allowed in your bio.', true);
  const category = pick(b.category, CATS) || p.category;
  const other = String(b.category_other || '').trim().slice(0, 40);
  if (category === 'Other' && !other) return goBack('Tell us what you do.', true);
  const f = {
    full_name: String(b.full_name || '').trim().slice(0, 60) || p.full_name,
    country: String(b.country || '').trim().slice(0, 56) || null,
    category, category_other: category === 'Other' ? other : '',
    show_name: b.show_name === 'on', show_country: b.show_country === 'on',
    show_photo: b.show_photo === 'on', show_age: b.show_age === 'on',
    bio
  };
  if (tier === 3) {
    f.bio_long = String(b.bio_long || '').trim().slice(0, 1000);
    f.achievements = String(b.achievements || '').split('\n').map(x => x.trim().slice(0, 100)).filter(Boolean).slice(0, 6).join('\n');
    f.links = [b.link1, b.link2, b.link3].map(cleanUrl).filter(Boolean);
    f.public_email = String(b.public_email || '').trim().slice(0, 120) || null;
    f.contact_address = String(b.contact_address || '').trim().slice(0, 200) || null;
    f.show_contact = b.show_contact === 'on';
  }
  if (p.suspended) { store.updateProfile(req.user.id, f); return goBack('An administrator has hidden your page.', true); }
  if (tier > 1 && !tiersOpen()) {
    store.updateProfile(req.user.id, f);
    return goBack('Saved. Paid plans open soon, so this tier cannot go live yet. Choose Tier 1 to go live free now.');
  }
  const f2 = Object.assign({}, f, { unpublished: false, tier });
  if (!isLive(p) && !p.trial_used) {
    f2.status = 'trial'; f2.trial_used = true;
    f2.trial_ends_at = new Date(Date.now() + store.settings().trialDays * 864e5).toISOString();
  }
  if (!isLive(Object.assign({}, p, f2))) { store.updateProfile(req.user.id, f); return goBack('Your free trial has ended. Plans open soon.'); }
  store.updateProfile(req.user.id, f2);
  store.notify(req.user.id, 'live', { title: 'You are live on Google', body: 'Your page is public. Google can take a few days to show it.', label: 'View my page', url: '/' + p.username });
  res.redirect('/dashboard?m=' + encodeURIComponent('You are live on Google.'));
});

app.post('/profile/offline', requireAuth, checkCsrf, (req, res) => {
  store.updateProfile(req.user.id, { unpublished: true });
  res.redirect('/dashboard?m=' + encodeURIComponent('Your profile is now hidden from Google.'));
});

app.post('/profile/online', requireAuth, checkCsrf, (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.redirect('/login');
  store.updateProfile(req.user.id, { unpublished: false });
  if (!isLive(Object.assign({}, p, { unpublished: false }))) return res.redirect('/publish?m=' + encodeURIComponent('Your free trial has ended. Plans open soon.'));
  res.redirect('/dashboard?m=' + encodeURIComponent('You are live on Google again.'));
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
  const urls = [BASE + '/', BASE + '/discover', BASE + '/how-it-works', BASE + '/features', BASE + '/plans', BASE + '/faq'].concat(store.allProfiles().filter(isLive).map(x => BASE + '/' + x.username));
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
  const owner = !!(req.user && req.user.id === p.user_id);
  const preview = !isLive(p);
  if (preview && !owner) return res.render('message', { title: 'This page is paused', text: '@' + p.username + ' is not live right now.', noindex: true });
  if (!req.user || req.user.id !== p.user_id) store.incr(p.user_id, 'views');
  const showName = p.show_name && p.full_name;
  const name = showName ? p.full_name : '@' + p.username;
  const photoPublic = p.photo_verified && p.show_photo && p.has_photo;
  const age = p.show_age ? ageOf(p.dob) : null;
  const country = p.show_country ? p.country : null;
  const bio = p.bio ? String(p.bio).slice(0, (p.tier || 1) === 1 ? 20 : 150) : '';
  const ach = p.tier === 3 ? String(p.achievements || '').split('\n').filter(Boolean) : [];
  const ld = { '@context': 'https://schema.org', '@type': 'Person', name, alternateName: '@' + p.username, url: BASE + '/' + p.username };
  if (photoPublic) ld.image = BASE + '/photo/' + p.username;
  if (country) ld.address = { '@type': 'PostalAddress', addressCountry: country };
  if (bio) ld.description = bio;
  if (p.tier >= 2 && p.category_label) ld.jobTitle = p.category_label;
  if (p.tier === 3 && p.links && p.links.length) ld.sameAs = p.links;
  if (ach.length) ld.award = ach;
  if (p.tier === 3 && p.show_contact && p.public_email) ld.email = p.public_email;
  res.render('profile', {
    p, name, country, age, photoPublic, ach, bio, owner, preview, noindex: preview, photoShown: photoPublic || (owner && p.has_photo), verified: p.verify_status === 'verified', vdate: p.verified_at,
    place: country ? [p.city, country].filter(Boolean).join(', ') : '',
    since: p.joined ? new Date(p.joined).getFullYear() : null,
    title: '@' + p.username + (showName ? ' | ' + p.full_name : '') + ' | CP Global',
    desc: bio ? bio : name + ' on CP Global' + (country ? ', ' + country : '') + '. Find @' + p.username + ' first.',
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

store.ready()
  .then(async () => { if (ADMIN_EMAIL && process.env.ADMIN_PASSWORD) store.ensureAdmin(ADMIN_EMAIL, await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)); })
  .then(() => app.listen(PORT, () => console.log('CP Global running on ' + BASE)))
  .catch(e => { console.error(e); process.exit(1); });
