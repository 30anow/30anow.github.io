// Regenerates e/<id>.html — one tiny share stub per upcoming event.
// Crawlers (iMessage, Facebook, Slack…) read the OG tags and unfurl a real
// card; humans get an instant redirect to the live event page. Runs on a
// schedule after the event imports land (see .github/workflows/share-cards.yml).
import { mkdir, rm, writeFile } from 'node:fs/promises';

// The PUBLIC client credentials — identical to what the web app ships in
// its bundle. Anonymous reads see approved events only (enforced by RLS).
const SUPABASE_URL = 'https://jbswxdkcpjjbqulsykvu.supabase.co';
const ANON_KEY = 'sb_publishable_DXTI_TsCspkSefpj61a1tA_ufCj7GMQ';
const SITE = 'https://30anow.github.io';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtWhen = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', // beach time, always
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/events` +
    `?select=id,title,venue,area,starts_at` +
    `&ends_at=gte.${since}&order=starts_at&limit=1000`,
  { headers: { apikey: ANON_KEY } },
);
if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
const events = await res.json();

await rm('e', { recursive: true, force: true });
await mkdir('e', { recursive: true });

for (const ev of events) {
  if (!/^[0-9a-f-]{36}$/i.test(ev.id)) continue; // path safety: uuids only
  const place = [ev.venue, ev.area].filter(Boolean).join(' · ');
  const when = fmtWhen.format(new Date(ev.starts_at));
  const title = esc(ev.title);
  const desc = esc(`${place} · ${when} — on the 30A Now live map.`);
  const url = `/event/${ev.id}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title} — 30A Now</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc}">
<meta property="og:site_name" content="30A Now">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/e/${ev.id}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${SITE}${url}">
<meta http-equiv="refresh" content="0;url=${url}">
</head><body>
<p>Opening <a href="${url}">${title}</a>…</p>
</body></html>
`;
  await writeFile(`e/${ev.id}.html`, html);
}
console.log(`Wrote ${events.length} share stubs.`);
