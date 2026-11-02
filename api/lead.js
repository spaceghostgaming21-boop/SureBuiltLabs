// Vercel serverless function: POST /api/lead
// Creates or updates a GoHighLevel contact, fills the Website Leads custom fields,
// adds tags and saves the visitor's message as a note.
// Needs these Vercel environment variables: GHL_TOKEN, GHL_LOCATION_ID
// The Private Integration also needs scopes for contacts (view + edit) and custom fields (view).

const API = 'https://services.leadconnectorhq.com';
const BUSINESS_TYPES = ['Roofing', 'HVAC', 'Dental', 'Legal', 'E-commerce', 'Other'];

// Remembered between calls while the function stays warm, so we look the IDs up only once.
let fieldCache = null;

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

async function getFieldIds(headers) {
  if (fieldCache) return fieldCache;
  try {
    const r = await fetch(`${API}/locations/${process.env.GHL_LOCATION_ID}/customFields?model=contact`, { headers });
    const d = await r.json();
    if (!r.ok) throw new Error(`lookup ${r.status} ${JSON.stringify(d)}`);
    const list = d.customFields || [];
    const find = (label) => {
      const f = list.find((x) => String(x.name || '').trim().toLowerCase() === label.toLowerCase());
      return f && f.id;
    };
    const ids = {
      business: find('Business type'),
      slip: find('Where leads slip through'),
      source: find('Lead source'),
    };
    if (!ids.business || !ids.slip || !ids.source) {
      console.error('Some custom fields were not found by name', ids);
    }
    fieldCache = ids;
    return ids;
  } catch (err) {
    // Do not lose the lead if the lookup fails: the contact is still created below.
    console.error('Custom field lookup failed', err);
    return {};
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  if (body.website) return res.status(200).json({ ok: true }); // hidden field filled in: a bot

  const name = clip(body.name, 120);
  const email = clip(body.email, 200);
  const phone = clip(body.phone, 30);
  const message = clip(body.message, 2000);
  const business = BUSINESS_TYPES.includes(body.business) ? body.business : 'Other';

  if (!name || (!email && !phone)) {
    return res.status(400).json({ error: 'Name and an email or phone are required.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }

  const headers = {
    Authorization: `Bearer ${process.env.GHL_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const [firstName, ...rest] = name.split(' ');
    const tags = ['website-lead', 'free-audit', 'business-' + business.toLowerCase()];

    const ids = await getFieldIds(headers);
    const customFields = [];
    if (ids.business) customFields.push({ id: ids.business, field_value: business });
    if (ids.slip && message) customFields.push({ id: ids.slip, field_value: message });
    if (ids.source) customFields.push({ id: ids.source, field_value: 'Form' });

    const payload = {
      locationId: process.env.GHL_LOCATION_ID,
      firstName,
      lastName: rest.join(' '),
      email: email || undefined,
      phone: phone || undefined, // already in international format (+63...) from the form
      source: 'SureBuilt Labs website',
      tags,
    };
    if (customFields.length) payload.customFields = customFields;

    const r = await fetch(`${API}/contacts/upsert`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('GHL upsert failed', r.status, data);
      return res.status(502).json({ error: 'Could not save your request.' });
    }

    const contactId = data.contact && data.contact.id;
    if (contactId && message) {
      const n = await fetch(`${API}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: `Business type: ${business}\n\n${message}` }),
      });
      if (!n.ok) console.error('GHL note failed', n.status, await n.text());
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
