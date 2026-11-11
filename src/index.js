import { STAGES, TECHS, SLOTS, decorate, numbers, digest, localDate } from './rules.js';
import { parseLead } from './ai.js';
import { loadExamples, removeExamples } from './seed.js';
import { phone } from './phone.js';

const COOKIE = 'ml_session';
const SESSION_DAYS = 30;
const SOURCES = ['Phone', 'Text', 'Website form', 'Google Form', 'Voicemail', 'Missed call', 'Referral', 'Repeat customer', 'Other'];

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const bad = (message, status = 400) => json({ error: message }, status);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (n) => '$' + Number(n).toLocaleString('en-US');

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (err) {
      console.error(err);
      return bad('Something went wrong. Please try again.', 500);
    }
  },
  // Runs every hour. Sends the morning email when it is DIGEST_HOUR where she is.
  async scheduled(event, env) {
    const now = new Date(event.scheduledTime || Date.now());
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: env.TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
    if (hour !== Number(env.DIGEST_HOUR)) return;
    await sendDigest(env, now);
  },
};

async function sendDigest(env, now) {
  const d = digest(await allJobs(env, now), now, env.TIMEZONE, env.OWNER_NAME, env.APP_URL);
  await env.EMAIL.send({ from: env.MAIL_FROM, to: env.DIGEST_TO, subject: d.subject, text: d.text, html: d.html });
  return d;
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/login' && method === 'POST') return login(req, env);
  if (path === '/api/public/request' && method === 'POST') return publicRequest(req, env);

  // Outside systems (a Google Form, Twilio) post here with the secret key in the link
  if ((path === '/api/intake' || path.startsWith('/api/phone/')) && method === 'POST') {
    if (!env.INTAKE_KEY || !(await same(env, url.searchParams.get('key') || '', env.INTAKE_KEY))) return bad('Wrong key.', 401);
    return path === '/api/intake' ? publicRequest(req, env, 'Google Form', false) : phone(req, env, url, createJob, addEvent, findOpenByPhone);
  }

  const authed = await hasSession(req, env);
  if (path.startsWith('/api/')) {
    if (!authed) return bad('Please log in again.', 401);
    return api(req, env, path, method);
  }
  if (path === '/' && !authed) return Response.redirect(url.origin + '/login', 302);
  if (path === '/login' && authed) return Response.redirect(url.origin + '/', 302);
  return env.ASSETS.fetch(req);
}

