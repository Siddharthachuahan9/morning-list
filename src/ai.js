// Turns a pasted text, a typed line or a web form message into lead fields.
// Workers AI does the reading. If it fails, a keyword check fills in what it can.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM = `You read messages sent to a commercial refrigeration repair company (walk-in coolers, freezers, ice machines) and pull out the lead details.
Return JSON only with these keys:
- business: the customer's business name, or "" if not given
- contact: the person's name, or "" if not given
- phone: their phone number as written, or "" if not given
- issue: what they need, in 6 to 14 plain words a repair tech could act on, no names. Include the equipment, how many units, any temperature reading and what is at risk. Examples: "Walk-in cooler not cooling, at 50F, fish at risk, wants a visit today" or "Wants a quote for a yearly maintenance plan on 3 walk-ins"
- emergency: true if equipment is down, not cooling, warming up, leaking, or food or product is at risk, or they need someone today. false for quotes, maintenance and routine work.
Never invent details that are not in the message.`;

const SCHEMA = {
  type: 'object',
  properties: {
    business: { type: 'string' },
    contact: { type: 'string' },
    phone: { type: 'string' },
    issue: { type: 'string' },
    emergency: { type: 'boolean' },
  },
  required: ['business', 'contact', 'phone', 'issue', 'emergency'],
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function keywordParse(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const phone = (flat.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\b\d{3}[-.\s]\d{4}\b/) || [''])[0];
  const who = flat.match(/(?:its|it's|this is|i'm|im)\s+([A-Za-z]+)\s+(?:from|at|with)\s+([A-Z][\w'&]*(?:\s[A-Z][\w'&]*)*)/i);
  const emergency = /\b(down|not cooling|isn'?t cooling|warm|melting|leak|asap|urgent|emergency|today|right away)\b/i.test(flat);
  return {
    business: who ? who[2] : '',
    contact: who ? who[1][0].toUpperCase() + who[1].slice(1) : '',
    phone,
    issue: flat.length > 80 ? flat.slice(0, 77) + '...' : flat,
    emergency,
  };
}

export async function parseLead(env, text) {
  const fallback = keywordParse(text);
  try {
    const out = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.slice(0, 2000) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      max_tokens: 300,
      temperature: 0,
    });
    let o = out && out.response;
    if (typeof o === 'string') o = JSON.parse(o.slice(o.indexOf('{'), o.lastIndexOf('}') + 1));
    if (!o || typeof o !== 'object') throw new Error('no JSON from model');
    return {
      business: str(o.business, 120),
      contact: str(o.contact, 80),
      phone: str(o.phone, 40) || fallback.phone,
      issue: str(o.issue, 200) || fallback.issue,
      emergency: o.emergency === true || o.emergency === 'true',
      ai: true,
    };
  } catch (err) {
    console.error('AI parse failed, used keyword check:', err && err.message);
    return { ...fallback, ai: false };
  }
}
