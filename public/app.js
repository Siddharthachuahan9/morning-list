// Morning List front end. Plain JavaScript, no build step.

// Denise's own words for where a job is at
const STAGES = [
  ['new', 'New'],
  ['quote', 'Waiting on quote'],
  ['sent', 'Waiting on their yes'],
  ['yes', 'Needs scheduling'],
  ['sched', 'Scheduled'],
  ['done', 'Done'],
];
const STAGE_LABEL = { ...Object.fromEntries(STAGES), lost: 'Lost' };
const SOURCES = ['Phone', 'Text', 'Website form', 'Google Form', 'Voicemail', 'Missed call', 'Referral', 'Repeat customer', 'Other'];

// "What happened?" choices at each step: [action, what she taps]
const OPTIONS = {
  new: [['called', 'We talked. They need a quote'], ['yes', 'We talked. They want us to come out'], ['noanswer', 'No answer'], ['lost', 'Not a job for us']],
  quote: [['sent', 'I sent the quote'], ['yes', 'They already said yes'], ['lost', 'Not going ahead']],
  sent: [['yes', 'They said yes'], ['touch', 'I followed up, still waiting'], ['noanswer', 'No answer'], ['lost', 'They said no']],
  yes: [['sched', 'It is scheduled'], ['lost', 'They changed their mind']],
  sched: [['done', 'The job is done'], ['sched', 'Change the date or tech'], ['lost', 'It was cancelled']],
};
const AFTER = {
  called: 'Now waiting on your quote.',
  sent: 'Now waiting on their yes. Back on your list in 2 days if they go quiet.',
  yes: 'They said yes. It stays on your list until it is scheduled.',
  touch: 'Back on your list in 2 days if they stay quiet.',
  noanswer: 'Still on your list so you can try again.',
  sched: 'Scheduled. Off your call list.',
  done: 'Done.',
  lost: 'Closed.',
};

let S = { jobs: [], numbers: {}, tz: 'UTC', name: '', today: '' };
let draft = null;
let jobsFilter = '';
let search = '';

const main = document.getElementById('main');
const dlg = document.getElementById('dlg');
const dlgBody = document.getElementById('dlg-body');
const toastEl = document.getElementById('toast');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
const digits = (s) => String(s || '').replace(/\D/g, '');
// One phone format everywhere: (312) 555-0142
function phoneText(p) {
  let d = digits(p);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
const nameOf = (j) => j.business || j.contact || phoneText(j.phone) || 'Unknown';
const via = (j) => (j.source === 'Google Form' ? 'Google Form' : j.source.toLowerCase());
const jobById = (id) => S.jobs.find((j) => String(j.id) === String(id));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) {
    location.href = '/login';
    throw new Error('Please log in again.');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
}

function when(iso) {
  const d = new Date(iso);
  const old = Date.now() - d.getTime() > 6 * 864e5;
  const opts = old ? { month: 'short', day: 'numeric' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat('en-US', { timeZone: S.tz, ...opts }).format(d);
}
// Dates like 2026-11-10 are calendar days, so format them without shifting timezones
const dayFmt = (date, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(date + 'T00:00:00Z'));
const visitText = (j) => [j.slot_date ? (j.slot_date === S.today ? 'Today' : dayFmt(j.slot_date, { weekday: 'short', month: 'short', day: 'numeric' })) : '', j.tech].filter(Boolean).join(', ');

let toastTimer;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4500);
}
async function load() {
  S = await api('/api/jobs');
}

/* ---------- shared pieces ---------- */

const titleRow = (h1, sub, right = '') => `<div class="title"><div><h1>${h1}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`;
const stagePill = (j) => `<span class="pill${j.stage === 'done' ? ' pos' : j.stage === 'lost' ? '' : ' acc'}">${STAGE_LABEL[j.stage]}</span>`;

