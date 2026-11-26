const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data');
const PHOTOS = path.join(DIR, 'photos');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(PHOTOS, { recursive: true });

let db = { seq: 0, users: [], profiles: [], notifications: [] };
if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
db.notifications = db.notifications || [];
const VDIR = path.join(DIR, 'verify');
fs.mkdirSync(VDIR, { recursive: true });

let timer;
function saveSoon() { clearTimeout(timer); timer = setTimeout(save, 2000); }

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

function secret() {
  const f = path.join(DIR, 'secret.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}

function view(p) {
  if (!p) return null;
  const u = db.users.find(x => x.id === p.user_id);
  return Object.assign({}, p, { dob: u ? u.dob : null, joined: u ? u.created_at : null, has_photo: !!p.photo_type });
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
    photo_type: null, photo_verified: false, tier: 1, status: 'draft', onboarded: false, trial_used: false, city: null, category: null, goal: null, source: null,
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
  notifications: id => db.notifications.filter(x => x.user_id === id).map(x => Object.assign({}, x)).sort((a, b) => b.at.localeCompare(a.at)),
  unread: id => db.notifications.filter(x => x.user_id === id && !x.read).length,
  markRead(id) { db.notifications.forEach(x => { if (x.user_id === id) x.read = true; }); saveSoon(); },
  userById: id => db.users.find(u => u.id === id) || null,
  saveSelfies(id, bufs) { bufs.forEach((b, k) => fs.writeFileSync(path.join(VDIR, id + '-' + (k + 1) + '.jpg'), b)); },
  selfie(id, n) { const f = path.join(VDIR, id + '-' + n + '.jpg'); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
  clearSelfies(id) { [1, 2].forEach(n => { try { fs.unlinkSync(path.join(VDIR, id + '-' + n + '.jpg')); } catch (e) {} }); },
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
    fs.writeFileSync(path.join(PHOTOS, String(userId)), buf);
    const p = db.profiles.find(x => x.user_id === userId);
    p.photo_type = type;
    p.photo_verified = false;
    p.verify_status = 'none';
    p.verified_at = null;
    save();
  },
  photo: userId => fs.readFileSync(path.join(PHOTOS, String(userId)))
};
