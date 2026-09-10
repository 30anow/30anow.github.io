// Regenerates everything on this site that is built from the events table:
//   e/<id>.html            one page per upcoming event: what a shared link
//                          unfurls as, and where it lands
//   lineup/, tonight/,     plain HTML a crawler can read, with JSON-LD
//   venues/<slug>/         (see site.mjs for why)
//   sitemap.xml, robots.txt
// Runs on a schedule after the event imports land (.github/workflows/
// share-cards.yml). One paged read of the events table feeds all of it, and
// nothing is deleted until that read has proved itself (refuseImplausible).
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

import {
  checkedPoster,
  fmtStamp,
  renderLineup,
  renderStub,
  renderTonight,
  renderVenue,
  renderVenuesIndex,
  robotsTxt,
  shrinkRefusal,
  sitemapXml,
  truncationRefusal,
  venuePages,
  withJsonLd,
} from './site.mjs';

// The PUBLIC client credentials — identical to what the web app ships in
// its bundle. Anonymous reads see approved events only (enforced by RLS).
const SUPABASE_URL = 'https://jbswxdkcpjjbqulsykvu.supabase.co';
const ANON_KEY = 'sb_publishable_DXTI_TsCspkSefpj61a1tA_ufCj7GMQ';

// The contact URL a host can actually resolve. It read https://30anow.app
// until 9 Sep 2026, which has no A record at all (Cloudflare DoH: NXDOMAIN,
// status 3) — and some WordPress firewalls read a contact that does not
// resolve as a bot signal. These probes go to the same hosts the scraper
// reads, and the scraper is the app's entire supply of content.
const UA = '30anow-scraper/1.0 (+https://30anow.github.io)';

const SELECT =
  'id,title,venue,area,category,starts_at,ends_at,price,description,url,image_url,lat,lng';
// PostgREST cuts every response to Supabase's max-rows (1,000) whatever
// `limit` asks for and reports the cut as a plain 200, so a truncated read
// is indistinguishable from a whole one. 451 rows matched on 8 Sep 2026, the
// 30a.com day-view job adds a few hundred more and the SoWal anchors reach
// 120 days out, so the cap is months away, not years. Page until a short
// page says the read is whole - the shape storedFutureRows uses in the
// scraper - and stop rather than loop if something goes wrong upstream. That
// last-page test only holds while PAGE is the server's max-rows, so the
// first page's count=exact total is checked against it (truncationRefusal).
const PAGE = 1000;
const MAX_PAGES = 20;

const now = Date.now();
const events = await fetchEvents(now);
await refuseImplausible(events);

const posters = await checkPosters(events);
const venues = venuePages(events, now);
await writeStubs(events, venues, now, posters);
await writeSite(events, venues, now, posters);

async function fetchEvents(now) {
  const since = new Date(now - 24 * 3600 * 1000).toISOString();
  const rows = new Map();
  for (let offset = 0; offset < PAGE * MAX_PAGES; offset += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events` +
        `?select=${SELECT}&ends_at=gte.${since}` +
        `&order=starts_at.asc,id.asc&limit=${PAGE}&offset=${offset}`,
      {
        // count=exact on the first page only: it is what lets
        // truncationRefusal tell a last page from a capped one.
        headers: offset ? { apikey: ANON_KEY } : { apikey: ANON_KEY, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) throw new Error(`events fetch failed: HTTP ${res.status} at offset ${offset}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`events fetch returned ${typeof page}, not rows`);
    // Path safety: every id becomes a file name, so uuids only. Keyed by id
    // because the importer runs on its own schedule - a row inserted between
    // two pages shifts the rest along and would otherwise repeat one.
    for (const ev of page) if (/^[0-9a-f-]{36}$/i.test(ev.id)) rows.set(ev.id, ev);
    if (!offset) {
      const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
      const capped = truncationRefusal(page.length, PAGE, total);
      if (capped) throw new Error(`${capped} - PAGE is above the server's max-rows`);
    }
    if (page.length < PAGE) return [...rows.values()];
  }
  throw new Error(`events fetch did not end within ${MAX_PAGES} pages - refusing a partial read`);
}

