// Example jobs, dated relative to now so the demo always reads like a real morning.
import { localDate, SLOTS } from './rules.js';

const H = 3600e3;
const D = 24 * H;

export function exampleJobs(now, tz) {
  const t = (ms) => new Date(now.getTime() - ms).toISOString();
  const today = localDate(now, tz);
  const tomorrow = localDate(new Date(now.getTime() + D), tz);
  return [
    {
      business: 'Bella Cucina', contact: 'Marco', phone: '(312) 555-0142', issue: 'Walk-in freezer down', source: 'Phone',
      emergency: 1, stage: 'new', created: t(3 * D), contact_at: t(3 * D),
      raw: 'Marco called the office line late in the day. Walk-in freezer is down, product is thawing.',
      events: [[t(3 * D), 'Added from a phone call']],
    },
    {
      business: 'Golden Wok', contact: 'Amy', phone: '(312) 555-0177', issue: 'Reach-in cooler running warm, 45°F', source: 'Website form',
      emergency: 0, stage: 'new', created: t(10 * H), contact_at: t(10 * H),
      raw: 'Our reach-in cooler by the line is running warm, reading 45. Can someone take a look this week?',
      events: [[t(10 * H), 'Came in from the website form']],
    },
    {
      business: "Lupita's Taqueria", contact: 'Lupita', phone: '(312) 555-0119', issue: 'Replace door gasket and fan motor', source: 'Text',
      emergency: 0, stage: 'yes', amount: 850, created: t(6 * D), contact_at: t(2 * D), changed: t(2 * D),
      events: [[t(6 * D), 'Added from a text'], [t(5 * D), 'Called them'], [t(4 * D), 'Quote sent ($850)'], [t(2 * D), 'They said yes']],
    },
    {
      business: 'Harbor Fresh Market', contact: 'Dan', phone: '(312) 555-0163', issue: 'Ice machine not making ice', source: 'Phone',
      emergency: 0, stage: 'quote', created: t(5 * D), contact_at: t(4 * D), changed: t(4 * D),
      events: [[t(5 * D), 'Added from a phone call'], [t(4 * D), 'Called them. Site visit done, they want a quote.']],
    },
    {
      business: 'Dockside Warehouse', contact: 'Priya', phone: '(312) 555-0108', issue: 'Compressor replacement on cooler 2', source: 'Referral',
      emergency: 0, stage: 'sent', amount: 3400, created: t(8 * D), contact_at: t(5 * D), changed: t(5 * D),
      events: [[t(8 * D), 'Added from a referral'], [t(7 * D), 'Called them'], [t(5 * D), 'Quote sent ($3,400)']],
    },
    {
      business: 'Pier 9 Oyster Bar', contact: 'Sam', phone: '(312) 555-0131', issue: 'Walk-in cooler service plan', source: 'Text',
      emergency: 0, stage: 'sent', amount: 2100, created: t(3 * D), contact_at: t(1 * D), changed: t(1 * D),
      events: [[t(3 * D), 'Added from a text'], [t(2 * D), 'Called them'], [t(1 * D), 'Quote sent ($2,100)']],
    },
    {
      business: 'Corner Deli', contact: 'Rosa', phone: '(312) 555-0155', issue: 'Deli case thermostat', source: 'Phone',
      emergency: 0, stage: 'sched', amount: 600, tech: 'Andre', slot_date: tomorrow, slot: 1, created: t(6 * D), contact_at: t(1 * D), changed: t(1 * D),
      events: [[t(6 * D), 'Added from a phone call'], [t(4 * D), 'Quote sent ($600)'], [t(2 * D), 'They said yes'], [t(1 * D), 'Scheduled with Andre']],
    },
    {
      business: 'Fresh Fare Grocery', contact: 'Nia', phone: '(312) 555-0171', issue: 'Dairy case compressor check', source: 'Repeat customer',
      emergency: 0, stage: 'sched', amount: 450, tech: 'Maya', slot_date: today, slot: 0, created: t(4 * D), contact_at: t(1 * D), changed: t(1 * D),
      events: [[t(4 * D), 'Added (repeat customer)'], [t(3 * D), 'Quote sent ($450)'], [t(2 * D), 'They said yes'], [t(1 * D), 'Booked Maya']],
    },
    {
      business: 'Riverside Cold Storage', contact: 'Owen', phone: '(312) 555-0114', issue: 'Blast freezer door heater replacement', source: 'Phone',
      emergency: 0, stage: 'sched', amount: 1850, tech: 'Luis', slot_date: today, slot: 1, created: t(7 * D), contact_at: t(2 * D), changed: t(2 * D),
      events: [[t(7 * D), 'Added from a phone call'], [t(5 * D), 'Quote sent ($1,850)'], [t(3 * D), 'They said yes'], [t(2 * D), 'Booked Luis']],
    },
    {
      business: 'Blue Door Bistro', contact: 'Elena', phone: '(312) 555-0137', issue: 'Ice machine deep clean and filter', source: 'Text',
      emergency: 0, stage: 'sched', amount: 320, tech: 'Andre', slot_date: today, slot: 2, created: t(5 * D), contact_at: t(1 * D), changed: t(1 * D),
      events: [[t(5 * D), 'Added from a text'], [t(4 * D), 'Quote sent ($320)'], [t(2 * D), 'They said yes'], [t(1 * D), 'Booked Andre']],
    },
    {
      business: 'Sunrise Bakery', contact: 'Theo', phone: '(312) 555-0190', issue: 'Freezer defrost timer replaced', source: 'Website form',
      emergency: 0, stage: 'done', amount: 1200, tech: 'Maya', created: t(9 * D), contact_at: t(2 * D), changed: t(2 * D),
      events: [[t(9 * D), 'Came in from the website form'], [t(7 * D), 'Quote sent ($1,200)'], [t(6 * D), 'They said yes'], [t(2 * D), 'Job done']],
    },
    {
      business: 'Main Street Diner', contact: 'Hank', phone: '(312) 555-0126', issue: 'Walk-in cooler not holding temperature', source: 'Phone',
      emergency: 1, stage: 'lost', lost_reason: 'Went with someone else', created: t(7 * D), contact_at: t(4 * D), changed: t(4 * D),
      events: [[t(7 * D), 'Added from a phone call'], [t(4 * D), 'Lost: Went with someone else']],
    },
  ];
}

export async function loadExamples(env, now, tz) {
  await removeExamples(env);
  for (const j of exampleJobs(now, tz)) {
    const row = await env.DB.prepare(
      `INSERT INTO jobs (business, contact, phone, issue, source, emergency, stage, quote_amount, tech, scheduled_for, lost_reason, raw_message, is_example, created_at, last_contact_at, stage_changed_at, slot_date, slot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING id`
    )
      .bind(j.business, j.contact, j.phone, j.issue, j.source, j.emergency, j.stage, j.amount || 0, j.tech || '', j.slot_date ? `${j.slot_date}T${SLOTS[j.slot].start}` : '', j.lost_reason || '', j.raw || '', j.created, j.contact_at, j.changed || j.created, j.slot_date || '', j.slot ?? -1)
      .first();
    await env.DB.batch(j.events.map(([at, note]) => env.DB.prepare('INSERT INTO events (job_id, at, note) VALUES (?, ?, ?)').bind(row.id, at, note)));
  }
}

export async function removeExamples(env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE job_id IN (SELECT id FROM jobs WHERE is_example = 1)'),
    env.DB.prepare('DELETE FROM jobs WHERE is_example = 1'),
  ]);
}
