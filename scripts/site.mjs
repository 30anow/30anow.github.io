// Pages a crawler can read. The SPA renders everything client-side, so on
// 8 Sep 2026 a site:30anow.github.io search returned nothing: /, /weekend,
// /robots.txt and /sitemap.xml were the same 25,902-byte shell whose only
// visible text ended in "Loading the beach…", and /event/<id> answered a
// crawler with HTTP 404. These generators write the same rows the app shows
// as plain HTML with one JSON-LD Event per row, then hand the reader to the
// app: /lineup/ (Fri–Sun), /tonight/, /venues/<slug>/ for every venue with
// three or more upcoming rows, plus sitemap.xml and robots.txt.
//
// Pure functions only — share-cards.mjs fetches the rows and writes files.
// Every date on these pages is beach time (America/Chicago); the helpers
// below are ports of src/utils/time.ts in the app repo and the tests pin
// the same instants that repo's tests pin.

export const SITE = 'https://30anow.github.io';
export const APP_STORE_ID = '6792965952';
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
export const BEACH_TZ = 'America/Chicago';

// ---------------------------------------------------------------------------
// Beach time
// ---------------------------------------------------------------------------

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEACH_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' of the instant's beach-time calendar day. */
export function beachDayKey(ms) {
  return dayKeyFmt.format(new Date(ms));
}

/** Milliseconds the beach zone is ahead of UTC at the given instant. */
function beachOffsetMs(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: BEACH_TZ,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second,
  );
  return asUtc - utcMs;
}

/** UTC instant for `hour:minute` beach wall-clock on the given beach day. */
export function beachWallToUtc(dayKey, hour, minute = 0) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  return guess - beachOffsetMs(guess);
}

/**
 * ISO 8601 with the beach offset ("2026-09-11T19:00:00-05:00") for JSON-LD.
 * Google reads a bare "Z" stamp correctly but shows the offset form in its
 * examples, and a human reading the source sees the marquee time.
 */