/**
 * Counts what the last good run published and lets shrinkRefusal judge the
 * new read, before the first rm. The workflow's allow_shrink clears a real
 * off-season drop; it can never clear an empty fetch, which has no honest
 * reading and would delete the whole site.
 */
async function refuseImplausible(events) {
  const published = (await readdir('e').catch(() => [])).filter((f) => f.endsWith('.html')).length;
  const refusal = shrinkRefusal(events.length, published);
  if (refusal) {
    if (events.length && process.env.ALLOW_SHRINK === 'true') {
      console.warn(`Publishing anyway (allow_shrink): ${refusal}.`);
    } else {
      throw new Error(
        `Refusing to rewrite ${published} published pages: ${refusal}.` +
          // An empty read has no honest reading, so allow_shrink cannot clear it.
          (events.length ? ' Re-run the workflow with allow_shrink if the drop is real.' : ''),
      );
    }
  }
  console.log(`Fetched ${events.length} events (${published} pages published last run).`);
}

/**
 * A poster is only worth unfurling if the host will serve it: a few source
 * hosts block hotlinking, and a broken image is worse than the default
 * card. Each distinct image_url is probed once — HEAD, capped at 5 s, then
 * a GET when the host refuses HEAD (WordPress CDNs answer 403/405) — and
 * only an image/* answer keeps it. One at a time with a two-second gap,
 * the same manners the scraper shows those hosts; ~100 posters cost the
 * Action three or four minutes, which it has.
 */
async function posterOk(url) {
  if (!/^https:\/\//.test(url)) return false;
  const probe = async (method) => {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(5_000),
    });
    if (r.body) r.body.cancel().catch(() => {});
    return { ok: r.ok && /^image\//i.test(r.headers.get('content-type') || ''), status: r.status };
  };
  try {
    const h = await probe('HEAD');
    if (h.ok) return true;
    if (h.status === 403 || h.status === 405 || h.status === 400) return (await probe('GET')).ok;
    return false;
  } catch {
    return false;
  }
}

async function checkPosters(events) {
  const urls = [...new Set(events.map((e) => e.image_url).filter(Boolean))];
  const ok = new Map();
  for (const u of urls) {
    if (ok.size) await new Promise((r) => setTimeout(r, 2_000));
    ok.set(u, await posterOk(u));
  }
  const kept = [...ok.values()].filter(Boolean).length;
  console.log(`Posters: ${kept} of ${urls.length} reachable.`);
  return ok;
}

async function writeStubs(events, venues, now, posters) {
  const venueSlugs = new Map(venues.map((v) => [v.name.toLowerCase(), v.slug]));
  await rm('e', { recursive: true, force: true });
  await mkdir('e', { recursive: true });
  for (const ev of events) {
    const poster = checkedPoster(ev, posters);
    await writeFile(`e/${ev.id}.html`, withJsonLd(renderStub(ev, { poster, now, venueSlugs })));
  }
  console.log(`Wrote ${events.length} share stubs.`);
}

async function writeSite(events, venues, now, posters) {
  // Wiped first so a venue that dropped below three rows loses its page
  // instead of lingering with a stale list.
  for (const dir of ['lineup', 'tonight', 'venues']) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
  const lineup = renderLineup(events, venues, now, posters);
  await writeFile('lineup/index.html', withJsonLd(lineup));
  const tonight = renderTonight(events, venues, now, posters);
  await writeFile('tonight/index.html', withJsonLd(tonight));
  await writeFile('venues/index.html', renderVenuesIndex(venues, now).html);
  for (const v of venues) {
    await mkdir(`venues/${v.slug}`, { recursive: true });
    await writeFile(`venues/${v.slug}/index.html`, withJsonLd(renderVenue(v, now, posters)));
  }
  await writeFile('sitemap.xml', sitemapXml(events, venues, now));
  await writeFile('robots.txt', robotsTxt());
  console.log(
    `Wrote lineup (${lineup.count} rows), tonight (${tonight.count} rows), ` +
      `${venues.length} venue pages, sitemap and robots — ${fmtStamp(now)} beach time.`,
  );
}
