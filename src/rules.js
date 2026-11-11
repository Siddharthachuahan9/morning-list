// The rules that decide who goes on the morning call list, and the numbers line.

export const STAGES = {
  new: 'New',
  quote: 'Waiting on quote',
  sent: 'Waiting on their yes',
  yes: 'Needs scheduling',
  sched: 'Scheduled',
  done: 'Done',
  lost: 'Lost',
};
export const OPEN = ['new', 'quote', 'sent', 'yes', 'sched'];

// Sample crew and the working day cut into two-hour visits
export const TECHS = ['Andre', 'Maya', 'Luis', 'Sam'];
export const SLOTS = [
  { start: '08:00', label: '8 to 10 am' },
  { start: '10:00', label: '10 am to 12' },
  { start: '12:00', label: '12 to 2 pm' },
  { start: '14:00', label: '2 to 4 pm' },
  { start: '16:00', label: '4 to 6 pm' },
];

// YYYY-MM-DD for a moment in time, in the owner's timezone
export function localDate(d, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Whole calendar days between an ISO timestamp and now, in the owner's timezone
export function dayDiff(iso, now, tz) {
  const a = Date.parse(localDate(new Date(iso), tz) + 'T00:00:00Z');
  const b = Date.parse(localDate(now, tz) + 'T00:00:00Z');
  return Math.round((b - a) / 864e5);
}

function ago(n) {
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}
function days(n) {
  return `${n} day${n === 1 ? '' : 's'}`;
}

// Returns { rank, text } when the job belongs on today's call list, else null.
// Lower rank is more urgent. A job gets the first rule that matches.
export function reason(job, now, tz) {
  const n = dayDiff(job.last_contact_at, now, tz);
  if (job.stage === 'new') {
    const came = ago(dayDiff(job.created_at, now, tz));
    if (job.emergency) return { rank: 0, group: 'now', text: `${job.issue.replace(/\.+$/, '')}. Came in ${came}. ${job.last_attempt_at ? 'Called, no answer yet.' : 'Nobody has called back.'}` };
    return { rank: 1, group: 'you', text: `New request, came in ${came}. Not called yet.` };
  }
  if (job.stage === 'yes') return { rank: 2, group: 'you', text: 'Said yes. Needs scheduling.' };
  if (job.stage === 'quote' && n >= 1) return { rank: 3, group: 'you', text: `Waiting on your quote for ${days(n)}` };
  if (job.stage === 'sent' && n >= 2) return { rank: 4, group: 'them', text: `Quote sent ${days(n)} ago, no answer` };
  if (job.stage === 'sched' && job.slot_date && job.slot_date < localDate(now, tz)) {
    return { rank: 5, group: 'you', text: 'The visit date has passed. Is this job done?' };
  }
  return null;
}

export function decorate(jobs, now, tz) {
  const today = localDate(now, tz);
  return jobs.map((j) => ({
    ...j,
    days: dayDiff(j.last_contact_at, now, tz),
    reason: reason(j, now, tz),
    tried_today: !!j.last_attempt_at && localDate(new Date(j.last_attempt_at), tz) === today,
  }));
}

export function callList(decorated) {
  return decorated
    .filter((j) => j.reason)
    .sort((a, b) => a.reason.rank - b.reason.rank || a.last_contact_at.localeCompare(b.last_contact_at));
}

export function numbers(decorated, now, tz) {
  const month = localDate(now, tz).slice(0, 7);
  const inMonth = (j) => localDate(new Date(j.stage_changed_at), tz).slice(0, 7) === month;
  const sum = (list) => list.reduce((s, j) => s + (j.quote_amount || 0), 0);
  const won = decorated.filter((j) => j.stage === 'done' && inMonth(j));
  const lost = decorated.filter((j) => j.stage === 'lost' && inMonth(j));
  return {
    to_call: decorated.filter((j) => j.reason).length,
    open: decorated.filter((j) => OPEN.includes(j.stage)).length,
    quotes_out: sum(decorated.filter((j) => j.stage === 'sent')),
    done_month: won.length,
    done_month_value: sum(won),
    lost_month: lost.length,
  };
}

// The 7 am email, as plain text
export function digest(decorated, now, tz, name, url = '') {
  const list = callList(decorated);
  const nums = numbers(decorated, now, tz);
  const money = (n) => '$' + n.toLocaleString('en-US');
  const lines = [`Good morning ${name}.`, ''];
  if (!list.length) {
    lines.push('Nobody is waiting on you today.');
  } else {
    lines.push(`You have ${list.length} ${list.length === 1 ? 'person' : 'people'} to call today:`, '');
    list.forEach((j, i) => {
      lines.push(`${i + 1}. ${j.business || j.contact || 'Unknown'}${j.contact && j.business ? ` (${j.contact})` : ''}${j.phone ? `, ${j.phone}` : ''}`);
      lines.push(`   ${j.reason.text}`);
    });
  }
  lines.push('', `Open jobs: ${nums.open}. Quotes out: ${money(nums.quotes_out)}. Done this month: ${nums.done_month} (${money(nums.done_month_value)}).`);
  const subject = list.length ? `${list.length} ${list.length === 1 ? 'person' : 'people'} to call today` : 'Nobody is waiting on you today';
  return { subject, text: lines.join('\n'), html: digestHtml(list, nums, name, url) };
}

// The same list as the Today screen, as an email: name, why, and a number she can tap
function digestHtml(list, nums, name, url) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const money = (n) => '$' + n.toLocaleString('en-US');
  const tel = (p) => String(p || '').replace(/[^\d+]/g, '');
  const rows = list.map((j) => `<tr><td style="padding:14px 0;border-top:1px solid #dfe7eb;">
    <div style="font-size:17px;font-weight:600;color:#0f1a21;">${esc(j.business || j.contact || 'Unknown')}${j.business && j.contact ? ` <span style="font-weight:400;color:#53626c;">(${esc(j.contact)})</span>` : ''}</div>
    <div style="font-size:15px;color:${j.reason.rank === 0 ? '#831c1e' : '#0f1a21'};padding-top:2px;">${esc(j.reason.text)}</div>
    ${j.phone ? `<div style="padding-top:6px;"><a href="tel:${esc(tel(j.phone))}" style="color:#0a4a5c;font-weight:600;">Call ${esc(j.phone)}</a></div>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px 16px;background:#f5f9fa;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1a21;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe7eb;border-radius:10px;"><tr><td style="padding:24px;">
<div style="font-size:22px;font-weight:700;">Good morning ${esc(name)}.</div>
<div style="font-size:16px;color:#53626c;padding:6px 0 14px;">${list.length ? `You have ${list.length} ${list.length === 1 ? 'person' : 'people'} to call today. Start at the top.` : 'Nobody is waiting on you today.'}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<div style="border-top:1px solid #dfe7eb;padding-top:14px;font-size:14px;color:#53626c;">Open jobs: ${nums.open}. Quotes waiting on a yes: ${money(nums.quotes_out)}. Done this month: ${money(nums.done_month_value)}.</div>
${url ? `<div style="padding-top:18px;"><a href="${esc(url)}" style="display:inline-block;background:#13202a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:7px;">Open Morning List</a></div>` : ''}
</td></tr></table></body></html>`;
}