export function beachIso(iso) {
  const ms = Date.parse(iso);
  const off = beachOffsetMs(ms);
  const local = new Date(ms + off);
  const p = (n) => String(n).padStart(2, '0');
  const abs = Math.abs(off) / 60000;
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `${off < 0 ? '-' : '+'}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: BEACH_TZ, weekday: 'short' });

/** The beach day `n` calendar days on from a 'YYYY-MM-DD' key. */
export function addBeachDays(dayKey, n) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** 'Fri' for a beach day key, read at noon — no DST shift can move noon off its day. */
const beachWeekday = (dayKey) => weekdayFmt.format(new Date(beachWallToUtc(dayKey, 12)));

/**
 * Friday through Sunday on the beach calendar — or what is left of the
 * weekend once it is underway. Same rule as weekendWindow in the app, so the
 * page and the /weekend screen always agree on which days they mean.
 *
 * Days are walked as calendar keys, never as 24-hour steps: spring-forward
 * Sunday is 23 hours long, so `now + n * DAY` from Thu 11 Mar 2027 23:30 CST
 * steps clean over Sun 14 Mar and the loop runs on to the 21st — a ten-day
 * "this weekend", Mar 12–21, on /lineup/ and in the Thursday post.
 */
export function weekendWindow(now) {
  const today = beachDayKey(now);
  let startKey = today;
  if (!['Fri', 'Sat', 'Sun'].includes(beachWeekday(today))) {
    for (let d = 1; d <= 7; d += 1) {
      const key = addBeachDays(today, d);
      if (beachWeekday(key) === 'Fri') {
        startKey = key;
        break;
      }
    }
  }
  let endKey = startKey;
  for (let d = 0; d < 7 && beachWeekday(endKey) !== 'Sun'; d += 1) {
    endKey = addBeachDays(endKey, 1);
  }
  return {
    start: beachWallToUtc(startKey, 0),
    end: beachWallToUtc(endKey, 23, 59),
  };
}

/**
 * Tonight = a beach day from 4 PM to midnight, the window
 * send_tonight_digest() in the schema counts. Calendar keys again, for the
 * same reason weekendWindow uses them: +24h from 23:30 on spring-forward
 * Saturday lands on Monday, and the window would swallow all of Sunday.
 *
 * The last hour of the day describes *tomorrow* night. The page is static
 * between runs, and the run that covers beach midnight (05:10 UTC) falls at
 * 23:10 in winter and 00:10 in summer; without the roll-forward, winter's
 * copy would spend the small hours stamped with yesterday's date over shows
 * that ended at midnight. An hour early with the date printed on the page
 * beats five hours late. Everything on the page — title, lead and JSON-LD —
 * is labelled from `start`, never from the moment of generation.
 */
export function tonightWindow(now) {
  const today = beachDayKey(now);
  const day = now >= beachWallToUtc(today, 23) ? addBeachDays(today, 1) : today;
  return {
    start: beachWallToUtc(day, 16),
    end: beachWallToUtc(addBeachDays(day, 1), 0),
  };
}

const dayLongFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BEACH_TZ, weekday: 'long', month: 'short', day: 'numeric',
});
const dayShortFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BEACH_TZ, weekday: 'short', month: 'short', day: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BEACH_TZ, hour: 'numeric', minute: '2-digit',
});
const stampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BEACH_TZ, weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

export const fmtDayLong = (ms) => dayLongFmt.format(new Date(ms));
export const fmtDayShort = (ms) => dayShortFmt.format(new Date(ms));
export const fmtTime = (ms) => timeFmt.format(new Date(ms));
export const fmtStamp = (ms) => stampFmt.format(new Date(ms));

/** "Fri, Sep 11 · 7:00 PM – 10:00 PM" — the app's whenLabel, without the live/ended states a static page cannot know. */
export function fmtWhen(e) {
  const s = Date.parse(e.starts_at);
  const en = Date.parse(e.ends_at);
  return `${fmtDayShort(s)} · ${fmtTime(s)} – ${fmtTime(en)}`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const byStart = (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at);

/** Path segment for a venue: "AJ's Grayton Beach" -> "ajs-grayton-beach". */
export function slugify(name) {
  return (
    String(name ?? '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'venue'
  );
}

/** Rows whose start lies in [start, end] and that have not ended by `now`. */
export function inWindow(events, { start, end }, now) {
  return events
    .filter((e) => {
      const s = Date.parse(e.starts_at);
      return s >= start && s <= end && Date.parse(e.ends_at) > now;
    })
    .sort(byStart);
}

/**
 * Day sections, non-fitness first. The gym timetable is a third of every
 * week (173 of 466 rows on 8 Sep 2026), so it goes under a <details> per
 * day: still on the page for a crawler, out of the way for a reader.
 */
export function groupByDay(events) {
  const days = new Map();
  for (const e of [...events].sort(byStart)) {
    const key = beachDayKey(Date.parse(e.starts_at));
    let day = days.get(key);
    if (!day) {
      day = { key, label: fmtDayLong(Date.parse(e.starts_at)), main: [], fitness: [] };
      days.set(key, day);
    }
    (e.category === 'fitness' ? day.fitness : day.main).push(e);
  }
  return [...days.values()];
}

/**
 * One page per venue with `min` or more rows still ahead of `now`. Venue
 * strings are grouped case-insensitively (the scraper canonicalises them,
 * but a community post can still type "the red bar"); the spelling seen
 * first wins. Slugs that collide get -2, -3… so two pages never share a path.
 */
export function venuePages(events, now, min = 3) {
  const groups = new Map();
  for (const e of events) {
    const name = String(e.venue ?? '').trim();
    if (!name || Date.parse(e.starts_at) < now) continue;
    const key = name.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { name, area: e.area ?? '', events: [] };
      groups.set(key, g);
    }
    g.events.push(e);
  }
  const taken = new Set();
  const out = [];
  const ordered = [...groups.values()].sort(
    (a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name),
  );
  for (const g of ordered) {
    if (g.events.length < min) continue;
    const base = slugify(g.name);
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    g.events.sort(byStart);
    out.push({ ...g, slug, known: knownVenue(g.name) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Venues we know an address for. A copy of src/data/venues.ts in the app
// repo (checked 8 Sep 2026): the two repos cannot import each other, and
// only facts from each venue's own site belong here. Keep the two in step.
// ---------------------------------------------------------------------------

export const KNOWN_VENUES = [
  {
    name: "AJ's Grayton Beach",
    match: /\baj'?s\b.*grayton|\baj'?s grayton/i,
    address: '63 DeFuniak St, Grayton Beach',
    website: 'https://ajsgrayton.com',
    phone: '850-231-4102',
  },
  {
    name: 'The Red Bar',
    match: /\bred bar\b/i,
    address: '70 Hotz Ave, Grayton Beach',
    website: 'https://www.theredbar.com',
  },
  {
    name: 'Old Florida Fish House',
    match: /old florida fish house/i,
    address: "33 Heron's Watch Way, Seagrove Beach",
    website: 'https://oldfloridafishhouse.com',
    phone: '850-534-3045',
  },
  {
    name: "Stinky's Bait Shack",
    match: /stinky'?s bait/i,
    address: '5994 W County Hwy 30A, Dune Allen',
    website: 'https://stinkysbaitshop.com',
    phone: '850-622-2248',
  },
  {
    name: 'Fish Out of Water',
    match: /fish out of water|\bfoow\b/i,
    address: '34 Goldenrod Cir, WaterColor',
    website: 'https://www.dinefish30a.com',
    phone: '850-534-5050',
  },
  {
    name: 'Shunk Gulley Oyster Bar',
    match: /shunk gulley/i,
    address: '1875 S County Hwy 393, Gulf Place',
    website: 'https://www.shunkgulley.com',
  },
];

export function knownVenue(venue) {
  if (!venue) return null;
  return KNOWN_VENUES.find((v) => v.match.test(venue)) ?? null;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

/** "$30 (from listing)" -> "30"; "Free" -> "0"; anything else -> null. */
export function priceNumber(price) {
  if (!price) return null;
  // The amount wins over the word: "$12.50 · kids eat free" costs $12.50.
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(price);
  if (m) return m[1];
  return /\bfree\b/i.test(price) ? '0' : null;
}

function postalAddress(e) {
  const known = knownVenue(e.venue);
  if (known) {
    const i = known.address.lastIndexOf(',');
    return {
      '@type': 'PostalAddress',
      streetAddress: known.address.slice(0, i).trim(),
      addressLocality: known.address.slice(i + 1).trim(),
      addressRegion: 'FL',
      addressCountry: 'US',
    };
  }
  // Every 30A neighbourhood posts as Santa Rosa Beach; the area is the
  // part a searcher actually types.
  return {
    '@type': 'PostalAddress',
    addressLocality: e.area ? `${e.area}, Santa Rosa Beach` : 'Santa Rosa Beach',
    addressRegion: 'FL',
    addressCountry: 'US',
  };
}

/**
 * One schema.org Event for a row. `url` is the row's own share page.
 *
 * `poster` is the image share-cards.mjs probed and the host actually served.
 * The row's own image_url is not good enough: a few source hosts block
 * hotlinking, and when they do the stub drops the <img> and unfurls the
 * default card — structured data naming the dead URL on that same page is
 * the one outcome posterOk exists to prevent, and Google drops or
 * invalidates the image in the rich result for it.
 */
export function eventJsonLd(e, poster = null) {
  const url = `${SITE}/e/${e.id}`;
  const out = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: beachIso(e.starts_at),
    endDate: beachIso(e.ends_at),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: e.venue,
      address: postalAddress(e),
      ...(Number.isFinite(e.lat) && Number.isFinite(e.lng)
        ? { geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } }
        : {}),
    },
    url,
  };
  if (poster) out.image = [poster];
  if (e.description) out.description = e.description;
  const price = priceNumber(e.price);
  if (price !== null) {
    out.offers = {
      '@type': 'Offer',
      price,
      priceCurrency: 'USD',
      url: safeUrl(e.url) || url,
      availability: 'https://schema.org/InStock',
    };
  }
  return out;
}

/** The row's poster only where share-cards.mjs probed the host and it served an image. */
export const checkedPoster = (e, posters) =>
  e.image_url && posters?.get(e.image_url) ? e.image_url : null;

/**
 * A <script> of Event objects; "<" is escaped so a title cannot close the
 * tag. `posterOf` reports the checked poster for a row — the pages that were
 * built without a probe pass nothing, and their Events carry no image rather
 * than a URL nobody has tried.
 */
export function jsonLdScript(events, posterOf = () => null) {
  const json = JSON.stringify(events.map((e) => eventJsonLd(e, posterOf(e)))).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const CSS = `
:root{--ink:#16303A;--sub:#5E7680;--teal:#0E7C86;--teal-dark:#0A5960;--teal-soft:#E3F2F3;--border:#E3EBEE;--bg:#FFFFFF}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--teal-dark)}
header{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border)}
header .brand{font-weight:800;font-size:18px;color:var(--ink);text-decoration:none}
header nav{display:flex;gap:12px;font-size:14px;overflow-x:auto;white-space:nowrap}
main{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:26px;line-height:1.2;margin:8px 0 4px}
h2{font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.lead{color:var(--sub);margin:0 0 14px;font-size:15px}
.cta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 6px}
.btn{display:inline-block;padding:10px 16px;border-radius:12px;background:var(--teal);color:#fff;font-weight:700;text-decoration:none}
.btn.alt{background:var(--teal-soft);color:var(--teal-dark)}
.live{font-size:14px}
ul.rows{list-style:none;margin:0;padding:0}
li.ev{padding:12px 0;border-bottom:1px solid var(--border)}
li.ev:last-child{border-bottom:0}
.t{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none}
.m{color:var(--sub);font-size:14px;margin-top:2px}
.d{margin:6px 0 0;font-size:14px;white-space:pre-line}
.s{margin-top:4px;font-size:13px}
details{margin:8px 0 0}
summary{cursor:pointer;color:var(--sub);font-size:14px;padding:6px 0}
.card{background:var(--teal-soft);border-radius:12px;padding:12px 14px;margin:8px 0 4px;font-size:14px}
.poster{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:12px;margin:10px 0 4px;background:var(--teal-soft)}
.quiet{padding:24px 0;color:var(--sub)}
.venues{columns:2;column-gap:20px;font-size:15px}
.venues li{break-inside:avoid;margin:2px 0}
footer{max-width:720px;margin:30px auto 0;padding:16px;color:var(--sub);font-size:13px;border-top:1px solid var(--border)}
`;

// Tries the app first on an iPhone and falls back to the App Store after
// 1.5 s; a desktop click goes straight to the store. Safari shows its
// "cannot open" alert when the app is absent — universal links would need
// an AASA file and a new binary, so this is the honest version for now.
// The second block carries ?s=fb (or any query) through to the live SPA
// link so app_open on web can count where a visit came from.
const SCRIPT = `<script>
(function(){
  var open=document.getElementById('open');
  if(open&&/iPhone|iPad|iPod/.test(navigator.userAgent)){
    open.addEventListener('click',function(ev){
      ev.preventDefault();
      var t=Date.now();
      location.href=open.getAttribute('data-app');
      setTimeout(function(){if(!document.hidden&&Date.now()-t<2500)location.href=open.href;},1500);
    });
  }
  if(location.search){
    var live=document.querySelectorAll('a.live');
    for(var i=0;i<live.length;i++){live[i].href+=location.search;}
  }
})();
</script>`;

/**
 * Shared <head>. The listing pages unfurl as the app icon (og.png, a
 * summary card); an event stub passes its poster and asks for the large
 * card. `extraHead` is for the stub's <noscript> refresh.
 */
function head({
  title,
  description,
  path,
  appArgument,
  updated,
  image = `${SITE}/og.png`,
  card = 'summary',
  extraHead = '',
}) {
  const url = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${esc(appArgument)}">
<meta property="og:site_name" content="30A Now">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="${card}">
<meta name="generator" content="30anow share-cards ${esc(updated)}">
${extraHead}<style>${CSS}</style>
</head><body>
<header><a class="brand" href="/">30A Now</a><nav><a href="/lineup/">This weekend</a><a href="/tonight/">Tonight</a><a href="/venues/">Venues</a></nav></header>
<main>
`;
}

function cta({ appArgument, livePath, liveLabel }) {
  return `<div class="cta">
<a class="btn" id="open" href="${APP_STORE_URL}" data-app="${esc(appArgument)}">Open in 30A Now</a>
<a class="btn alt" href="${APP_STORE_URL}">Get it for iPhone</a>
<a class="live" href="${esc(livePath)}">${esc(liveLabel)}</a>
</div>
`;
}

function foot() {
  return `</main>
<footer>30A Now · the live map of Scenic Highway 30A, Santa Rosa Beach, FL · <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></footer>
${SCRIPT}
</body></html>
`;
}

/**
 * A row's `url` only when it is a web link. Every other field that reaches
 * this site is checked — `id` against a uuid, `poster` against `^https://`,
 * everything else escaped — but `url` arrives from a third-party calendar
 * and is written straight to an href. `new URL()` alone is not a check:
 * `javascript://evil.example.com/%0aalert(1)` parses happily, hostname and
 * all, and would render as "Listing on evil.example.com" on the origin that
 * holds the web app's Supabase session. Scheme allowlist, one gate, used by
 * both the anchors and the JSON-LD offer.
 */
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? String(url) : '';
  } catch {
    return '';
  }
}

