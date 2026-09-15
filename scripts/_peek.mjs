import './_q.mjs';
const base = process.env.ONSINCH_BASE_URL, key = process.env.ONSINCH_API_KEY;
const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `apikey ${key}`, Accept: 'application/json' } });
  return r.ok ? r.json() : { http: r.status };
};
const a = await get(`/timelineAudits?data[like]=${encodeURIComponent('%Order:15769%')}&limit=4`);
console.log(JSON.stringify(a.data?.slice(0, 2), null, 1).slice(0, 2200));
console.log('\nkeys:', Object.keys(a.data?.[0] ?? {}).join(', '));
