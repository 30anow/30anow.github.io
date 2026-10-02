// Pages a crawler can read. The SPA renders everything client-side, so on
// 8 Sep 2026 a site:30anow.github.io search returned nothing: /, /weekend,
// /robots.txt and /sitemap.xml were the same 25,902-byte shell whose only
// visible text ended in "Loading the beach…", and /event/<id> answered a
// crawler with HTTP 404. These generators write the same rows the app shows
// as plain HTML with one JSON-LD Event per row, then hand the reader to the
// app: /lineup/ (Fri–Sun), /tonight/, /venues/<slug>/ for every venue with
// three or more upcoming rows, plus sitemap.xml and robots.txt — and
// /embed/<venue>/, the partner strip, for the same reason: it was an SPA
// route that answered a partner's iframe with HTTP 404 and a 3.0 MB bundle.
//
// Pure functions only — share-cards.mjs fetches the rows and writes files.
// Every date on these pages is beach time (America/Chicago); the helpers
// below are ports of src/utils/time.ts in the app repo and the tests pin
// the same instants that repo's tests pin.

export const SITE = 'https://30anow.github.io';
export const APP_STORE_ID = '6792965952';
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
export const BEACH_TZ = 'America/Chicago';

// The provider token for App Store Connect campaign links — EMPTY until the
// first campaign exists (docs/app-store-checklist.md in the app repo,
// "Campaign links", has the clicks). App Store Connect attributes downloads
// per campaign tag for free, but only on a link that carries both pt= and
// ct=: Apple ignores a ct without a pt. Every store link on this site was
// the bare listing until 25 Sep 2026, so nothing could say whether a single
// install came from the web. src/config.ts in the app repo carries a
// constant of the same name; both take the same number. Filled in on
// 28 Sep 2026 from App Store Connect's campaign link generator: the
// provider token is the account's, and public on every campaign link.
export const APP_STORE_PROVIDER_TOKEN = '129198813';

// The branded 1200x630 card at the site root, and the icon. The listing
// pages asked for the small "summary" card with the 1024x1024 icon, so the
// Thursday post into groups of ~250K, 40K and 36K members showed a square
// thumbnail instead of the full-width card that og-default.png already was
// for the posterless event stubs.
export const OG_DEFAULT = `${SITE}/og-default.png`;
export const OG_DEFAULT_SIZE = { width: 1200, height: 630 };

/**
 * The App Store link for one page, tagged so App Analytics can count it:
 * seo-lineup, seo-tonight, seo-venue, seo-venue-index and seo-event on the
 * pages' own buttons, and the visitor's own tag where they arrived with one
 * (the forwarder in SCRIPT rewrites ct= the way it rewrites s=). The tag is
 * held to the characters parseArrival accepts in the app and to Apple's
 * forty, so the two counts share one spelling; a tag that sanitises to
 * nothing is no campaign at all. `pt` is a parameter only so the tests can
 * set one.
 */
export function storeUrl(ct, pt = APP_STORE_PROVIDER_TOKEN) {
  const tag = String(ct ?? '').replace(/[^\w.-]/g, '').slice(0, 40);
  if (!pt || !tag) return APP_STORE_URL;
  return `${APP_STORE_URL}?pt=${encodeURIComponent(pt)}&ct=${tag}&mt=8`;
}

// Where the app's own forms fall back to when the table cannot take the
// row (app/advertise.tsx, app/hire.tsx and app/support.tsx in the app
// repo): the app's own address (CONTACT_EMAIL in src/config.ts there), which the web bundle on this site already
// ships. The venue page's owner footer mails the same place with the same
// subject line as the advertise form, so a lead from either lands in the
// one thread.
export const SUPPORT_EMAIL = 'thirtyanow.app@gmail.com';

// The PUBLIC client credentials — the same pair the web app ships in its
// bundle. Anonymous reads see approved events only and anonymous writes may
// only insert a usage row with a null user_id, both enforced by RLS. Here so
// the generator and the embed strip's one-line beacon share one copy.
export const SUPABASE_URL = 'https://jbswxdkcpjjbqulsykvu.supabase.co';
export const ANON_KEY = 'sb_publishable_DXTI_TsCspkSefpj61a1tA_ufCj7GMQ';

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
 * between runs, and the run scheduled across beach midnight (05:10 UTC)
 * would fall at 23:10 in winter and 00:10 in summer; without the
 * roll-forward, winter's copy would spend the small hours stamped with
 * yesterday's date over shows that ended at midnight. An hour early with
 * the date printed on the page beats five hours late. Everything on the
 * page — title, lead and JSON-LD — is labelled from `start`, never from the
 * moment of generation.
 *
 * GitHub has in fact started that run 4 to 6.5 hours late every night it
 * has been scheduled (10-30 Sep 2026), so the page does not count on it:
 * EXPIRE hides finished rows in the reader's browser and says when the
 * night the page covers is over.
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

// ---------------------------------------------------------------------------
// Names that are not a venue
// ---------------------------------------------------------------------------

/**
 * Venue strings the importer writes when no venue is the answer. "Venues
 * along 30A" is CORRIDOR_WIDE in scraper/scrape.mjs (app repo): the
 * Songwriters Festival plays thirty rooms, so no bar is its venue. The rest
 * are the source names the importer falls back to when a listing names no
 * place at all (`|| source.name` there). Until 1 Oct 2026 each of these
 * could earn a venue page like a bar's - /venues/venues-along-30a/ was live
 * and in the sitemap, closing on "Run Venues along 30A? Put this week's
 * lineup on your site" and a $25 featured-show pitch.
 */
export const NOT_A_VENUE = ['Venues along 30A', '30A.com', '30A.com day view', 'SoWal', 'Visit South Walton'];

/**
 * The 30A neighbourhoods: a copy of AREAS in src/data/areas.ts (app repo),
 * keep the two in step. A row that names only its neighbourhood is filed
 * under that name as its venue ("the last resort and not an answer", in
 * the importer's words), so /venues/grayton-beach/ was every unplaced
 * Grayton row under "Run Grayton Beach?". A town is not a business, so its
 * page has no owner footer and offers no strip (`owner: false`); but the
 * page stays. /venues/alys-beach/ and the rest are indexed, and past this
 * weekend they are the only crawlable list of those rows.
 */
export const AREA_NAMES = [
  'Dune Allen', 'Gulf Place', 'Blue Mountain', 'Grayton Beach', 'WaterColor', 'Seaside',
  'Seagrove', 'WaterSound', 'Alys Beach', 'Rosemary Beach', 'Inlet Beach',
];