function hostOf(url) {
  const safe = safeUrl(url);
  if (!safe) return '';
  return new URL(safe).hostname.replace(/^www\./, '');
}

/**
 * One row. The title links to the share page (/e/<id>, which opens the
 * live event), the venue to its page when it has one, and the source
 * link is the listing the scraper read.
 */
export function rowHtml(e, venueSlugs = new Map(), { showVenue = true } = {}) {
  const slug = venueSlugs.get(String(e.venue ?? '').trim().toLowerCase());
  const venue = !showVenue
    ? ''
    : slug
      ? `<a href="/venues/${slug}/">${esc(e.venue)}</a>`
      : esc(e.venue);
  const area = e.area && e.area !== e.venue ? esc(e.area) : '';
  const meta = [venue, area, esc(fmtWhen(e)), e.price ? esc(e.price) : '']
    .filter(Boolean)
    .join(' · ');
  const desc = e.description && e.description.trim() !== e.title.trim()
    ? `<p class="d">${esc(e.description.trim())}</p>`
    : '';
  const link = safeUrl(e.url);
  const host = hostOf(link);
  const source = host
    ? `<div class="s"><a href="${esc(link)}" rel="nofollow noopener">Listing on ${esc(host)}</a></div>`
    : '';
  return `<li class="ev" id="e-${esc(e.id)}"><a class="t" href="/e/${esc(e.id)}">${esc(e.title)}</a><div class="m">${meta}</div>${desc}${source}</li>`;
}

