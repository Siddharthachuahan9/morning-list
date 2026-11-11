// Twilio webhooks: missed calls, voicemails and texts become leads on their own.
// Twilio posts form-encoded bodies and expects TwiML (XML) back for calls.
import { parseLead } from './ai.js';

const x = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const twiml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'content-type': 'text/xml' } });

async function transcribe(env, recordingUrl) {
  const headers = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? { authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`) } : {};
  const res = await fetch(recordingUrl, { headers });
  if (!res.ok) throw new Error(`could not download the recording (${res.status})`);
  const out = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(await res.arrayBuffer())] });
  return (out.text || '').trim();
}

export async function phone(req, env, url, createJob, addEvent, findOpenByPhone) {
  const form = Object.fromEntries(new URLSearchParams(await req.text()));
  const step = url.pathname.split('/').pop();
  const key = `key=${encodeURIComponent(env.INTAKE_KEY)}`;
  const base = `${url.origin}/api/phone`;
  const from = form.From || url.searchParams.get('from') || '';
  const sid = form.CallSid || url.searchParams.get('sid') || '';

  // A missed call is a lead straight away. The voicemail fills in the details when it arrives.
  const stamp = () => new Date().toISOString();
  const missed = async () => {
    const open = await findOpenByPhone(env, from);
    if (open) return addEvent(env, open.id, 'Called again, missed', stamp());
    return createJob(env, { business: '', contact: '', phone: from, issue: 'Missed call, no message yet', source: 'Missed call', emergency: false, raw_message: `call:${sid}` }, 'Missed call');
  };
  const record = `<Say>You have reached ${x(env.BUSINESS_NAME)}. We cannot take your call right now. After the tone, tell us your name, your business and what is wrong, and we will call you back.</Say>`
    + `<Record maxLength="120" playBeep="true" action="${x(`${base}/bye?${key}`)}" recordingStatusCallback="${x(`${base}/voicemail?${key}&from=${encodeURIComponent(from)}&sid=${encodeURIComponent(sid)}`)}"/>`;

  if (step === 'call') {
    if (env.FORWARD_TO) return twiml(`<Dial timeout="20" action="${x(`${base}/missed?${key}`)}">${x(env.FORWARD_TO)}</Dial>`);
    await missed();
    return twiml(record);
  }
  if (step === 'missed') {
    if (form.DialCallStatus === 'completed') return twiml('<Hangup/>');
    await missed();
    return twiml(record);
  }
  if (step === 'bye') return twiml('<Say>Thank you. We will call you back.</Say><Hangup/>');

  if (step === 'voicemail') {
    let text = '';
    try {
      text = await transcribe(env, form.RecordingUrl);
    } catch (err) {
      console.error('Voicemail transcription failed:', err && err.message);
    }
    const read = text ? await parseLead(env, text) : { business: '', contact: '', issue: 'Left a voicemail. Listen to it in Twilio.', emergency: false };
    const now = new Date().toISOString();
    const job = await env.DB.prepare('SELECT id FROM jobs WHERE raw_message = ?').bind(`call:${sid}`).first();
    const raw = text ? `Voicemail: ${text}` : 'Voicemail (could not be transcribed)';
    if (job) {
      await env.DB.prepare("UPDATE jobs SET business = ?, contact = ?, issue = ?, emergency = ?, source = 'Voicemail', raw_message = ? WHERE id = ?")
        .bind(read.business, read.contact, read.issue, read.emergency ? 1 : 0, raw, job.id)
        .run();
      await addEvent(env, job.id, 'Left a voicemail', now);
    } else if (await findOpenByPhone(env, from)) {
      const open = await findOpenByPhone(env, from);
      await addEvent(env, open.id, raw, now);
      if (read.emergency) await env.DB.prepare('UPDATE jobs SET emergency = 1 WHERE id = ?').bind(open.id).run();
    } else {
      await createJob(env, { business: read.business, contact: read.contact, phone: from, issue: read.issue, source: 'Voicemail', emergency: read.emergency, raw_message: raw }, 'Left a voicemail');
    }
    return new Response('ok');
  }

  if (step === 'text') {
    const body = (form.Body || '').trim().slice(0, 2000);
    const open = body && (await findOpenByPhone(env, from));
    if (open) await addEvent(env, open.id, `Texted: ${body.slice(0, 300)}`, stamp());
    else if (body) {
      const read = await parseLead(env, body);
      await createJob(env, { business: read.business, contact: read.contact, phone: from, issue: read.issue, source: 'Text', emergency: read.emergency, raw_message: body }, 'Texted the business number');
    }
    return twiml('');
  }
  return new Response('Not found', { status: 404 });
}