// Where every job is at, in one row. Tapping a step shows those jobs.
function strip(active) {
  return `<div class="panel pipe">${STAGES.map(([key, label]) => `<button data-filter="${key}" aria-pressed="${active === key}"><span>${label}</span><b>${S.jobs.filter((j) => j.stage === key).length}</b></button>`).join('')}</div>`;
}
function callButton(j, opensSheet) {
  return j.phone ? `<a class="btn" href="tel:${esc(digits(j.phone))}"${opensSheet ? ` data-call="${j.id}"` : ''}>Call<span class="num">&nbsp;${esc(phoneText(j.phone))}</span></a>` : '';
}

/* ---------- today: who to call, and where each job is at ---------- */

function callRow(j) {
  const now = j.reason.rank === 0;
  const detail = [j.business && j.contact ? j.contact : '', now ? '' : j.issue, j.quote_amount ? money(j.quote_amount) : '', `came in by ${via(j)}, ${when(j.created_at)}`].filter(Boolean).join(' · ');
  return `<div class="call row${now ? ' now' : ''}">
    <div>
      <div class="name"><button data-open="${j.id}">${esc(nameOf(j))}</button>${now ? '<span class="pill neg">Equipment down</span>' : stagePill(j)}${j.tried_today ? '<span class="pill warn">Tried today</span>' : ''}</div>
      <div class="reason">${esc(j.reason.text)}</div>
      <div class="sub">${esc(detail)}</div>
    </div>
    <div class="acts">${callButton(j, true)}<button class="btn main" data-open="${j.id}">What happened?</button></div>
  </div>`;
}

function todayView() {
  const list = S.jobs.filter((j) => j.reason).sort((a, b) => a.reason.rank - b.reason.rank || a.tried_today - b.tried_today || a.last_contact_at.localeCompare(b.last_contact_at));
  const sub = list.length ? `${plural(list.length, 'person', 'people')} to call today. Start at the top.` : 'Nobody is waiting on you right now.';
  const empty = `<div class="panel empty"><b>All caught up</b>${S.jobs.length ? 'New requests and follow-ups will show up here.' : 'No jobs yet. Tap New job to add your first one, or load example jobs from Help.'}</div>`;
  return `${titleRow(`Today <span>${dayFmt(S.today, { weekday: 'long', month: 'long', day: 'numeric' })}</span>`, sub, '<a class="btn main" href="#add">New job</a>')}
    <section><div class="sec"><h2>Who to call</h2><span>${list.length}</span></div>
      ${list.length ? `<div class="panel">${list.map(callRow).join('')}</div>` : empty}
    </section>
    <section><div class="sec"><h2>Where each job is at</h2><span>${plural(S.numbers.open, 'open job', 'open jobs')} · tap a step to see them</span></div>
      ${strip('')}
    </section>`;
}

/* ---------- jobs ---------- */

function jobRow(j, showStage) {
  const next = j.stage === 'sched' || j.stage === 'done' ? visitText(j) : j.stage === 'lost' ? j.lost_reason : j.reason ? j.reason.text : j.days ? `Quiet for ${plural(j.days, 'day', 'days')}` : 'Nothing needed today';
  return `<button class="jrow" data-open="${j.id}">
    <span><b>${esc(nameOf(j))} ${showStage ? stagePill(j) : j.emergency && j.stage === 'new' ? '<span class="pill neg">Equipment down</span>' : ''}</b><span class="i">${esc(j.issue)}</span></span>
    <span class="nx">${esc(next)}</span>
    <span class="amt">${j.quote_amount ? money(j.quote_amount) : ''}</span>
  </button>`;
}
function jobList() {
  const q = search.trim().toLowerCase();
  if (q) {
    const hits = S.jobs.filter((j) => [j.business, j.contact, j.issue, j.phone].join(' ').toLowerCase().includes(q) || (digits(q).length > 2 && digits(j.phone).includes(digits(q))));
    return `<section><div class="sec"><h2>Found</h2><span>${hits.length}</span></div><div class="panel">${hits.length ? hits.map((j) => jobRow(j, true)).join('') : '<div class="empty">Nobody matches that. Check the spelling, or search by phone number.</div>'}</div></section>`;
  }
  const lost = S.jobs.filter((j) => j.stage === 'lost').length;
  const shown = jobsFilter ? [[jobsFilter, STAGE_LABEL[jobsFilter]]] : STAGES.slice(0, 5);
  return `<div class="acts">${jobsFilter ? '<button class="txt" data-filter="">Show all open jobs</button>' : ''}${lost && jobsFilter !== 'lost' ? `<button class="txt" data-filter="lost">Lost (${lost})</button>` : ''}</div>` + shown.map(([key, label]) => {
    const g = S.jobs.filter((j) => j.stage === key).sort((a, b) => b.emergency - a.emergency || b.days - a.days);
    return `<section><div class="sec"><h2>${label}</h2><span>${g.length}</span></div><div class="panel">${g.length ? g.map((j) => jobRow(j)).join('') : '<div class="empty">Nobody here right now.</div>'}</div></section>`;
  }).join('');
}
function jobsView() {
  const n = S.numbers;
  return `${titleRow('Jobs', `${plural(n.open, 'open job', 'open jobs')} · ${money(n.quotes_out)} in quotes waiting on a yes · ${money(n.done_month_value)} done this month`, '<a class="btn main" href="#add">New job</a>')}
    <input type="text" class="search" id="search" placeholder="Find a customer by name or phone" aria-label="Find a customer" value="${esc(search)}">
    ${strip(jobsFilter)}
    <div id="joblist" class="stack">${jobList()}</div>`;
}