function daySection(day, venueSlugs, opts) {
  const main = day.main.length
    ? `<ul class="rows">${day.main.map((e) => rowHtml(e, venueSlugs, opts)).join('\n')}</ul>`
    : '';
  const n = day.fitness.length;
  const fitness = n
    ? `<details><summary>${n} ${n === 1 ? 'class, clinic or court time' : 'classes, clinics and court times'}</summary><ul class="rows">${day.fitness.map((e) => rowHtml(e, venueSlugs, opts)).join('\n')}</ul></details>`
    : '';
  return `<section><h2>${esc(day.label)}</h2>${main}${fitness}</section>`;
}

const slugMap = (venues) => new Map(venues.map((v) => [v.name.toLowerCase(), v.slug]));

const countLabel = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** /lineup/ — Friday to Sunday, the same window as the app's /weekend. */
export function renderLineup(events, venues, now, posters = new Map()) {
  const window = weekendWindow(now);
  const rows = inWindow(events, window, now);
  const days = groupByDay(rows);
  const main = rows.filter((e) => e.category !== 'fitness').length;
  const classes = rows.length - main;
  const range = `${fmtDayShort(window.start)} – ${fmtDayShort(window.end)}`;
  const picks = rows
    .filter((e) => e.category !== 'fitness')
    .slice(0, 3)
    .map((e) => e.title)
    .join(', ');
  const description = main
    ? `${countLabel(main, 'event', 'events')} on 30A this weekend (${range}): ${picks} and more, with times, venues and the live map.`
    : `What's on along 30A this weekend (${range}), with times, venues and the live map.`;
  const body =
    head({
      title: `This weekend on 30A — live music, markets and events ${range}`,
      description,
      path: '/lineup/',
      appArgument: 'thirtyanow://weekend',
      updated: fmtStamp(now),
    }) +
    `<h1>This weekend on 30A</h1>
<p class="lead">${esc(range)} · ${countLabel(main, 'event', 'events')}${classes ? ` + ${countLabel(classes, 'class', 'classes')}` : ''} · updated ${esc(fmtStamp(now))} beach time</p>
` +
    cta({ appArgument: 'thirtyanow://weekend', livePath: '/weekend', liveLabel: 'See it live on the map' }) +
    (days.length
      ? days.map((d) => daySection(d, slugMap(venues))).join('\n')
      : `<p class="quiet">Nothing listed for the weekend yet — the calendars are read twice a day, so check back.</p>`) +
    `<section><h2>Also</h2><p><a href="/tonight/">Tonight on 30A</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot();
  return {
    html: body,
    count: rows.length,
    jsonLd: rows.length ? jsonLdScript(rows, (e) => checkedPoster(e, posters)) : '',
  };
}

/** /tonight/ — the 4 PM-to-midnight window the nightly push counts. */
export function renderTonight(events, venues, now, posters = new Map()) {
  const window = tonightWindow(now);
  const rows = inWindow(events, window, now);
  const days = groupByDay(rows);
  const main = rows.filter((e) => e.category !== 'fitness').length;
  // The window's own day, not the moment of generation: the 23:10 CST run
  // describes tomorrow night (see tonightWindow), and the page must say so.
  const day = fmtDayLong(window.start);
  const picks = rows
    .filter((e) => e.category !== 'fitness')
    .slice(0, 3)
    .map((e) => (e.venue && !e.title.toLowerCase().includes(e.venue.toLowerCase()) ? `${e.title} at ${e.venue}` : e.title))
    .join(', ');
  const description = main
    ? `${countLabel(main, 'event', 'events')} on 30A tonight, ${day}: ${picks}${main > 3 ? ' and more' : ''}. Times, venues and the live map.`
    : `What's on along 30A tonight, ${day}, with times, venues and the live map.`;
  const body =
    head({
      title: `Tonight on 30A — ${day}`,
      description,
      path: '/tonight/',
      appArgument: 'thirtyanow://feed',
      updated: fmtStamp(now),
    }) +
    `<h1>Tonight on 30A</h1>
<p class="lead">${esc(day)} · from 4 PM · updated ${esc(fmtStamp(now))} beach time</p>
` +
    cta({ appArgument: 'thirtyanow://feed', livePath: '/feed', liveLabel: 'See it live in the app' }) +
    (days.length
      ? days.map((d) => daySection(d, slugMap(venues))).join('\n')
      : `<p class="quiet">Quiet night — nothing listed after 4 PM. <a href="/lineup/">Here is the weekend.</a></p>`) +
    `<section><h2>Also</h2><p><a href="/lineup/">This weekend on 30A</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot();
  return {
    html: body,
    count: rows.length,
    jsonLd: rows.length ? jsonLdScript(rows, (e) => checkedPoster(e, posters)) : '',
  };
}

/** /venues/<slug>/ — everything ahead at one venue, with its card when we know it. */
export function renderVenue(venue, now, posters = new Map()) {
  const { name, area, events, slug, known } = venue;
  const days = groupByDay(events);
  const next = events[0];
  const place = area && area !== name ? `${name} (${area})` : name;
  const description = `${countLabel(events.length, 'upcoming event', 'upcoming events')} at ${place} on 30A — next up ${next.title}, ${fmtWhen(next)}. Times, prices and the live map on 30A Now.`;
  const card = known
    ? `<div class="card"><strong>${esc(known.name)}</strong> · ${esc(known.address)}` +
      ` · <a href="${esc(known.website)}">${esc(hostOf(known.website))}</a>` +
      (known.phone ? ` · <a href="tel:${esc(known.phone.replace(/-/g, ''))}">${esc(known.phone)}</a>` : '') +
      `</div>`
    : '';
  const livePath = `/venue/${encodeURIComponent(name)}`;
  const appArgument = `thirtyanow://venue/${encodeURIComponent(name)}`;
  const body =
    head({
      title: `${name} — upcoming events and live music | 30A Now`,
      description,
      path: `/venues/${slug}/`,
      appArgument,
      updated: fmtStamp(now),
    }) +
    `<h1>${esc(name)}</h1>
<p class="lead">${area && area !== name ? `${esc(area)} · ` : ''}${countLabel(events.length, 'upcoming event', 'upcoming events')} · updated ${esc(fmtStamp(now))} beach time</p>
${card}` +
    cta({ appArgument, livePath, liveLabel: `See ${name} live in the app` }) +
    days.map((d) => daySection(d, new Map(), { showVenue: false })).join('\n') +
    `<section><h2>Also</h2><p><a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot();
  return { html: body, jsonLd: jsonLdScript(events, (e) => checkedPoster(e, posters)) };
}

/** /venues/ — the index a crawler follows to every venue page. */
export function renderVenuesIndex(venues, now) {
  const body =
    head({
      title: 'Venues on 30A — where the live music and events are | 30A Now',
      description: `${venues.length} venues along 30A with events coming up, from AJ's and The Red Bar in Grayton Beach to Seaside and Rosemary Beach. Every listing, on the live map.`,
      path: '/venues/',
      appArgument: 'thirtyanow://',
      updated: fmtStamp(now),
    }) +
    `<h1>Venues on 30A</h1>
<p class="lead">${venues.length} places with something coming up · updated ${esc(fmtStamp(now))} beach time</p>
` +
    cta({ appArgument: 'thirtyanow://', livePath: '/', liveLabel: 'Open the live map' }) +
    `<ul class="venues">${venues
      .map(
        (v) =>
          `<li><a href="/venues/${v.slug}/">${esc(v.name)}</a> <span class="m">${v.events.length}</span></li>`,
      )
      .join('\n')}</ul>
` +
    foot();
  return { html: body };
}

