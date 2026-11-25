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

const RESERVED = new Set(['admin', 'support', 'login', 'logout', 'register', 'dashboard', 'api', 'photo', 'qr',
  'sitemap', 'robots', 'about', 'terms', 'privacy', 'pricing', 'help', 'static', 'public', 'cpglobal', 'cp_global']);
const USERNAME_RE = /^(?!.*\.\.)[a-z0-9_][a-z0-9._]{1,18}[a-z0-9_]$/;

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
  res.render('register', { error: null, v: { username: String(req.query.u || '').toLowerCase().slice(0, 20) } });
});

app.post('/register', authLimit, async (req, res) => {
  const b = req.body;
  const v = {
    username: String(b.username || '').trim().toLowerCase(),
    email: String(b.email || '').trim().toLowerCase(),
    full_name: String(b.full_name || '').trim().slice(0, 60),
    country: String(b.country || '').trim().slice(0, 56)
  };
  const fail = (error) => res.status(400).render('register', { error, v });
  const uerr = usernameError(v.username);
  if (uerr) return fail(uerr);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return fail('Enter a valid email.');
  if (String(b.password || '').length < 8) return fail('Password needs at least 8 characters.');
  if (!v.full_name) return fail('Enter your full name.');
  if (b.age13 !== 'on' || b.terms !== 'on') return fail('Confirm you are 13 or older and accept the terms.');
  try {
    const hash = await bcrypt.hash(String(b.password), 12);
    const id = store.createAccount({ email: v.email, hash, username: v.username, full_name: v.full_name, country: v.country, trialDays: TRIAL_DAYS });
    startSession(res, id);
    res.redirect('/dashboard');
  } catch (e) {
    if (e.code === 'duplicate') return fail('That username or email is already taken.');
    console.error(e);
    res.status(500).render('message', { title: 'Something went wrong', text: 'Try again in a moment.' });
  }
});

app.get('/login', (req, res) => req.user ? res.redirect('/dashboard') : res.render('login', { error: null }));

app.post('/login', authLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = store.userByEmail(email);
  const ok = u && await bcrypt.compare(String(req.body.password || ''), u.password_hash);
  if (!ok) return res.status(401).render('login', { error: 'Email or password is wrong.' });
  startSession(res, u.id);
  res.redirect('/dashboard');
});

app.post('/logout', requireAuth, checkCsrf, (req, res) => { res.clearCookie('cp'); res.redirect('/'); });

function myProfile(id) { return store.profileByUserId(id); }

app.get('/dashboard', requireAuth, async (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) { res.clearCookie('cp'); return res.redirect('/login'); }
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
  const urls = [BASE + '/'].concat(store.allProfiles().filter(isLive).map(x => BASE + '/' + x.username));
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
  const showName = p.show_name && p.full_name;
  const name = showName ? p.full_name : '@' + p.username;
  const photoPublic = p.photo_verified && p.show_photo && p.has_photo;
  const age = p.show_age ? ageOf(p.dob) : null;
  const country = p.show_country ? p.country : null;
  const ld = { '@context': 'https://schema.org', '@type': 'Person', name, alternateName: '@' + p.username, url: BASE + '/' + p.username };
  if (photoPublic) ld.image = BASE + '/photo/' + p.username;
  if (country) ld.address = { '@type': 'PostalAddress', addressCountry: country };
  res.render('profile', {
    p, name, country, age, photoPublic,
    title: '@' + p.username + (showName ? ' | ' + p.full_name : '') + ' | CP Global',
    desc: name + ' on CP Global' + (country ? ', ' + country : '') + '. Find @' + p.username + ' first.',
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