/* ---------- new job ---------- */

function leadForm(prefix, j) {
  return `<div class="two">
      <label>Business<input type="text" id="${prefix}-business" maxlength="120" value="${esc(j.business)}"></label>
      <label>Contact name<input type="text" id="${prefix}-contact" maxlength="80" value="${esc(j.contact)}"></label>
    </div>
    <div class="two">
      <label>Phone<input type="tel" id="${prefix}-phone" maxlength="40" value="${esc(j.phone)}"></label>
      <label>How it came in<select id="${prefix}-source">${SOURCES.map((s) => `<option${s === j.source ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <label>What is wrong<input type="text" id="${prefix}-issue" maxlength="200" value="${esc(j.issue)}"></label>
    <label class="check"><input type="checkbox" id="${prefix}-emergency"${j.emergency ? ' checked' : ''}><span><b>Equipment is down</b> or food is at risk. Goes to the top of the call list.</span></label>`;
}
function readForm(prefix) {
  const v = (k) => document.getElementById(`${prefix}-${k}`).value.trim();
  return { business: v('business'), contact: v('contact'), phone: v('phone'), source: v('source'), issue: v('issue'), emergency: document.getElementById(`${prefix}-emergency`).checked };
}
function addView() {
  return `${titleRow('New job', 'Paste the customer\'s text, or type what they told you on the phone. Include their number.')}
    <div class="panel pad">
      <label>What did they say?<textarea id="paste" placeholder="Example: Jo from Marina Grill, walk-in cooler is at 50 and not coming down, fish at risk. 312-555-0124"></textarea></label>
      <label>How did it come in?<select id="quick-source"><option value="Phone">Phone call</option><option value="Text">Text</option><option>Referral</option><option>Repeat customer</option><option>Other</option></select></label>
      <p class="err" id="quick-err" hidden></p>
      <div class="acts"><button class="btn main" id="quick-add">Add to the list</button><button class="txt" id="by-hand">Fill in the details myself</button></div>
    </div>
    <form class="panel pad" id="add-form" hidden>
      <h2>Check the details</h2>
      ${leadForm('add', { business: '', contact: '', phone: '', issue: '', source: 'Phone', emergency: false })}
      <p class="err" id="add-err" hidden></p>
      <div class="acts"><button class="btn main">Add to the list</button></div>
    </form>`;
}
function showForm(lead) {
  const f = document.getElementById('add-form');
  if (lead) {
    for (const k of ['business', 'contact', 'phone', 'issue']) document.getElementById(`add-${k}`).value = lead[k] || '';
    document.getElementById('add-emergency').checked = !!lead.emergency;
    document.getElementById('add-source').value = document.getElementById('quick-source').value;
  }
  f.hidden = false;
  f.scrollIntoView({ block: 'nearest' });
}
function keepDraft() {
  if (document.getElementById('paste')) draft = document.getElementById('paste').value;
}
async function saveLead(lead) {
  await api('/api/jobs', 'POST', { ...lead, raw_message: document.getElementById('paste').value.trim() });
  draft = null;
  await load();
  location.hash = 'today';
  render();
  toast(`${lead.business || lead.contact} added. It is on your call list.`);
}

/* ---------- help ---------- */

function helpView() {
  return `${titleRow('Help', 'Three things to know.')}
    <div class="panel"><ol class="steps">
      <li><div><h3>Each morning, open Today</h3><p>It lists who needs a call from you and why. Equipment that is down is at the top.</p></div></li>
      <li><div><h3>Call, then tap "What happened?"</h3><p>Pick what happened from the short list. The job moves on by itself and comes back when someone is waiting on you again.</p></div></li>
      <li><div><h3>New request? Tap New job</h3><p>Paste the text or type what they said. Requests from the website form show up on their own.</p></div></li>
    </ol></div>
    ${S.digest && S.digest.to ? `<div class="panel pad">
      <h2>Your morning email</h2>
      <p class="muted">Your call list is emailed to ${esc(S.digest.to)} every morning at ${S.digest.hour % 12 || 12}:00 ${S.digest.hour < 12 ? 'am' : 'pm'}, ${esc(S.tz.split('/').pop().replace(/_/g, ' '))} time.</p>
      <div class="acts"><button class="btn" id="digest-send">Email me today's list now</button></div>
    </div>` : ''}
    <div class="panel pad">
      <h2>Take the tour</h2>
      <p class="muted">A one-minute walk through the screen, one button at a time.</p>
      <div class="acts"><button class="btn main" id="tour-start">Start the tour</button></div>
    </div>
    <div class="panel pad">
      <h2>Practice with example jobs</h2>
      <p class="muted">Load made-up jobs to try things out. Removing them leaves your real jobs alone.</p>
      <div class="acts"><button class="btn main" id="ex-load">Load example jobs</button><button class="btn" id="ex-remove">Remove example jobs</button></div>
    </div>`;
}

/* ---------- the job sheet ---------- */

function openDlg(html) {
  dlgBody.innerHTML = html;
  if (!dlg.open) dlg.showModal();
}
function closeDlg() {
  if (dlg.open) dlg.close();
}
const dlgHead = (title, sub) => `<div class="dlg-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="small muted" style="margin-top:4px">${sub}</p>` : ''}</div><button class="x" data-close aria-label="Close">&times;</button></div>`;

async function openJob(id) {
  const { job: j, events } = await api(`/api/jobs/${id}`);
  const opts = OPTIONS[j.stage] || [];
  openDlg(`${dlgHead(nameOf(j), `${j.business && j.contact ? esc(j.contact) + ' · ' : ''}${esc(j.issue)}`)}
    <div class="where"><b>${STAGE_LABEL[j.stage]}</b>${visitText(j) && j.stage === 'sched' ? `<span>${esc(visitText(j))}</span>` : ''}${j.quote_amount ? `<span>Quote ${money(j.quote_amount)}</span>` : ''}</div>
    ${j.reason ? `<p class="why">${esc(j.reason.text)}</p>` : ''}
    ${j.phone ? `<a class="btn big" href="tel:${esc(digits(j.phone))}">Call ${esc(phoneText(j.phone))}</a>` : '<p class="err">No phone number yet. Add one under "Fix the details".</p>'}
    ${opts.length ? `<div><h3 style="margin-bottom:8px">What happened?</h3><div class="opts">${opts.map(([a, t], i) => `<button class="opt${i ? '' : ' first'}" data-act="${a}" data-id="${j.id}" data-label="${esc(t)}"><b>${t}</b></button>`).join('')}</div></div>` : ''}
    <details${events.length < 6 ? ' open' : ''}><summary>Notes and history</summary>
      <form id="note-form" data-id="${j.id}" class="row2"><input type="text" id="note" maxlength="500" aria-label="Add a note" placeholder="Add a note, like: try again after lunch"><button class="btn">Save</button></form>
      <ul class="hist">${events.map((e) => `<li><time>${esc(when(e.at))}</time><span>${esc(e.note)}</span></li>`).join('')}</ul>
      <p class="small muted">Came in by ${esc(via(j))}, ${esc(when(j.created_at))}${j.is_example ? ' · example job' : ''}</p>
      ${j.raw_message && !j.raw_message.startsWith('call:') ? `<pre class="mail">${esc(j.raw_message)}</pre>` : ''}
    </details>
    <details><summary>Fix the details</summary>
      <form id="edit-form" data-id="${j.id}" style="display:grid;gap:14px">
        ${leadForm('edit', j)}
        <div class="two"><label>Quote amount in dollars<input type="number" id="edit-amount" min="0" step="1" inputmode="numeric" value="${j.quote_amount || ''}"></label>
        <label>Where it is at<select id="edit-stage">${[...STAGES, ['lost', 'Lost']].map(([k, l]) => `<option value="${k}"${k === j.stage ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <p class="err" id="edit-err" hidden></p>
        <div class="acts"><button class="btn">Save changes</button></div>
      </form>
    </details>`);
}

// Two choices take one more optional detail before saving
function askAction(j, act) {
  const fields = act === 'sent'
    ? `<label>How much was the quote? (optional)<input type="number" id="x-amount" min="0" step="1" inputmode="numeric" value="${j.quote_amount || ''}"></label>`
    : `<label>What day? (optional)<input type="date" id="x-date" value="${esc(j.slot_date || '')}" style="height:40px;border:1px solid var(--control);border-radius:7px;padding:0 12px"></label>
       <label>Which tech? (optional)<input type="text" id="x-tech" maxlength="60" value="${esc(j.tech)}"></label>`;
  openDlg(`${dlgHead(act === 'sent' ? 'Quote sent' : 'Scheduled', esc(nameOf(j)))}
    <form id="act-form" data-id="${j.id}" data-act="${act}" style="display:grid;gap:14px">${fields}
      <div class="acts"><button class="btn main">Save</button><button class="btn" type="button" data-close>Cancel</button></div>
    </form>`);
}

async function doAction(id, act, extra = {}) {
  const j = jobById(id);
  await api(`/api/jobs/${id}/action`, 'POST', { action: act, ...extra });
  closeDlg();
  await load();
  render();
  toast(`${j ? nameOf(j) + ': ' : ''}${AFTER[act] || 'Saved.'}`);
}

/* ---------- the tour: points at one thing at a time ---------- */

// [what to point at, title, what it says]. Steps whose target is not on screen are skipped.
const TOUR = [
  ['', 'Welcome, {name}', 'This is your morning screen. It takes about a minute to show you around.'],
  ['#main .call', 'Who to call', 'Everyone who is waiting on you, most urgent first. Each row says who it is and why they need a call.'],
  ['#main .call .acts a.btn', 'Call', 'Tap this to ring them. On your phone it dials the number for you.'],
  ['#main .call .acts .btn.main', 'What happened?', 'After the call, tap this and pick from a short list, like "I sent the quote" or "They said yes". The job moves on by itself.'],
  ['#main .pipe', 'Where each job is at', 'Every open job, counted by step. Tap a step to see the jobs in it.'],
  ['#nav [data-view="jobs"]', 'Jobs', 'Every job in one place. Find a customer by name or phone, and see how many jobs are open.'],
  ['#nav [data-view="add"]', 'New job', 'Got a call or a text? Paste it or type what they said. It goes straight onto your call list.'],
  ['#tour', 'That is it', 'Open Today each morning and start at the top. You can run this tour again any time from here.'],
];
let tourAt = -1;
let tourEl = null;

function tourSeen() {
  try { return !!localStorage.getItem('ml_tour'); } catch { return true; }
}
function startTour() {
  closeDlg();
  if (view() !== 'today') location.hash = 'today';
  // let the Today screen draw before pointing at it
  setTimeout(() => {
    if (!tourEl) {
      tourEl = document.createElement('div');
      tourEl.className = 'tour';
      tourEl.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
      document.body.appendChild(tourEl);
    }
    tourStep(0, 1);
  }, 60);
}
function endTour() {
  try { localStorage.setItem('ml_tour', '1'); } catch {}
  if (tourEl) tourEl.remove();
  tourEl = null;
  tourAt = -1;
}
const tourTarget = (i) => (TOUR[i][0] ? document.querySelector(TOUR[i][0]) : null);
function tourStep(i, dir) {
  while (TOUR[i] && TOUR[i][0] && !tourTarget(i)) i += dir;
  if (!TOUR[i]) return endTour();
  tourAt = i;
  const el = tourTarget(i);
  if (el) el.scrollIntoView({ block: 'center' });
  const last = !TOUR.slice(i + 1).some((s, k) => !s[0] || tourTarget(i + 1 + k));
  tourEl.querySelector('.tour-card').innerHTML = `<small>${i + 1} of ${TOUR.length}</small>
    <h3>${esc(TOUR[i][1].replace('{name}', S.name || 'there'))}</h3><p>${esc(TOUR[i][2])}</p>
    <div class="acts">${i ? '<button class="btn" data-tour="-1">Back</button>' : ''}<button class="btn main" data-tour="1">${last ? 'Done' : i ? 'Next' : 'Show me'}</button>${last ? '' : '<button class="txt" data-tour="0">Skip</button>'}</div>`;
  placeTour();
  tourEl.querySelector('[data-tour="1"]').focus({ preventScroll: true });
}
function placeTour() {
  if (!tourEl) return;
  const hole = tourEl.querySelector('.tour-hole');
  const card = tourEl.querySelector('.tour-card');
  const el = tourTarget(tourAt);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el) {
    Object.assign(hole.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
    Object.assign(card.style, { left: Math.max(12, (vw - card.offsetWidth) / 2) + 'px', top: Math.max(12, (vh - card.offsetHeight) / 2) + 'px' });
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  // below the target when there is room, otherwise above it
  const below = r.bottom + pad + 12;
  const top = below + card.offsetHeight < vh - 12 ? below : Math.max(12, r.top - pad - 12 - card.offsetHeight);
  const left = Math.min(Math.max(12, r.left), vw - card.offsetWidth - 12);
  Object.assign(card.style, { left: left + 'px', top: top + 'px' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tour]');
  if (!b) return;
  const d = Number(b.dataset.tour);
  if (!d) return endTour();
  tourStep(tourAt + d, d);
});
document.addEventListener('keydown', (e) => {
  if (!tourEl) return;
  if (e.key === 'Escape') endTour();
  if (e.key === 'ArrowRight') tourStep(tourAt + 1, 1);
  if (e.key === 'ArrowLeft' && tourAt > 0) tourStep(tourAt - 1, -1);
});
window.addEventListener('resize', placeTour);
window.addEventListener('scroll', placeTour, { passive: true });

/* ---------- routing and events ---------- */

function view() {
  const v = location.hash.slice(1);
  return ['today', 'jobs', 'add', 'help'].includes(v) ? v : 'today';
}
function render() {
  const v = view();
  document.querySelectorAll('[data-view]').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const count = document.getElementById('nav-count');
  count.textContent = S.numbers.to_call || '';
  count.hidden = !S.numbers.to_call;
  main.innerHTML = { today: todayView, jobs: jobsView, add: addView, help: helpView }[v]();
  if (v === 'add' && draft) document.getElementById('paste').value = draft;
}

async function guard(fn, errEl) {
  try {
    await fn();
  } catch (ex) {
    if (errEl) {
      errEl.textContent = ex.message;
      errEl.hidden = false;
    } else toast(ex.message);
  }
}

document.addEventListener('click', (e) => {
  if (e.target === dlg) return closeDlg();
  const t = e.target.closest('[data-act],[data-open],[data-close],[data-filter],[data-call],button[id]');
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) return closeDlg();
  // Tapping Call also opens the job, so "What happened?" is waiting when she comes back
  if (d.call) return guard(() => openJob(d.call));
  if (d.filter !== undefined) {
    const onJobs = view() === 'jobs';
    jobsFilter = onJobs && jobsFilter === d.filter ? '' : d.filter;
    search = '';
    if (onJobs) return render();
    location.hash = 'jobs';
    return;
  }
  if (d.open) return guard(() => openJob(d.open));
  if (d.act && t.tagName === 'BUTTON') {
    const j = jobById(d.id);
    if (!j) return;
    if (d.act === 'sent' || d.act === 'sched') return askAction(j, d.act);
    t.disabled = true;
    return guard(() => doAction(j.id, d.act, d.act === 'lost' ? { reason: d.label } : {}));
  }
  if (t.id === 'logout') return guard(async () => { await api('/api/logout', 'POST'); location.href = '/login'; });
  if (t.id === 'tour' || t.id === 'tour-start') return startTour();
  if (t.id === 'digest-send') {
    t.disabled = true;
    return guard(async () => {
      try {
        const r = await api('/api/digest/send', 'POST');
        toast(`Sent to ${r.to}. Check your inbox.`);
      } finally {
        t.disabled = false;
      }
    });
  }
  if (t.id === 'by-hand') return showForm();
  if (t.id === 'quick-add') {
    const err = document.getElementById('quick-err');
    err.hidden = true;
    t.disabled = true;
    t.textContent = 'Reading...';
    return guard(async () => {
      try {
        const r = await api('/api/parse', 'POST', { text: document.getElementById('paste').value.trim() });
        const lead = { business: r.business, contact: r.contact, phone: r.phone, issue: r.issue, emergency: !!r.emergency, source: document.getElementById('quick-source').value };
        if (lead.phone && lead.issue && (lead.business || lead.contact)) return await saveLead(lead);
        showForm(lead);
        throw new Error(lead.phone ? 'I could not tell who this is. Fill in the name below, then add it.' : 'I could not find a phone number. Add it below so you can call them back.');
      } finally {
        t.disabled = false;
        t.textContent = 'Add to the list';
      }
    }, err);
  }
  if (t.id === 'ex-load' || t.id === 'ex-remove') {
    t.disabled = true;
    return guard(async () => {
      await api('/api/examples', 'POST', { action: t.id === 'ex-load' ? 'load' : 'remove' });
      await load();
      location.hash = 'today';
      render();
      toast(t.id === 'ex-load' ? 'Example jobs loaded.' : 'Example jobs removed.');
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  search = e.target.value;
  document.getElementById('joblist').innerHTML = jobList();
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'add-form') return guard(() => saveLead(readForm('add')), document.getElementById('add-err'));
  if (f.id === 'act-form') {
    const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
    const extra = f.dataset.act === 'sent' ? { amount: val('x-amount') } : { date: val('x-date'), tech: val('x-tech') };
    return guard(() => doAction(f.dataset.id, f.dataset.act, extra));
  }
  if (f.id === 'edit-form') {
    return guard(async () => {
      const id = f.dataset.id;
      const j = jobById(id);
      await api(`/api/jobs/${id}`, 'PATCH', { ...readForm('edit'), quote_amount: document.getElementById('edit-amount').value || 0 });
      const stage = document.getElementById('edit-stage').value;
      if (j && stage !== j.stage) await api(`/api/jobs/${id}/action`, 'POST', { action: 'move', stage });
      closeDlg();
      await load();
      render();
      toast('Saved.');
    }, document.getElementById('edit-err'));
  }
  if (f.id === 'note-form') {
    return guard(async () => {
      await api(`/api/jobs/${f.dataset.id}/action`, 'POST', { action: 'note', note: document.getElementById('note').value });
      await openJob(f.dataset.id);
      toast('Note saved.');
    });
  }
});

window.addEventListener('hashchange', () => {
  keepDraft();
  render();
  window.scrollTo(0, 0);
});

(async function start() {
  try {
    await load();
    render();
    // First visit: show the tour once. It is always there under Tour.
    if (!tourSeen()) startTour();
  } catch (ex) {
    main.innerHTML = `<div class="panel empty"><b>Could not load your list</b>${esc(ex.message)}</div>`;
  }
})();
