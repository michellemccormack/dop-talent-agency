// functions/_lib/airtable.js
// Lightweight Airtable REST helper (no SDK required)

const API = "https://api.airtable.com/v0";

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

const base = process.env.AIRTABLE_BASE_ID;
const table = process.env.AIRTABLE_TABLE_NAME || "Dops";

async function create(fields) {
  const r = await fetch(`${API}/${base}/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Airtable create failed");
  return j.records[0]; // { id, fields }
}

async function update(id, fields) {
  const r = await fetch(`${API}/${base}/${encodeURIComponent(table)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ records: [{ id, fields }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Airtable update failed");
  return j.records[0];
}

async function get(id) {
  const r = await fetch(`${API}/${base}/${encodeURIComponent(table)}/${id}`, {
    headers: headers(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Airtable get failed");
  return j; // { id, fields }
}

module.exports = { airtable: { create, update, get }, table };
