module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, business, message, email, phone, website } = req.body || {};

  if (website) return res.status(200).json({ ok: true });

  if (!name || (!email && !phone)) {
    return res.status(400).json({ error: 'Name and an email or phone are required.' });
  }

  const headers = {
    Authorization: `Bearer ${process.env.GHL_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const [firstName, ...rest] = String(name).trim().split(' ');
    const tags = ['website-lead', 'free-audit'];
    if (business) tags.push('business-' + String(business).toLowerCase().replace(/\s+/g, '-'));

    const r = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        firstName,
        lastName: rest.join(' '),
        email: email || undefined,
        phone: phone || undefined,
        source: 'SureBuilt Labs website',
        tags,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('GHL upsert failed', r.status, data);
      return res.status(502).json({ error: 'Could not save your request.' });
    }

    const contactId = data.contact && data.contact.id;
    if (contactId && message) {
      const n = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
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