/**
 * Places that host events but are not a business anyone there could put a
 * strip on: the Walking Club meets at Seaside's post office, and until 1 Oct
 * 2026 /venues/post-office/ closed on "Run Post Office? Put this week's
 * lineup on your site, free" and a $25 featured-show pitch to the USPS.
 * Handled like a town (`owner: false`): the page and its rows stay, the
 * pitch goes. Not NOT_A_VENUE, which would take the page with it.
 */
export const NO_OWNER = ['Post Office'];

const placeholderKeys = new Set(NOT_A_VENUE.map((n) => n.toLowerCase()));
const areaKeys = new Set(AREA_NAMES.map((n) => n.toLowerCase()));
const noOwnerKeys = new Set(NO_OWNER.map((n) => n.toLowerCase()));

/** Whether a venue string names no place at all: empty, or a placeholder (NOT_A_VENUE). No page, no strip. */
export function isPlaceholderVenue(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return key === '' || placeholderKeys.has(key);
}

/**
 * Whether a venue string names a place someone runs, and so may have an
 * owner footer and a strip: not a placeholder, not a neighbourhood, not a
 * place no one runs (NO_OWNER), and not the row's own area (which catches
 * an area the copy above has not heard of yet).
 */
export function isVenueName(name, area = '') {
  const key = String(name ?? '').trim().toLowerCase();
  return (
    !isPlaceholderVenue(key) &&
    !areaKeys.has(key) &&
    !noOwnerKeys.has(key) &&
    key !== String(area ?? '').trim().toLowerCase()
  );
}

/**
 * One page per venue with `min` or more rows still ahead of `now`. Venue
 * strings are grouped case-insensitively (the scraper canonicalises them,
 * but a community post can still type "the red bar"); the spelling seen
 * first wins. Slugs that collide get -2, -3… so two pages never share a path.
 * A placeholder gets no page; a neighbourhood or a NO_OWNER place gets one
 * with `owner: false` (isVenueName), which renderVenue, embedVenues and
 * publishedStrips read.
 */
