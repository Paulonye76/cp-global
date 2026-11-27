const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = process.env.DATABASE_URL
  ? new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
const files = new Map();
const fileQueue = [];
let dbDirty = false;
let running = false;

const DIR = path.join(__dirname, 'data');
const PHOTOS = path.join(DIR, 'photos');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(PHOTOS, { recursive: true });

let db = { seq: 0, users: [], profiles: [], notifications: [] };
if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
db.notifications = db.notifications || [];
const DEFAULTS = { announcement: '', trialDays: 3, openTiers: false, signupsOpen: true };
db.settings = Object.assign({}, DEFAULTS, db.settings || {});
const VDIR = path.join(DIR, 'verify');
fs.mkdirSync(VDIR, { recursive: true });

async function kick() {
  if (!pool || running) return;
  running = true;
  try {
    while (fileQueue.length || dbDirty) {
      if (fileQueue.length) {
        const f = fileQueue.shift();
        if (f.del) await pool.query('delete from files where name=$1', [f.name]);
        else await pool.query('insert into files(name,data) values($1,$2) on conflict (name) do update set data=excluded.data', [f.name, f.data]);
      } else {
        dbDirty = false;
        await pool.query("insert into kv(k,v) values('db',$1) on conflict (k) do update set v=excluded.v", [JSON.stringify(db)]);
      }
    }
  } catch (e) { console.error('persist failed', e.message); }
  running = false;
}

async function load() {
  if (!pool) return;
  await pool.query('create table if not exists kv (k text primary key, v text not null)');
  await pool.query('create table if not exists files (name text primary key, data bytea not null)');
  const r = await pool.query("select v from kv where k='db'");
  if (r.rowCount) { db = JSON.parse(r.rows[0].v); db.notifications = db.notifications || []; db.settings = Object.assign({}, DEFAULTS, db.settings || {}); }
  (await pool.query('select name, data from files')).rows.forEach(x => files.set(x.name, x.data));
}

function putFile(name, buf) {
  if (pool) { files.set(name, buf); fileQueue.push({ name, data: buf }); kick(); }
  else fs.writeFileSync(path.join(DIR, name), buf);
}
function getFile(name) {
  if (pool) return files.get(name) || null;
  const f = path.join(DIR, name);
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
}
function delFile(name) {
  if (pool) { files.delete(name); fileQueue.push({ name, del: true }); kick(); }
  else { try { fs.unlinkSync(path.join(DIR, name)); } catch (e) {} }
}

let timer;
function saveSoon() { clearTimeout(timer); timer = setTimeout(save, 2000); }

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
  if (pool) { dbDirty = true; kick(); }
}

function secret() {
  const f = path.join(DIR, 'secret.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}

function view(p) {
  if (!p) return null;
  const u = db.users.find(x => x.id === p.user_id);
  return Object.assign({}, p, { dob: u ? u.dob : null, joined: u ? u.created_at : null, category_label: p.category === 'Other' && p.category_other ? p.category_other : p.category, has_photo: !!p.photo_type });
}

function createAccount(a) {
  if (db.users.some(u => u.email === a.email) || db.profiles.some(p => p.username === a.username)) {
    const e = new Error('duplicate');
    e.code = 'duplicate';
    throw e;
  }
  const id = ++db.seq;
  db.users.push({ id, email: a.email, password_hash: a.hash, google: !!a.google, dob: null, created_at: new Date().toISOString() });
  db.profiles.push({
    user_id: id, username: a.username, full_name: a.full_name, country: a.country || null,
    show_name: true, show_country: true, show_age: false, show_photo: true,
    photo_type: null, photo_verified: false, tier: 1, status: 'draft', onboarded: false, trial_used: false, city: null, category: null, category_other: '', unpublished: false, goal: null, source: null,
    views: 0, shares: 0, verify_status: 'none', verified_at: null, verify_note: '', achievements: '', bio: '', bio_long: '', links: [], public_email: null, contact_address: null, show_contact: false,
    trial_ends_at: null, paid_until: null
  });
  save();
  notify(id, 'welcome', { title: 'Welcome to CP Global', body: 'Your account is ready. Finish your profile, then make it live on Google.', label: 'Go to dashboard', url: '/dashboard' });
  return id;
}

function notify(userId, key, n) {
  db.notifications = db.notifications.filter(x => !(x.user_id === userId && x.key === key));
  db.notifications.push({ id: ++db.seq, user_id: userId, key, title: n.title, body: n.body || '', label: n.label || '', url: n.url || '', read: false, at: new Date().toISOString() });
  save();
}

module.exports = {
  notify,
  settings: () => db.settings,
  setSettings(o) { Object.assign(db.settings, o); save(); },
  allUsers: () => db.users.map(u => Object.assign({}, view(db.profiles.find(p => p.user_id === u.id)), { email: u.email, created_at: u.created_at })),
  deleteUser(id) {
    db.users = db.users.filter(u => u.id !== id);
    db.profiles = db.profiles.filter(p => p.user_id !== id);
    db.notifications = db.notifications.filter(n => n.user_id !== id);
    delFile('photos/' + id);
    [1, 2].forEach(n => delFile('verify/' + id + '-' + n + '.jpg'));
    save();
  },
  ensureAdmin(email, hash) {
    const u = db.users.find(x => x.email === email);
    if (u) { u.password_hash = hash; save(); return u.id; }
    let name = 'cpadmin', k = 0;
    while (db.profiles.some(p => p.username === name)) name = 'cpadmin' + (++k);
    const id = createAccount({ email, hash, username: name, full_name: 'CP Global Admin', country: '', trialDays: 3 });
    db.profiles.find(x => x.user_id === id).onboarded = true;
    save();
    return id;
  },
  notifications: id => db.notifications.filter(x => x.user_id === id).map(x => Object.assign({}, x)).sort((a, b) => b.at.localeCompare(a.at)),
  unread: id => db.notifications.filter(x => x.user_id === id && !x.read).length,
  markRead(id) { db.notifications.forEach(x => { if (x.user_id === id) x.read = true; }); saveSoon(); },
  userById: id => db.users.find(u => u.id === id) || null,
  saveSelfies(id, bufs) { bufs.forEach((b, k) => putFile('verify/' + id + '-' + (k + 1) + '.jpg', b)); },
  selfie: (id, n) => getFile('verify/' + id + '-' + n + '.jpg'),
  clearSelfies(id) { [1, 2].forEach(n => delFile('verify/' + id + '-' + n + '.jpg')); },
  ready: load,
  secret,
  createAccount,
  setGoogle(id, hash) { const u = db.users.find(x => x.id === id); u.password_hash = hash; u.google = true; save(); },
  incr(userId, field) { const p = db.profiles.find(x => x.user_id === userId); if (p) { p[field] = (p[field] || 0) + 1; saveSoon(); } },
  userByEmail: email => db.users.find(u => u.email === email) || null,
  profileByUsername: u => view(db.profiles.find(p => p.username === u)),
  profileByUserId: id => view(db.profiles.find(p => p.user_id === id)),
  allProfiles: () => db.profiles.map(view),
  updateProfile(userId, fields, dob) {
    Object.assign(db.profiles.find(p => p.user_id === userId), fields);
    if (dob !== undefined) db.users.find(u => u.id === userId).dob = dob;
    save();
  },
  setPhoto(userId, buf, type) {
    putFile('photos/' + userId, buf);
    const p = db.profiles.find(x => x.user_id === userId);
    p.photo_type = type;
    p.photo_verified = false;
    p.verify_status = 'none';
    p.verified_at = null;
    save();
  },
  photo: userId => getFile('photos/' + userId)
};