/* ---------- login ---------- */

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares two strings without leaking where they differ
async function same(env, a, b) {
  const [x, y] = await Promise.all([hmac(env.SESSION_SECRET, a), hmac(env.SESSION_SECRET, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function hasSession(req, env) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now()) return false;
  return same(env, m[2], await hmac(env.SESSION_SECRET, `${env.LOGIN_EMAIL}|${m[1]}`));
}

// Allows `max` tries per IP in a 15 minute window
async function overLimit(env, kind, req, max) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const since = Date.now() - 15 * 60e3;
  await env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(since).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND ip = ?').bind(kind, ip).first();
  if (row.n >= max) return true;
  await env.DB.prepare('INSERT INTO hits (kind, ip, at) VALUES (?, ?, ?)').bind(kind, ip, Date.now()).run();
  return false;
}

async function login(req, env) {
  if (await overLimit(env, 'login', req, 10)) return bad('Too many tries. Wait 15 minutes and try again.', 429);
  const body = await req.json().catch(() => ({}));
  const emailOk = await same(env, str(body.email, 200).toLowerCase(), env.LOGIN_EMAIL.toLowerCase());
  const passOk = await same(env, typeof body.password === 'string' ? body.password : '', env.LOGIN_PASSWORD);
  if (!emailOk || !passOk) return bad('That email or password is not right.', 401);
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const sig = await hmac(env.SESSION_SECRET, `${env.LOGIN_EMAIL}|${exp}`);
  const secure = new URL(req.url).protocol === 'https:' ? ' Secure;' : '';
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

/* ---------- jobs ---------- */

async function allJobs(env, now) {
  const { results } = await env.DB.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  return decorate(results, now, env.TIMEZONE);
}

async function addEvent(env, jobId, note, at) {
  await env.DB.prepare('INSERT INTO events (job_id, at, note) VALUES (?, ?, ?)').bind(jobId, at, note).run();
}

// Finds an open job from the same phone number, so a second message does not make a second job
async function findOpenByPhone(env, phone) {
  const d = String(phone).replace(/\D/g, '').slice(-10);
  if (d.length < 10) return null;
  const { results } = await env.DB.prepare("SELECT id, phone FROM jobs WHERE stage NOT IN ('done', 'lost')").all();
  return results.find((r) => r.phone.replace(/\D/g, '').slice(-10) === d) || null;
}

async function createJob(env, f, addedNote) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO jobs (business, contact, phone, issue, source, emergency, raw_message, created_at, last_contact_at, stage_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(f.business, f.contact, f.phone, f.issue, f.source, f.emergency ? 1 : 0, f.raw_message || '', now, now, now)
    .first();
  await addEvent(env, row.id, addedNote, now);
  return row.id;
}

function leadFields(body) {
  return {
    business: str(body.business, 120),
    contact: str(body.contact, 80),
    phone: str(body.phone, 40),
    issue: str(body.issue, 200),
    source: SOURCES.includes(body.source) ? body.source : 'Phone',
    emergency: body.emergency === true || body.emergency === 1,
    raw_message: str(body.raw_message, 2000),
  };
}

async function api(req, env, path, method) {
  const now = new Date();
  const body = method === 'GET' ? {} : await req.json().catch(() => ({}));

  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }

  if (path === '/api/jobs' && method === 'GET') {
    const jobs = await allJobs(env, now);
    return json({ jobs, numbers: numbers(jobs, now, env.TIMEZONE), tz: env.TIMEZONE, name: env.OWNER_NAME, techs: TECHS, slots: SLOTS, today: localDate(now, env.TIMEZONE), intake_key: env.INTAKE_KEY || '', digest: { to: env.DIGEST_TO || '', hour: Number(env.DIGEST_HOUR) } });
  }

  if (path === '/api/jobs' && method === 'POST') {
    const f = leadFields(body);
    if (!f.business && !f.contact) return bad('Add a business or a contact name so you know who to call.');
    if (!f.issue) return bad('Add a few words about the problem.');
    if (!f.phone) return bad('Add a phone number so you can call them back.');
    const id = await createJob(env, f, `Added (${f.source.toLowerCase()})`);
    return json({ ok: true, id });
  }

  if (path === '/api/parse' && method === 'POST') {
    const text = str(body.text, 2000);
    if (text.length < 5) return bad('Paste or type the message first.');
    return json(await parseLead(env, text));
  }

  if (path === '/api/schedule' && method === 'GET') {
    const date = new URL(req.url).searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('Pick a day.');
    const { results } = await env.DB.prepare("SELECT id, business, contact, issue, tech, slot, stage FROM jobs WHERE slot_date = ? AND stage IN ('sched', 'done')").bind(date).all();
    return json({ date, bookings: results });
  }

  if (path === '/api/digest/send' && method === 'POST') {
    if (await overLimit(env, 'digest', req, 5)) return bad('That is enough test emails for now. Try again in 15 minutes.', 429);
    try {
      await sendDigest(env, now);
    } catch (err) {
      console.error('digest send failed', err);
      return bad('The email could not be sent. Please try again.', 502);
    }
    return json({ ok: true, to: env.DIGEST_TO });
  }
  if (path === '/api/digest' && method === 'GET') {
    return json(digest(await allJobs(env, now), now, env.TIMEZONE, env.OWNER_NAME));
  }

  if (path === '/api/examples' && method === 'POST') {
    if (body.action === 'remove') await removeExamples(env);
    else await loadExamples(env, now, env.TIMEZONE);
    return json({ ok: true });
  }

  const m = path.match(/^\/api\/jobs\/(\d+)(\/action)?$/);
  if (!m) return bad('Not found.', 404);
  const id = Number(m[1]);
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return bad('That job no longer exists.', 404);

  if (!m[2] && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT at, note FROM events WHERE job_id = ? ORDER BY at DESC, id DESC').bind(id).all();
    return json({ job: decorate([job], now, env.TIMEZONE)[0], events: results });
  }

  if (!m[2] && method === 'PATCH') {
    const f = leadFields({ ...job, ...body, emergency: body.emergency === undefined ? job.emergency : body.emergency });
    if (!f.business && !f.contact) return bad('Keep a business or a contact name so you know who to call.');
    const amount = Math.max(0, Math.round(Number(body.quote_amount ?? job.quote_amount)) || 0);
    await env.DB.prepare('UPDATE jobs SET business = ?, contact = ?, phone = ?, issue = ?, source = ?, emergency = ?, quote_amount = ? WHERE id = ?')
      .bind(f.business, f.contact, f.phone, f.issue, f.source, f.emergency ? 1 : 0, amount, id)
      .run();
    return json({ ok: true });
  }

  if (m[2] && method === 'POST') return action(env, job, body, now.toISOString());
  return bad('Not found.', 404);
}

// One tap on a card: record what happened and move the job along
async function action(env, job, body, now) {
  const a = body.action;
  let stage = job.stage;
  let note = '';
  let amount = job.quote_amount;
  let tech = job.tech;
  let when = job.scheduled_for;
  let lost = job.lost_reason;
  let touched = true;
  let slotDate = job.slot_date;
  let slot = job.slot;
  let attempt = job.last_attempt_at;

  if (a === 'called') { stage = 'quote'; note = 'Called them'; }
  else if (a === 'sent') {
    stage = 'sent';
    const n = Math.max(0, Math.round(Number(body.amount)) || 0);
    if (n) amount = n;
    note = amount ? `Quote sent (${money(amount)})` : 'Quote sent';
  }
  else if (a === 'yes') { stage = 'yes'; note = 'They said yes'; }
  else if (a === 'touch') { note = 'Followed up'; }
  else if (a === 'sched') {
    // A date and a tech name are optional notes, not a booking system
    slotDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : '';
    slot = -1; tech = str(body.tech, 60); when = slotDate; stage = 'sched';
    const day = slotDate ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(slotDate + 'T00:00:00Z')) : '';
    note = 'Scheduled' + (day ? ` for ${day}` : '') + (tech ? ` with ${tech}` : '');
  }
  else if (a === 'noanswer') { note = 'Called, no answer'; touched = false; attempt = now; }
  else if (a === 'done') { stage = 'done'; note = 'Job done'; }
  else if (a === 'lost') { stage = 'lost'; lost = str(body.reason, 120) || 'No reason given'; note = `Lost: ${lost}`; }
  else if (a === 'move') {
    if (!STAGES[body.stage]) return bad('Pick a stage.');
    stage = body.stage;
    note = `Moved to ${STAGES[stage]}`;
  }
  else if (a === 'note') {
    note = str(body.note, 500);
    if (!note) return bad('Write the note first.');
    touched = false;
  }
  else return bad('Unknown action.');

  // Leaving the schedule frees the tech's slot
  if (stage !== 'sched' && stage !== 'done') { slotDate = ''; slot = -1; when = ''; }
  await env.DB.prepare('UPDATE jobs SET slot_date = ?, slot = ?, last_attempt_at = ?, stage = ?, quote_amount = ?, tech = ?, scheduled_for = ?, lost_reason = ?, last_contact_at = ?, stage_changed_at = ? WHERE id = ?')
    .bind(slotDate, slot, attempt, stage, amount, tech, when, lost, touched ? now : job.last_contact_at, stage !== job.stage ? now : job.stage_changed_at, job.id)
    .run();
  await addEvent(env, job.id, note, now);
  return json({ ok: true, stage, label: STAGES[stage] });
}

/* ---------- public request form ---------- */

async function publicRequest(req, env, source = 'Website form', limited = true) {
  const body = await req.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // hidden field only bots fill in
  if (limited && (await overLimit(env, 'request', req, 5))) return bad('Too many requests from here. Please call us instead.', 429);
  const message = str(body.message, 2000);
  const phone = str(body.phone, 40);
  if (!phone || message.length < 5) return bad('Please add your phone number and what is wrong.');
  const open = await findOpenByPhone(env, phone);
  if (open) {
    await addEvent(env, open.id, `Sent another message: ${message.slice(0, 300)}`, new Date().toISOString());
    return json({ ok: true });
  }
  const read = await parseLead(env, message);
  await createJob(
    env,
    {
      business: str(body.business, 120),
      contact: str(body.name, 80),
      phone,
      issue: read.issue,
      source,
      emergency: read.emergency,
      raw_message: message,
    },
    source === 'Google Form' ? 'Came in from the Google Form' : 'Came in from the website form'
  );
  return json({ ok: true });
}