export function venuePages(events, now, min = 3) {
  const groups = new Map();
  for (const e of events) {
    const name = String(e.venue ?? '').trim();
    if (isPlaceholderVenue(name) || Date.parse(e.starts_at) < now) continue;
    const key = name.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { name, area: e.area ?? '', events: [], owner: true };
      groups.set(key, g);
    }
    if (!isVenueName(name, e.area)) g.owner = false;
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
// Arrival tags
// ---------------------------------------------------------------------------

/**
 * The `s=` value each generated page hands the live app.
 *
 * Until now a visitor who found /lineup/ in Google and clicked through
 * produced no row at all: app_open fires only once someone is a member or
 * has tapped "browse as guest", and web_arrival only when the URL carries a
 * tag (src/state/AppContext.tsx:984), so an untagged web visitor is neither
 * and nothing is written. The one channel whose whole point is new people
 * was the one channel with no data, and an empty bucket could not tell
 * "nobody clicked" from "nothing was tagged".
 *
 * One value per page rather than a flat "seo", so December's question — is
 * the weekend list working, or the venue pages? — is a group-by and not a
 * guess. `like 'seo%'` counts the crawlable site as a whole. Values stay
 * inside parseArrival's ^[\w.-]+$ and its 40-character cap.
 *
 * A tag on an internal /e/<id> link does create a second URL for a crawler,
 * which is why Google tells you not to campaign-tag your own site. Every
 * stub already carries a self-referencing canonical and the sitemap lists
 * only clean URLs, so the duplicates consolidate — and without it every
 * arrival collapses into seo-event and the page that did the work is lost.
 */
export const ARRIVAL = {
  lineup: 'seo-lineup',
  tonight: 'seo-tonight',
  venue: 'seo-venue',
  venues: 'seo-venue-index',
  event: 'seo-event',
  // The venue page's owner footer, on its "Feature a show" link into the
  // advertise form. Its own value rather than seo-venue because it answers
  // a different question — did anyone who runs the place come through the
  // block — and on the web it is the only signal that one did: the native
  // page's venue_owner_tap ping never fires here. Still `seo-`, since it is
  // an arrival off the crawlable site like the rest.
  owner: 'seo-venue-owner',
};

/** `path` with the tags that are set appended, merging with any query it already has. */
export function tagged(path, params = {}) {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  if (!q) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

/**
 * The ?ref= tag for a venue's embed strip — a port of embedRef in
 * src/data/venues.ts, character for character, so the static strip and the
 * one the app renders on native count under the same key. Built on the
 * card's spelling (knownVenue, the pages copy of venueCard) so a SoWal
 * "Red Bar" and a card's "The Red Bar" are one venue.
 */
export function embedRef(venue) {
  const name = knownVenue(venue)?.name ?? String(venue ?? '').trim();
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
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
.invited,.done{margin:14px 0 -6px;padding:10px 12px;border-radius:12px;background:var(--teal-soft);color:var(--teal-dark);font-size:14px;font-weight:600}
[hidden]{display:none!important}
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
.owner{max-width:720px;margin:30px auto 0;padding:16px;font-size:14px;border-top:1px solid var(--border)}
.owner p{margin:0 0 8px}
.owner pre{margin:8px 0;padding:10px 12px;background:var(--teal-soft);border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-all}
.owner button{padding:8px 14px;border:1.5px solid var(--teal);border-radius:10px;background:#fff;color:var(--teal-dark);font:inherit;font-size:14px;font-weight:700;cursor:pointer}
`;

/**
 * A static page cannot know the time, so it is told when each row ends
 * (data-end on every li.ev, rowHtml) and this hides what has finished, in
 * the reader's browser: a row once its end has passed, then any day
 * <section> or fitness <details> left with nothing in it. A page with a
 * "has finished" line (#done) shows it once every row on it has ended or,
 * on a page with no rows, once the day it names (data-day, the beach day
 * key it covers) is over on the beach clock. Never while a
 * row is still on: a 10 PM set runs past midnight, and until 1 Oct 2026
 * the day being over was enough, so at 12:10 AM the line said everything
 * had finished above the set the page was still showing. Beach time, never
 * the device's: a reader in Atlanta at 12:30 AM is still on the beach's
 * 11:30 PM.
 *
 * Why the browser and not the schedule: the 05:10 UTC run that was meant
 * to turn /tonight/ over at beach midnight has never started before 09:13
 * UTC (every night 10-30 Sep 2026: GitHub started it 4 to 6.5 hours late,
 * and no scheduled run at all between 21:27 and 09:12 UTC). So from
 * midnight to dawn /tonight/ read "Tonight on 30A - Wednesday" over shows
 * that had ended hours before, and every partner strip led with the
 * previous night's finished sets.
 *
 * Re-run each minute only where there are rows to watch - a strip on a
 * bar's TV, a tab left open - and silent on any failure: the page is right
 * as written, this only keeps it right.
 */
const EXPIRE = `  try{
    var tick=function(){
      var now=Date.now(),rows=document.querySelectorAll('li.ev[data-end]'),left=0,i,j;
      for(i=0;i<rows.length;i++){if(+rows[i].getAttribute('data-end')<=now)rows[i].hidden=true;else left++;}
      var box=document.querySelectorAll('section,details');
      for(i=0;i<box.length;i++){var r=box[i].querySelectorAll('li.ev'),on=0;for(j=0;j<r.length;j++)if(!r[j].hidden)on++;if(r.length&&!on)box[i].hidden=true;}
      var done=document.getElementById('done'),day=done&&done.getAttribute('data-day');
      var today=day?new Intl.DateTimeFormat('en-CA',{timeZone:'${BEACH_TZ}',year:'numeric',month:'2-digit',day:'2-digit'}).format(now):'';
      if(done&&!left&&(rows.length||(day&&today>day)))done.hidden=false;
      return rows.length;
    };
    if(tick())setInterval(tick,60000);
  }catch(e){}`;

// Tries the app first on an iPhone and falls back to the App Store after
// 1.5 s; a desktop click goes straight to the store. Safari shows its
// "cannot open" alert when the app is absent — universal links would need
// an AASA file and a new binary, so this is the honest version for now.
//
// The second block carries the visitor's own tag (?s=fb from a Thursday
// post, ?s=share off a shared link, ?ref=<venue> off a partner strip)
// across every internal hop, so however many of these pages a reader walks
// before leaping into the app, the arrival still names where they came in.
// It MERGES the two query strings. `live[i].href+=location.search` was fine
// while the links were bare, but now that they carry ?s=seo-lineup a
// visitor with a utm string produced "/weekend?s=seo-lineup?utm_source=x":
// parseArrival splits on & only, reads the value as "seo-lineup?utm_source=x"
// and drops it against ^[\w.-]+$ — the tag silently lost on exactly the
// visits worth counting. Only s, ref and from are forwarded, the keys the
// app reads, so no third-party campaign junk can shape a value again. The
// nav and the rows, not the footer: Privacy and Terms are the two
// boilerplate links that are also SPA routes, and a reader opening one from
// a share stub would otherwise be counted as a second arrival.
//
// from= rides the same hops since 27 Sep 2026. The app's friend invite
// links /lineup/?s=invite&from=<member id>, and the live Weekend screen
// turns the id into "Add <name> to your crew?" (app/weekend.tsx and
// src/utils/invite.ts in the app repo); until then an invite said nothing
// about who sent it, and made a friendship only when the invitee had the
// inviter's number in their contacts. Only a uuid is carried, lowercased,
// and nothing on these pages reads or shows it: the page is the same for
// everyone, and the name is the app's to look up. It also goes onto the
// "Open in 30A Now" button's thirtyanow:// link, the only way into the
// app from here on a binary older than the /lineup universal link claim
// (1.0.0 and 1.1.0), which would otherwise open the Weekend screen
// without it. s= and ref= stay off that link, as before: the app counts
// arrivals on the web only. A member id in from= also unhides the invite
// line above the buttons (INVITED_LINE), which says to come back and use
// that button after installing - the store drops from=, and the banner
// is written with it in <head> (bannerMeta).
//
// The store links get the same treatment once they carry a campaign tag
// (cta, storeUrl): ct= becomes the visitor's s, or embed-<venue> off a
// strip's ref, so an invite recipient who taps "Get it for iPhone" on
// /lineup/?s=invite is counted by App Store Connect under invite and not
// under seo-lineup, the page's own tag. Only a link that already carries a
// ct= is touched, so nothing changes while the provider token is empty.
//
// The third block is the venue page's copy button, and does nothing on the
// pages that have none. navigator.clipboard where the page may use it (a
// secure origin and a click — both true here), else the old select-and-
// execCommand path, so an owner on an older phone gets the snippet onto the
// clipboard rather than a dead button. What is copied is the text of the
// <code> beside the button, so it is exactly what is shown.
//
// The last block is EXPIRE (above): finished rows off the page.
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
    try{
      var q=new URLSearchParams(location.search),s=q.get('s'),r=q.get('ref'),f=q.get('from');
      f=f&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f)?f.toLowerCase():null;
      if(s||r||f){
        var links=document.querySelectorAll('header a[href^="/"],main a[href^="/"]');
        for(var i=0;i<links.length;i++){
          var u=new URL(links[i].href);
          if(s)u.searchParams.set('s',s);
          if(r)u.searchParams.set('ref',r);
          if(f)u.searchParams.set('from',f);
          links[i].href=u.pathname+u.search;
        }
        var app=open&&open.getAttribute('data-app');
        if(f&&app)open.setAttribute('data-app',app+(app.indexOf('?')<0?'?':'&')+'from='+f);
        var inv=document.getElementById('invited');
        if(f&&inv)inv.hidden=false;
      }
      if(s||r){
        var ct=s||('embed-'+r);
        var store=/^[A-Za-z0-9_.-]+$/.test(ct)?document.querySelectorAll('main a[href^="https://apps.apple.com/"]'):[];
        ct=ct.slice(0,40);
        for(var j=0;j<store.length;j++){
          var su=new URL(store[j].href);
          if(su.searchParams.has('ct')){su.searchParams.set('ct',ct);store[j].href=su.toString();}
        }
      }
    }catch(e){}
  }
  var copy=document.getElementById('copy'),code=document.getElementById('snippet');
  if(copy&&code){
    copy.addEventListener('click',function(){
      var done=function(){copy.textContent='Copied';setTimeout(function(){copy.textContent='Copy';},2000);};
      var select=function(){try{var r=document.createRange();r.selectNodeContents(code);var s=getSelection();s.removeAllRanges();s.addRange(r);if(document.execCommand('copy'))done();}catch(e){}};
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(code.textContent).then(done,select);else select();
    });
  }
${EXPIRE}
})();
</script>`;

/**
 * Safari's Smart App Banner. Its OPEN is the most prominent button on the
 * page for anyone who has the app, and it opens `app-argument` - which
 * named no inviter, so an invite opened that way reached the Weekend
 * screen with no idea who had sent it. Safari reads the meta as <head> is
 * parsed, long before the forwarder at the end of <body> runs, so the meta
 * is written by a one-line script right here instead, with the page's own
 * from= on the argument: a member id only, lowercased, as the forwarder
 * takes it. A browser without JavaScript gets the plain meta from the
 * <noscript> copy. The script opens on the same line as its tag, so the
 * tests' reading of the forwarder (the first "<script>" and a newline)
 * still finds the forwarder.
 */
export function bannerMeta(appArgument) {
  const arg = esc(appArgument);
  const js =
    `(function(){var a=${JSON.stringify(arg)},f=null;` +
    `try{f=new URLSearchParams(location.search).get('from');}catch(e){}` +
    `if(f&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f))` +
    `a+=(a.indexOf('?')<0?'?':'&amp;')+'from='+f.toLowerCase();` +
    `document.write('<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument='+a+'">');})();`;
  return `<script>${js}</script>
<noscript><meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${arg}"></noscript>`;
}

/**
 * Shared <head>. Every page unfurls as the large card: the branded
 * 1200x630 og-default.png with its size declared, so Facebook draws the
 * full-width card on the first share rather than after it has fetched the
 * image, or a page's own poster when it passes one (the event stub only).
 * A poster's size is not
 * known here, so only the default declares one — a wrong pair is worse
 * than none. `extraHead` is for the stub's <noscript> refresh.
 *
 * `ogTitle` and `ogDescription` are what the card says, when that must
 * differ from the <title> and description a search engine reads. Facebook
 * keys its card on og:url and re-reads it only every 30 days (or on "Scrape
 * Again" in its Sharing Debugger), and after 50 likes, shares and comments
 * the title can never change again. Every Thursday post, weekend share and
 * friend invite is /lineup/ under one og:url, so a dated card shows
 * whichever weekend Facebook read first: from the second Thursday on, the
 * card under the post named last weekend's dates and picks. A page whose
 * content turns over under a fixed URL passes text with no date in it.
 */
function head({
  title,
  description,
  ogTitle = title,
  ogDescription = description,
  path,
  appArgument,
  updated,
  image = OG_DEFAULT,
  card = 'summary_large_image',
  extraHead = '',
}) {
  const url = `${SITE}${path}`;
  const size =
    image === OG_DEFAULT
      ? `<meta property="og:image:width" content="${OG_DEFAULT_SIZE.width}">
<meta property="og:image:height" content="${OG_DEFAULT_SIZE.height}">
`
      : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${bannerMeta(appArgument)}
<meta property="og:site_name" content="30A Now">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(image)}">
${size}<meta name="twitter:card" content="${card}">
<meta name="generator" content="30anow share-cards ${esc(updated)}">
${extraHead}<style>${CSS}</style>
</head><body>
<header><a class="brand" href="/">30A Now</a><nav><a href="/lineup/">This weekend</a><a href="/tonight/">Tonight</a><a href="/venues/">Venues</a></nav></header>
<main>
`;
}

/**
 * Shown above the buttons, by the forwarder, only when the page was opened
 * with a member id as from= - an invite. An App Store install drops from=
 * (the store takes no argument through to the app), so someone who installs
 * from here opens a fresh app that knows nothing of the invite; only the
 * "Open in 30A Now" button below carries it. Nothing on the page said so,
 * and nothing said who had sent it. The name is the app's to look up.
 */
export const INVITED_LINE =
  'A friend invited you. Install 30A Now, then come back to this link and tap Open in 30A Now to add them.';

/**
 * The three ways off a page: into the app if it is installed, to the store,
 * and to the live map on the web. `tag` names the page on all three — the
 * store links carry it as ct= once the provider token is set (storeUrl),
 * the live link as s=.
 */
function cta({ appArgument, livePath, liveLabel, tag = '' }) {
  const store = storeUrl(tag);
  return `<p class="invited" id="invited" hidden>${esc(INVITED_LINE)}</p>
<div class="cta">
<a class="btn" id="open" href="${store}" data-app="${esc(appArgument)}">Open in 30A Now</a>
<a class="btn alt" href="${store}">Get it for iPhone</a>
<a class="live" href="${esc(tagged(livePath, { s: tag }))}">${esc(liveLabel)}</a>
</div>
`;
}

/** `extra` goes between </main> and the footer: outside the forwarder's reach (see SCRIPT). */
function foot(extra = '') {
  return `</main>
${extra}<footer>30A Now · the live map of Scenic Highway 30A, Santa Rosa Beach, FL · <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></footer>
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
 *
 * `tag`/`ref` ride on the share link so the page that fed the click is
 * named in the arrival; the stub's own forwarder carries whichever it is
 * on into the live app. `compact` is the partner strip: no scraped blurb,
 * no "Listing on sowal.com" — an aggregator's link has no business on the
 * bar's own homepage — and no neighbourhood, which the strip's header
 * says once instead of on all fourteen rows.
 */
export function rowHtml(
  e,
  venueSlugs = new Map(),
  { showVenue = true, compact = false, tag = '', ref = '' } = {},
) {
  const slug = venueSlugs.get(String(e.venue ?? '').trim().toLowerCase());
  const venue = !showVenue
    ? ''
    : slug
      ? `<a href="/venues/${slug}/">${esc(e.venue)}</a>`
      : esc(e.venue);
  const area = !compact && e.area && e.area !== e.venue ? esc(e.area) : '';
  const meta = [venue, area, esc(fmtWhen(e)), e.price ? esc(e.price) : '']
    .filter(Boolean)
    .join(' · ');
  const desc = !compact && e.description && e.description.trim() !== e.title.trim()
    ? `<p class="d">${esc(e.description.trim())}</p>`
    : '';
  const link = compact ? '' : safeUrl(e.url);
  const host = hostOf(link);
  const source = host
    ? `<div class="s"><a href="${esc(link)}" rel="nofollow noopener">Listing on ${esc(host)}</a></div>`
    : '';
  const href = tagged(`/e/${esc(e.id)}`, { s: tag, ref });
  // When the row is over, for EXPIRE to hide it in the reader's browser.
  const endMs = Date.parse(e.ends_at);
  const end = Number.isFinite(endMs) ? ` data-end="${endMs}"` : '';
  return `<li class="ev" id="e-${esc(e.id)}"${end}><a class="t" href="${href}">${esc(e.title)}</a><div class="m">${meta}</div>${desc}${source}</li>`;
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

/**
 * The line EXPIRE shows once everything on a page has ended, or once the
 * day a page with nothing on it covers is over on the beach clock: hidden
 * as written, so a crawler and a reader in the right hours see the page as
 * it is. Inside <main>, so the forwarder carries the visitor's tag onto its
 * link like any other. No day on a venue page, which is never written
 * without rows: there the line waits only for the last of them to end.
 */
function doneLine(dayKey, what, livePath, liveLabel, tag) {
  const day = dayKey ? ` data-day="${esc(dayKey)}"` : '';
  return `<p class="done" id="done"${day} hidden>Everything listed for ${esc(what)} has finished. <a href="${esc(tagged(livePath, { s: tag }))}">${esc(liveLabel)}</a></p>
`;
}

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
  // The branded card, never a show's poster. The page is the whole
  // weekend, and the first checked poster in time order was a Friday
  // morning gig's: on 24 Sep 2026 it was Crackings' 1080x1920 September
  // calendar ("9:30AM-12:30PM"), shared by two rows, which a large card
  // crops to a strip of names - and with no size to declare, Facebook drew
  // it only after fetching it. Every invite, weekend share and Thursday
  // group post unfurls from this URL - which is also why the card's own
  // text names no weekend (see head): the search title and description
  // keep the dates, the card cannot.
  const body =
    head({
      title: `This weekend on 30A — live music, markets and events ${range}`,
      description,
      ogTitle: 'This weekend on 30A — live music, markets and events',
      ogDescription: 'Every show, market and event on 30A this weekend, with times, venues and the live map.',
      path: '/lineup/',
      appArgument: 'thirtyanow://weekend',
      updated: fmtStamp(now),
    }) +
    `<h1>This weekend on 30A</h1>
<p class="lead">${esc(range)} · ${countLabel(main, 'event', 'events')}${classes ? ` + ${countLabel(classes, 'class', 'classes')}` : ''} · updated ${esc(fmtStamp(now))} beach time</p>
` +
    doneLine(beachDayKey(window.end), range, '/weekend', 'See the coming weekend live', ARRIVAL.lineup) +
    cta({
      appArgument: 'thirtyanow://weekend',
      livePath: '/weekend',
      liveLabel: 'See it live on the map',
      tag: ARRIVAL.lineup,
    }) +
    (days.length
      ? days.map((d) => daySection(d, slugMap(venues), { tag: ARRIVAL.lineup })).join('\n')
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
      // One URL every night, so the card names none (see head).
      ogTitle: 'Tonight on 30A — live music and events from 4 PM',
      ogDescription: "What's on along 30A tonight from 4 PM, with times, venues and the live map.",
      path: '/tonight/',
      appArgument: 'thirtyanow://feed',
      updated: fmtStamp(now),
    }) +
    `<h1>Tonight on 30A</h1>
<p class="lead">${esc(day)} · from 4 PM · updated ${esc(fmtStamp(now))} beach time</p>
` +
    doneLine(beachDayKey(window.start), day, '/feed', "See what's on now, live in the app", ARRIVAL.tonight) +
    cta({
      appArgument: 'thirtyanow://feed',
      livePath: '/feed',
      liveLabel: 'See it live in the app',
      tag: ARRIVAL.tonight,
    }) +
    (days.length
      ? days.map((d) => daySection(d, slugMap(venues), { tag: ARRIVAL.tonight })).join('\n')
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

/**
 * The one line of HTML a venue pastes to put its week on its own site: the
 * /embed/<slug>/ strip, in the shape docs/featured-shows.md (app repo) hands
 * out by hand. The slug rather than the venue's own name: the name form
 * needs %20s a page editor will mangle, and it is not written at all for a
 * name embedNameDir refuses, while every venue page's slug is a strip
 * (embedVenues orders as venuePages does, and the test holds it), and
 * stays one once handed out (publishedStrips), so this URL always answers
 * 200. The trailing slash skips the 301 GitHub Pages
 * sends the bare form through. The title is attribute-escaped, since the
 * snippet is HTML and a "Bud & Alley's" has to survive being pasted.
 */
export function embedSnippet(slug, name) {
  return `<iframe src="${SITE}/embed/${slug}/" width="100%" height="420" style="border:0" title="${esc(`This week at ${name}`)}"></iframe>`;
}

/**
 * The owner footer. A bar owner Googling their own place lands on
 * /venues/<slug>/ — the reason the page exists — and until 24 Sep 2026 the
 * live Red Bar page had the schedule, two App Store buttons and nothing
 * for them. The native venue page has carried its "Own this venue?" line
 * since launch; the crawlable one is where an owner actually arrives from
 * a search. Three things, in the order they cost: the strip for free, a
 * featured show for $25 (docs/featured-shows.md: the first one free), and
 * the address the app's own advertise form falls back to, with the same
 * subject line, so an owner who would rather write an email lands in the
 * same thread as one who filled the form.
 *
 * It sits OUTSIDE <main>, on purpose. The forwarder rewrites `s=` on every
 * link inside <main> to the visitor's own tag, which is right for a reader
 * who came off the Thursday post; but seo-venue-owner names the block, not
 * the visit, and it is the only web signal that anyone who runs the place
 * came through it. So it stays, whatever the reader arrived with.
 */
export function ownerFooter({ name, slug }) {
  const snippet = embedSnippet(slug, name);
  const advertise = tagged('/advertise', { business: name, s: ARRIVAL.owner });
  const mail = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Advertising on 30A Now — ${name}`)}`;
  return `<section class="owner">
<p><strong>Run ${esc(name)}?</strong> Put this week's lineup on your site, free. Paste this where the schedule goes — it keeps itself up to date and needs no account.</p>
<pre><code id="snippet">${esc(snippet)}</code></pre>
<p><button type="button" id="copy">Copy</button></p>
<p><a href="${esc(advertise)}">Feature a show — $25, first one free</a> · or email <a href="${esc(mail)}">${esc(SUPPORT_EMAIL)}</a></p>
</section>
`;
}

/**
 * /venues/<slug>/ — everything ahead at one venue, with its card when we
 * know it, and the owner footer unless no one runs the place (`owner:
 * false`, a neighbourhood: venuePages).
 */
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
  const liveLabel = `See ${name} live in the app`;
  // The lead counts what was ahead at the run, and a venue at the three-row
  // floor with all three sets on one evening can be over hours before the
  // next run takes the page down. Until review on 1 Oct 2026 EXPIRE hid
  // every row and day there and left nothing under "3 upcoming events" but
  // the buttons and "Also"; now it shows this line, as /tonight/ does.
  const body =
    head({
      title: `${name} — upcoming events and live music | 30A Now`,
      description,
      // The page is shared under one URL for good; "next up" is a date.
      ogDescription: `Upcoming events and live music at ${place} on 30A. Times, prices and the live map on 30A Now.`,
      path: `/venues/${slug}/`,
      appArgument,
      updated: fmtStamp(now),
    }) +
    `<h1>${esc(name)}</h1>
<p class="lead">${area && area !== name ? `${esc(area)} · ` : ''}${countLabel(events.length, 'upcoming event', 'upcoming events')} · updated ${esc(fmtStamp(now))} beach time</p>
${card}` +
    doneLine('', name, livePath, liveLabel, ARRIVAL.venue) +
    cta({ appArgument, livePath, liveLabel, tag: ARRIVAL.venue }) +
    days
      .map((d) => daySection(d, new Map(), { showVenue: false, tag: ARRIVAL.venue }))
      .join('\n') +
    `<section><h2>Also</h2><p><a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot(venue.owner === false ? '' : ownerFooter(venue));
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
    cta({
      appArgument: 'thirtyanow://',
      livePath: '/',
      liveLabel: 'Open the live map',
      tag: ARRIVAL.venues,
    }) +
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

// ---------------------------------------------------------------------------
// The partner strip
// ---------------------------------------------------------------------------

/**
 * /embed/<venue>/ — "This week at <venue>", the strip a bar drops into its
 * own site with one line of HTML.
 *
 * Until now this was the SPA route app/embed/[venue].tsx, and the export
 * wrote it as embed/[venue].html — a literal-bracket file matching no real
 * URL. So https://30anow.github.io/embed/The%20Red%20Bar answered HTTP 404
 * (checked 9 Sep 2026: 404, 26,940 bytes of shell) and only rendered at all
 * because GitHub Pages serves 404.html, whose body +html.tsx hides until
 * the app boots — after a 3.0 MB bundle, inside an iframe, on beach wifi.
 * It works, but it is a 404 that has to download the whole app to show six
 * rows on someone else's website, and one missing chunk after a redeploy
 * leaves the partner a blank box with nothing to report it.
 *
 * Static HTML answers 200, needs no bundle and cannot go blank: the rows
 * are in the file. Same rows the venue page renders (rowHtml), compact —
 * no scraped blurb, no link to an aggregator on the bar's own homepage —
 * over the same seven-day window venueWeek uses in the app. Every link
 * carries ?ref=<venue> and opens in a new tab (<base target="_blank">), so
 * the host page is never navigated away from inside its own iframe and an
 * install off the strip is attributable. noindex: the crawlable page for
 * this venue is /venues/<slug>/.
 */
export const EMBED_DAYS = 7;

/** The seven-day window the native strip shows: not yet over, starting inside a week. */
export function embedWeek(events, now) {
  const cutoff = now + EMBED_DAYS * 24 * 3600 * 1000;
  return events
    .filter((e) => Date.parse(e.ends_at) > now && Date.parse(e.starts_at) < cutoff)
    .sort(byStart);
}

/**
 * Venues whose strip URL is already in someone's hands. The snippet in
 * docs/featured-shows.md (app repo) went out to these; their iframe has to
 * answer 200 in a week with nothing on it, so they keep a page with an
 * honest empty state instead of falling back through the 404 shell.
 */
export const PUBLISHED_EMBEDS = [
  'The Red Bar',
  "Stinky's Bait Shack",
  'Red Fish Taco',
  'Old Florida Fish House',
];

/**
 * One strip per venue with anything still ahead of it — a venue page needs
 * three rows to be worth a crawl, a strip needs one to be worth pasting —
 * plus the published four however quiet they are, plus every strip a venue
 * page has handed out (`published`, from publishedStrips).
 *
 * That last part since 1 Oct 2026. Every venue page's owner footer has
 * given out /embed/<slug>/ since 25 Sep, and its snippet promises a URL
 * that always answers - but the strip lived only while the venue had a row
 * ahead. When the last one ended the next run deleted the directory, and a
 * bar that had pasted the snippet showed the 404 shell and a 3 MB bundle
 * inside its own homepage, under "THIS WEEK AT pickles-sandbar" (the SPA
 * could not read a slug). Crackings lost its strip that way on 30 Sep. A
 * handed-out slug now keeps the honest empty strip under the venue's own
 * name; and where its venue is still on under another slug - a collision's
 * -2 that moved, another spelling of the same bar - it is that strip.
 *
 * A neighbourhood's page offers no strip (`owner: false`), so a town gets
 * one only where its page handed one out before 1 Oct 2026 and the list
 * kept it: then it is the town's strip like any other, rows and all.
 */
export function embedVenues(events, now, published = []) {
  const handedOut = new Set(published.map((p) => p.slug));
  const out = venuePages(events, now, 1).filter((v) => v.owner || handedOut.has(v.slug));
  const byKey = new Map(out.map((v) => [v.name.toLowerCase(), v]));
  const seenRef = new Set(out.map((v) => embedRef(v.name)));
  const seenSlug = new Set(out.map((v) => v.slug));
  const add = (name, area, rows) => {
    const ref = embedRef(name);
    if (seenRef.has(ref)) return null;
    const base = slugify(name);
    let slug = base;
    for (let n = 2; seenSlug.has(slug); n += 1) slug = `${base}-${n}`;
    seenRef.add(ref);
    seenSlug.add(slug);
    const group = { name, area, events: rows, slug, known: knownVenue(name) };
    out.push(group);
    byKey.set(name.toLowerCase(), group);
    return group;
  };
  // venuePages keeps only rows still ahead of `now` — right for a page of
  // upcoming events, wrong for a strip on the bar's own homepage at 9 PM,
  // where the band that went on at 7 is the whole point. Put back what is
  // playing right now, and give a venue with nothing but that its strip -
  // a town only where its strip was handed out.
  for (const e of events) {
    if (Date.parse(e.starts_at) >= now || Date.parse(e.ends_at) <= now) continue;
    const name = String(e.venue ?? '').trim();
    if (isPlaceholderVenue(name)) continue;
    const mayAdd = isVenueName(name, e.area) || handedOut.has(slugify(name));
    const group = byKey.get(name.toLowerCase()) ?? (mayAdd ? add(name, e.area ?? '', []) : null);
    if (group) group.events.push(e);
  }
  for (const name of PUBLISHED_EMBEDS) add(name, '', []);
  for (const { slug, name } of published) {
    if (seenSlug.has(slug) || isPlaceholderVenue(name)) continue;
    seenSlug.add(slug);
    const ref = embedRef(name);
    const same = ref && out.find((v) => embedRef(v.name) === ref);
    if (same) {
      same.alias = [...(same.alias ?? []), slug];
    } else {
      seenRef.add(ref);
      out.push({ name, area: '', events: [], slug, known: knownVenue(name) });
    }
  }
  for (const group of out) group.events.sort(byStart);
  return out;
}

/** What a strip slug may look like: slugify's output, so never a path that leaves embed/. */
export const STRIP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The list of strips handed out, as share-cards.mjs keeps it in
 * embed/published.json: what it held, plus every venue page this run with
 * an owner footer (each one hands out its slug; a neighbourhood's page has
 * none), one entry per slug with the name last seen on it. Only ever grows
 * - a pasted snippet does not expire - except that a slug that cannot be a
 * directory, or a placeholder name (isPlaceholderVenue), is dropped. A
 * town's slug that a page handed out before 1 Oct 2026 stays like any
 * other: a town events team may have pasted it. Sorted, so the file
 * changes only when the list does.
 */
export function publishedStrips(prev, venues) {
  const bySlug = new Map(prev.map((p) => [p.slug, p.name]));
  for (const v of venues) if (v.owner !== false) bySlug.set(v.slug, v.name);
  return [...bySlug]
    .filter(([slug, name]) => STRIP_SLUG.test(slug) && !isPlaceholderVenue(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slug, name]) => ({ slug, name }));
}

/**
 * embed/published.json, read back. A file that does not parse as a list
 * throws: the run stops before a strip is deleted, which is the safe side
 * (a red Action leaves the strips up). An entry that is not a strip slug
 * and a name is dropped - the slug becomes a directory.
 */
export function parsePublished(text) {
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error('embed/published.json is not a list');
  return list
    .filter((p) => p && typeof p.slug === 'string' && STRIP_SLUG.test(p.slug) && typeof p.name === 'string')
    .map((p) => ({ slug: p.slug, name: p.name.trim() }))
    .filter((p) => p.name && p.name.length <= 200);
}

/** The commit here that shipped the owner footer (25 Sep 2026): every venue page from it on handed out its slug. */
export const FOOTER_SHIPPED = '106958c86c0043a8aea7823afc3a6842b878d9af';

/**
 * The git log share-cards.mjs reads those pages out of: each commit since
 * FOOTER_SHIPPED (it included), newest first, as "commit <sha>" and then
 * every venue page it wrote.
 */
export const FOOTER_LOG_ARGS = [
  'log', '--format=commit %H', '--name-only', '--no-renames', '--diff-filter=AM',
  `${FOOTER_SHIPPED}^..HEAD`, '--', 'venues/',
];

/**
 * The venue pages in that log whose slug has no strip on the site now
 * (`have`, embed/'s directory names): [{ slug, at }], `at` the last commit
 * that wrote the page, for share-cards.mjs to read its <h1> back from.
 */
export function lostFooterPages(log, have) {
  const strips = new Set(have);
  const lost = new Map();
  let at = '';
  for (const line of String(log ?? '').split('\n')) {
    const text = line.replace(/\r$/, '');
    const commit = /^commit ([0-9a-f]{40})$/.exec(text);
    if (commit) {
      at = commit[1];
      continue;
    }
    const slug = /^venues\/([^/]+)\/index\.html$/.exec(text)?.[1];
    if (at && slug && STRIP_SLUG.test(slug) && !strips.has(slug) && !lost.has(slug)) lost.set(slug, at);
  }
  return [...lost].map(([slug, at]) => ({ slug, at }));
}

/**
 * Slugs a footer handed out whose strip had already gone when the list was
 * written, checked against this repo's history and embed/ on 1 Oct 2026:
 * only Crackings - its page went on 28 Sep, its strip on 30 Sep. A run
 * that reads the history (lostFooterPages) finds it there too; this is for
 * one that cannot.
 */
const GONE_BEFORE_THE_LIST = [{ slug: 'crackings', name: 'Crackings' }];

/**
 * The first run that keeps the list has none to read, and the footers have
 * been handing out slugs since 25 Sep 2026. So it starts from the strips
 * already on the site: every slug directory, under the name in its <h1>;
 * plus every venue page that handed out a slug whose strip has gone since
 * (`lost`, read out of git history by share-cards.mjs, its <h1> the name
 * too); plus GONE_BEFORE_THE_LIST. The strips alone would not do: until
 * this generator replaces the old one, that one goes on deleting a strip
 * the run after its venue's last row ends, and a slug missing from the
 * seed stays missing. That is a few one-row venues more than the footers
 * ever offered, which is the safe side of the line. `dirs` and `lost` are
 * [{ dir, html }].
 */
export function seedPublished(dirs, lost = []) {
  const unescape = (s) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const seen = [];
  for (const { dir, html } of [...dirs, ...lost]) {
    if (!STRIP_SLUG.test(dir) || seen.some((p) => p.slug === dir)) continue;
    const name = unescape(/<h1>([^<]*)<\/h1>/.exec(html ?? '')?.[1] ?? '').trim();
    if (name) seen.push({ slug: dir, name });
  }
  return [...seen, ...GONE_BEFORE_THE_LIST.filter((g) => !seen.some((p) => p.slug === g.slug))];
}

/**
 * The venue's own name as a directory, or '' when it cannot safely be one.
 *
 * The published snippet uses the name, not the slug, so that spelling has
 * to keep answering — but a venue string is scraped text. A "/" would write
 * outside embed/, and : * ? " < > | make a tree that cannot be cloned on
 * Windows at all, which would take the whole site's deploy down with it.
 */
export function embedNameDir(name) {
  const s = String(name ?? '').trim();
  if (!s || s.length > 80 || s === '.' || s === '..') return '';
  // Control characters, and the punctuation Windows refuses in a path.
  if (/[\u0000-\u001f\u007f\/\\:*?"<>|]/.test(s)) return '';
  if (s.endsWith('.')) return ''; // Windows strips a trailing dot silently
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) return '';
  return s;
}

/**
 * Every directory to write, in order: /embed/<slug>/ for each venue, plus
 * /embed/<its own name>/ where that is a different path.
 *
 * "Different" is judged case-INSENSITIVELY, and that is the whole reason
 * this is a function. "Crackings" and its slug "crackings" are two paths on
 * the Linux box that builds the site and one path on the Windows and macOS
 * machines that clone it — two git entries over one file, a working tree
 * that can never be clean. The slug wins, since it is the spelling
 * /venues/<slug>/ already uses. A handed-out slug that now belongs to a
 * venue on under another one (`alias`, embedVenues) is the same strip again.
 */
export function embedDirs(venues) {
  const taken = new Set();
  const out = [];
  for (const venue of venues) {
    for (const dir of [venue.slug, ...(venue.alias ?? []), embedNameDir(venue.name)]) {
      if (!dir || taken.has(dir.toLowerCase())) continue;
      taken.add(dir.toLowerCase());
      out.push({ dir, venue });
    }
  }
  return out;
}

const EMBED_CSS = `
:root{--ink:#16303A;--sub:#5E7680;--teal:#0E7C86;--border:#E3EBEE}
*{box-sizing:border-box}
body{margin:0;padding:14px;background:#fff;color:var(--ink);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
.hd{display:flex;align-items:center;gap:10px}
.hd h1{margin:1px 0 0;font-size:19px;font-weight:900;line-height:1.15}
.over{margin:0;font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--teal)}
.where{margin:1px 0 0;font-size:12.5px;color:var(--sub)}
.dir{flex:none;padding:7px 10px;border:1.5px solid var(--teal);border-radius:10px;font-size:12.5px;font-weight:800;color:var(--teal);text-decoration:none}
h2{margin:12px 0 2px;font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--sub)}
ul.rows{list-style:none;margin:0;padding:0}
li.ev{padding:8px 0;border-top:1px solid var(--border)}
.t{display:block;font-size:14.5px;font-weight:700;color:var(--ink);text-decoration:none}
.m{margin-top:1px;font-size:12px;color:var(--sub)}
.quiet{padding:22px 0;text-align:center;font-size:13.5px;color:var(--sub)}
.foot{display:block;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);text-align:center;font-size:12.5px;color:var(--sub);text-decoration:none}
.foot b{color:var(--teal)}
.stamp{margin:4px 0 0;text-align:center;font-size:11px;color:var(--sub)}
[hidden]{display:none!important}
`;

/**
 * embed_view, without the component it used to ride on. One POST, the same
 * name, props and shape the native strip sends (src/lib/telemetry.ts), so
 * an existing count over usage_events keeps working; app_version says
 * "pages" so the static strip is still tellable from the app's. Anonymous
 * insert with a null user_id is all the RLS policy allows, and the key is
 * the one the web bundle already ships. Wrapped in try/catch and failing
 * silent: a partner's homepage must never see anything from this.
 */
function embedBeacon(venue) {
  const name = JSON.stringify(venue).replace(/</g, '\\u003c');
  return `<script>
(function(){
  function ping(n){
    try{
      var p={venue:${name},platform:'web'};
      if(document.referrer){try{p.host=new URL(document.referrer).hostname;}catch(e){}}
      fetch(${JSON.stringify(`${SUPABASE_URL}/rest/v1/usage_events`)},{method:'POST',keepalive:true,
        headers:{apikey:${JSON.stringify(ANON_KEY)},Authorization:${JSON.stringify(`Bearer ${ANON_KEY}`)},
          'Content-Type':'application/json',Prefer:'return=minimal'},
        body:JSON.stringify({name:n,props:p,platform:'web',app_version:'pages'})}).catch(function(){});
    }catch(e){}
  }
  ping('embed_view');
  var a=document.getElementById('pitch');
  if(a)a.addEventListener('click',function(){ping('embed_app_tap');});
})();
</script>`;
}

/** The strip for one venue, whole in itself: inline CSS, no bundle, no fetch. */
export function renderEmbed(venue, now) {
  const { name, area, events } = venue;
  const ref = embedRef(name);
  const where = area && area !== name ? `<p class="where">${esc(area)}</p>` : '';
  const rows = embedWeek(events, now);
  // Coordinates from any row at this venue, past ones included: a bar
  // between lineups is still at its address.
  const spot = events.find((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  const dir = spot
    ? `<a class="dir" href="https://www.google.com/maps/dir/?api=1&amp;destination=${spot.lat},${spot.lng}">Directions</a>`
    : '';
  // Each day is a <section> so EXPIRE can drop it once its sets are over,
  // and the empty line is written hidden beside the rows for the hour
  // they have all ended - a strip read at 2 AM listed the night's
  // finished sets until the morning run (see EXPIRE).
  const quiet = `<p class="quiet"${rows.length ? ' id="done" hidden' : ''}>Nothing posted for the next seven days.</p>`;
  const body = rows.length
    ? groupByDay(rows)
        .map(
          (d) =>
            `<section><h2>${esc(d.label)}</h2><ul class="rows">${[...d.main, ...d.fitness]
              .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
              .map((e) => rowHtml(e, new Map(), { showVenue: false, compact: true, ref }))
              .join('')}</ul></section>`,
        )
        .join('\n') + `\n${quiet}`
    : quiet;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>This week at ${esc(name)} — 30A Now</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<base target="_blank">
<style>${EMBED_CSS}</style>
</head><body>
<div class="hd"><div><p class="over">THIS WEEK AT</p><h1>${esc(name)}</h1>${where}</div>${dir}</div>
${body}
<a class="foot" id="pitch" href="${esc(tagged('/', { ref }))}" rel="noopener">Powered by <b>30A Now</b> · Get the app</a>
<p class="stamp">Updated ${esc(fmtStamp(now))} beach time</p>
${embedBeacon(name)}
${rows.length ? `<script>\n(function(){\n${EXPIRE}\n})();\n</script>\n` : ''}</body></html>
`;
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
      image: poster || OG_DEFAULT,
      extraHead: `<noscript><meta http-equiv="refresh" content="3;url=${live}"></noscript>\n`,
    }) +
    `<h1>${esc(e.title)}</h1>
<p class="lead">${lead}</p>
` +
    (poster ? `<img class="poster" src="${esc(poster)}" alt="">\n` : '') +
    cta({ appArgument, livePath: live, liveLabel: 'See it on the live map', tag: ARRIVAL.event }) +
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