/**
 * /e/<id> — the page a shared link lands on. Until Sep 2026 this was a
 * 0-second refresh to /event/<id>, which GitHub Pages serves through
 * 404.html: a crawler got HTTP 404, and every share unfurled as the 388 KB
 * app icon though 114 of 439 events carried a poster. Now it is a page in
 * its own right — the poster (or og-default.png) as a large card, the facts
 * as HTML, one JSON-LD Event, a way into the app and the live map a tap
 * away — and canonical points at itself. The refresh survives only under
 * <noscript>, at 3 s, for a reader with scripts off.
 *
 * `poster` is the image_url share-cards.mjs has already checked; a host
 * that blocks hotlinking gets the default card rather than a broken unfurl.
 * The query (?s=share) rides through to the live link via SCRIPT.
 */
export function renderStub(e, { poster = null, now = Date.now(), venueSlugs = new Map() } = {}) {
  const path = `/e/${e.id}`;
  const live = `/event/${e.id}`;
  const appArgument = `thirtyanow://event/${e.id}`;
  const venue = String(e.venue ?? '').trim();
  const area = e.area && e.area !== venue ? e.area : '';
  const when = fmtWhen(e);
  const place = [venue, area].filter(Boolean).join(' · ');
  const description = `${place ? `${place} · ` : ''}${when}${e.price ? ` · ${e.price}` : ''} — on the 30A Now live map.`;
  const slug = venueSlugs.get(venue.toLowerCase());
  const venueHtml = !venue ? '' : slug ? `<a href="/venues/${slug}/">${esc(venue)}</a>` : esc(venue);
  const lead = [venueHtml, area ? esc(area) : '', esc(when), e.price ? esc(e.price) : '']
    .filter(Boolean)
    .join(' · ');
  const desc =
    e.description && e.description.trim() !== e.title.trim()
      ? `<p class="d">${esc(e.description.trim())}</p>\n`
      : '';
  const link = safeUrl(e.url);
  const host = hostOf(link);
  const source = host
    ? `<div class="s"><a href="${esc(link)}" rel="nofollow noopener">Listing on ${esc(host)}</a></div>\n`
    : '';
  const body =
    head({
      title: `${e.title} — 30A Now`,
      description,
      path,
      appArgument,
      updated: fmtStamp(now),
      image: poster || `${SITE}/og-default.png`,
      card: 'summary_large_image',
      extraHead: `<noscript><meta http-equiv="refresh" content="3;url=${live}"></noscript>\n`,
    }) +
    `<h1>${esc(e.title)}</h1>
<p class="lead">${lead}</p>
` +
    (poster ? `<img class="poster" src="${esc(poster)}" alt="">\n` : '') +
    cta({ appArgument, livePath: live, liveLabel: 'See it on the live map' }) +
    desc +
    source +
    `<section><h2>Also</h2><p><a href="/tonight/">Tonight on 30A</a> · <a href="/lineup/">This weekend</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot();
  return { html: body, jsonLd: jsonLdScript([e], () => poster) };
}

/**
 * The finished page: JSON-LD goes in the head, before </head>.
 *
 * The replacement is a function, not a string. A string replacement reads
 * `$&`, `` $` ``, `$'` and `$$` as substitution patterns, and the JSON-LD it
 * carries is scraped third-party text refreshed twice a day: a description
 * of "Ladies night $' free wine" spliced everything after </head> — the
 * SCRIPT block's literal </script> included — into the ld+json tag, closing
 * it early and re-parsing the body, and a title of "Rock $& Roll" came out
 * as "Rock </head> Roll".
 */
export function withJsonLd(page) {
  return page.jsonLd ? page.html.replace('</head>', () => `${page.jsonLd}\n</head>`) : page.html;
}

// ---------------------------------------------------------------------------
// Publishing floor
// ---------------------------------------------------------------------------

/**
 * A collapse in the row count is a fetch problem, not an empty calendar:
 * 30A has never had a day with nothing on it. 0.7 is the same order as the
 * scraper's cancellation sweep, which refuses to delete more than 30% of a
 * source in one run.
 */
export const SHRINK_FLOOR = 0.7;

/**
 * '' when a run may rewrite the site; why it must not, otherwise.
 *
 * The house rule the scraper lives by, applied to the site: never delete on
 * a bad fetch. share-cards.mjs rm's e/, lineup/, tonight/ and venues/ before
 * it writes and the workflow commits the result with `git add -A`, so a
 * successful-but-empty 200 - an RLS edit, a change in what `ends_at` means -
 * would take down all 451 published /e/<id> stubs and 36 venue pages, every
 * one of them a link already sitting in a group chat and in Search Console.
 * `published` is what the last good run left on disk. A red Action leaves
 * those pages up, which is the safe outcome.
 */
export function shrinkRefusal(fetched, published) {
  if (!fetched) return 'the events fetch returned 0 rows';
  if (published && fetched < published * SHRINK_FLOOR) {
    return `the events fetch returned ${fetched} rows against ${published} pages published last run`;
  }
  return '';
}

/**
 * '' when the first page really was the whole of what matched; why it was
 * not, otherwise.
 *
 * The paging in share-cards.mjs reads a page shorter than `limit` as the
 * last page, which is only true while `limit` is the server's max-rows
 * (1,000 today - a bare select returned exactly 1,000 rows against a count
 * of 1,294). Set Supabase's max-rows below that and every read would stop on
 * page one and drop the tail, which is the same 200-that-lies the paging was
 * added to stop, moved one layer down. PostgREST answers `count=exact` with
 * `content-range: 0-466/467`, and the rows and the total come from the one
 * response, so a short page against a bigger total is a cap and never a
 * concurrent insert. Without count=exact the range carries no total, and a
 * short page is then taken at its word.
 */
export function truncationRefusal(received, limit, total) {
  if (!Number.isFinite(total) || received >= limit || total <= received) return '';
  return `the events fetch returned ${received} of ${total} matching rows in one page`;
}

// ---------------------------------------------------------------------------
// sitemap.xml and robots.txt
// ---------------------------------------------------------------------------

/** Pages plus every e/<id>; lastmod is this run, since every file is rewritten. */
export function sitemapXml(events, venues, now) {
  const lastmod = new Date(now).toISOString();
  const urls = [
    '/',
    '/lineup/',
    '/tonight/',
    '/venues/',
    ...venues.map((v) => `/venues/${v.slug}/`),
    ...events.map((e) => `/e/${e.id}`),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${SITE}${esc(u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
  );
}

/**
 * Account screens are a shell with nothing to index; everything else is open.
 *
 * _expo/ stays crawlable. It holds the app's only JS bundle (2.98 MB), and
 * every page here that is not generated — including "/", the first URL in
 * sitemap.xml and the App Store listing's marketing URL — is a client-
 * rendered shell. Disallowing the bundle leaves Googlebot's render pass with
 * the unhydrated shell, whose whole text ends in "Loading the beach…", and
 * all 16 SPA routes then index as the same 26,361-byte document. Hashed JS
 * is not indexed as a document, so blocking it cost the homepage its
 * content and gained nothing.
 */
export function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /settings',
    'Disallow: /profile',
    'Disallow: /sign-in',
    'Disallow: /two-factor',
    'Disallow: /friends',
    'Disallow: /members',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');
}
