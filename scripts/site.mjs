// Pages a crawler can read. The SPA renders everything client-side, so on
// 8 Sep 2026 a site:30anow.github.io search returned nothing: /, /weekend,
// /robots.txt and /sitemap.xml were the same 25,902-byte shell whose only
// visible text ended in "Loading the beach…", and /event/<id> answered a
// crawler with HTTP 404. These generators write the same rows the app shows
// as plain HTML with one JSON-LD Event per row, then hand the reader to the
// app: /lineup/ (Fri–Sun), /tonight/, /venues/<slug>/ for every venue with
// three or more upcoming rows, /acts/<slug>/ for every act with two or more
// (6 Oct 2026; actKey.mjs says who an act is) and for every act that has
// had a page before (10 Oct 2026; publishedActs), plus sitemap.xml and
// robots.txt — and /embed/<venue>/, the partner strip, for the same reason:
// it was an SPA route that answered a partner's iframe with HTTP 404 and a
// 3.0 MB bundle. Since 14 Oct 2026 each slug-shaped strip of a place
// someone runs also carries /sign/, the printable door sign with the QR
// code the owner used to make by hand (renderSign; qr.mjs draws the code).
// Since 15 Oct 2026 there is /towns/<slug>/ too, one per neighbourhood in
// AREA_NAMES with anything on in the next seven beach days, and /towns/,
// their index: "things to do in Seaside this week" is the search a visitor
// planning a trip types, and no page here answered it (townPages).
//
// Pure functions only — share-cards.mjs fetches the rows and writes files.
// Every date on these pages is beach time (America/Chicago); the helpers
// below are ports of src/utils/time.ts in the app repo and the tests pin
// the same instants that repo's tests pin.

import { ACT_PAGE_MIN, actKey, actLabel, actSlug, actTitleKey } from './actKey.mjs';
import { CALENDAR_TAG, calendarIcs, calendarLinks } from './ics.mjs';
import { qrProblem, qrSvg } from './qr.mjs';

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

/** esc, undone: a name read back out of a page's own <h1> (seedPublished, seedPublishedActs). */
const unescapeHtml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const byStart =(a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at);

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
  'Bayside', 'Hogtown Bayou', 'Point Washington', 'Serenoa',
];

/**
 * The twelfth area (12 Oct 2026): the south foot of the US 331 bridge over
 * Choctawhatchee Bay, where The Bay and North Beach Social sit, five miles
 * up the road from Grayton. Not a beach neighbourhood and not a town, so a
 * Bayside row's JSON-LD locality is Santa Rosa Beach alone, a Bayside
 * venue's page says where it is rather than "on 30A", and an act whose
 * every show is there is "near 30A" (where30A, postalAddress, renderAct).
 */
export const BAYSIDE = 'Bayside';

/**
 * The off-beach areas and where each is, in the words after its name:
 * Bayside (12 Oct 2026), and three the owner added on 17 Oct 2026, each a
 * named handful of venues between US 98 and the bay - Hogtown Bayou
 * (Redd's Pub, Bayou Arts Center), Point Washington (Eden Gardens State
 * Park) and Serenoa (Idyll Hounds Brewing, Distillery 98). The app's
 * src/data/areas.ts marks the same four off-beach. None is a beach
 * neighbourhood or a town a searcher types, so each reads like Bayside:
 * the town alone in the JSON-LD, its place in words on its pages, and an
 * act that plays only there is "near 30A".
 */
export const OFF_BEACH = new Map([
  [BAYSIDE, 'on Choctawhatchee Bay, minutes from 30A'],
  ['Hogtown Bayou', 'off US 98, minutes from 30A'],
  ['Point Washington', 'off US 98, minutes from 30A'],
  ['Serenoa', 'off US 98, minutes from 30A'],
]);

/** Whether an area is one of the off-beach ones (OFF_BEACH). */
export const isOffBeach = (area) => OFF_BEACH.has(area);

/** The phrase after a place: "on 30A" for the corridor, its own words for an off-beach area. */
const where30A = (area) => OFF_BEACH.get(area) ?? 'on 30A';

/**
 * An act whose every show is at a Bayside venue is "near 30A": the bay end
 * of 331 is not on the road. A corridor act, or one that plays both, is
 * "on 30A". The full page reads it off the act's rows (renderAct); the
 * page between shows has no rows, so the list keeps the answer per act
 * (publishedActs, `near`) and the two pages say the same place, as the
 * card a share unfurls into must whichever week it is read.
 */
export const actNear30A = (events) => events.length > 0 && events.every((e) => isOffBeach(e.area));
const actWhere = (near) => (near ? 'near 30A' : 'on 30A');

/**
 * Places that host events but are not a business anyone there could put a
 * strip on: the Walking Club meets at Seaside's post office, and until 1 Oct
 * 2026 /venues/post-office/ closed on "Run Post Office? Put this week's
 * lineup on your site, free" and a $25 featured-show pitch to the USPS.
 * Handled like a town (`owner: false`): the page and its rows stay, the
 * pitch goes. Not NOT_A_VENUE, which would take the page with it.
 *
 * The post office was not the only one. Read against the live sitemap on
 * 1 Oct 2026, 12 more of the 41 venue pages pitched a place no one sells a
 * show from. NO_OWNER_KIND knows eight of them by their last words, and so
 * the next one like them: a church, a chapel, a town hall, two squares, a
 * beach access, a sports complex and a set of tennis courts. No word gives
 * the other four away, so they are named here. All twelve keep their
 * strips, since every one had handed out its slug (embed/published.json).
 * Matched on the slug, so "Hope on the Beach – Orange Street" with an en
 * dash is the same place.
 *
 * The sitemap was not the whole of it. Four more places had rows in the
 * feed, or a strip in embed/ the week before, and no page only because none
 * had three rows ahead; the run that gave one its third would have closed
 * its page on "Run <it>?" and the $25 pitch. A public school is caught by
 * kind now (NO_OWNER_KIND); the other three are named below. The two whose
 * strips were still in embed/ on 1 Oct 2026 keep them, like the twelve.
 */
export const NO_OWNER = [
  'Post Office',
  // Seaside's open-air stage on Central Square (Sounds of Seaside, the
  // farmers market) and two of its pavilions (morning yoga, beach volleyball).
  'Seaside Amphitheater',
  'Seaside Pavilion',
  'Coleman Pavilion',
  // A Sunday service on the Orange Street beach access.
  'Hope on the Beach - Orange Street',
  // Alys Beach's open-air stage, the same kind of place as Seaside's (a
  // wellness morning on 9 Oct 2026), and its town park (the Alys Classics
  // films in late Sep).
  'Alys Beach Amphitheatre',
  'Central Park Alys Beach',
  // A St. Joe neighbourhood like WaterColor and WaterSound (PorchFest, 11
  // Oct). Not in AREA_NAMES, which has to match the app's own list of areas.
  'Watersound Origins',
];

/**
 * The kinds of place no one there could buy a featured show for, by the
 * words their names end in: post offices, town and city halls, libraries,
 * churches and chapels, beach accesses, state parks, public squares, sports
 * complexes and courts, and public schools (Dune Lakes Elementary School
 * hosts a kids' soccer club); and "The Chapel at …", "Church of …", which
 * lead with the word. Last words only, so Church Street Bistro and The
 * Library Bar keep their pitch. Not a bare "school": 30A Surf School sells
 * lessons. Not "pavilion" or "amphitheater": Peddlers Pavilion books a band
 * most nights, and a ticketed amphitheater is a business. Not a plain "park"
 * either, since a water park or an RV park is one too; a town park goes in
 * NO_OWNER by name when it turns up, as Central Park Alys Beach did.
 */
export const NO_OWNER_KIND =
  /\b(?:post office|town hall|city hall|library|church|chapel|beach access|state park|square|sports complex|courts|elementary school|middle school|high school)$|^(?:the )?(?:chapel|church) (?:at|of|on|in)\b/;

const placeholderKeys = new Set(NOT_A_VENUE.map((n) => n.toLowerCase()));
const areaKeys = new Set(AREA_NAMES.map((n) => n.toLowerCase()));
const noOwnerSlugs = new Set(NO_OWNER.map(slugify));

/** Whether a venue string names no place at all: empty, or a placeholder (NOT_A_VENUE). No page, no strip. */
export function isPlaceholderVenue(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return key === '' || placeholderKeys.has(key);
}

/**
 * Whether a venue string names a place someone runs, and so may have an
 * owner footer and a strip: not a placeholder, not a neighbourhood, not a
 * place no one runs (NO_OWNER by name, NO_OWNER_KIND by kind), and not the
 * row's own area (which catches an area the copy above has not heard of yet).
 */
export function isVenueName(name, area = '') {
  const key = String(name ?? '').trim().toLowerCase();
  return (
    !isPlaceholderVenue(key) &&
    !areaKeys.has(key) &&
    !noOwnerSlugs.has(slugify(key)) &&
    !NO_OWNER_KIND.test(key) &&
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

/**
 * One page per act with `min` or more shows still on or ahead at `now`,
 * at any venue: the band a title names, under every spelling the sources
 * give it (actKey). A music row still ahead founds the act, and every row
 * ahead whose title names it is one of its shows, whatever the importer
 * filed it under (10 Oct 2026; actKey.mjs has why): a daytime set comes
 * in as community and a "friends and family" blurb as family, and counted
 * by music rows alone the page that says "every show" left those out,
 * while an act with one music row and one daytime set had no page at all.
 * Rows that no music row names make no page, as before. The app applies
 * the same rule to the same rows (actShows), and the fixture's week pins
 * both. Alphabetical by the spelling shown (actLabel),
 * so the index reads as a list of names. Two is the floor because one
 * show is the event's own page, and the app's act page offers its share
 * only from two (ACT_PAGE_MIN, the same number in both repos).
 *
 * The slug is the key with dashes for spaces, not the slug of the name
 * shown (10 Oct 2026). The name is the most frequent spelling among the
 * rows left, so it tips as shows end - "Dion Jones and The Neon Tears" on
 * Monday, "Dion Jones & Neon Tears" by Thursday in the fixture's week -
 * and share-cards.mjs wipes acts/ before every run: a path made from the
 * name would have moved under the link a band posted, and the app, which
 * holds the same rows at another minute, could have shared the path this
 * run did not write. A key is a to z, digits and spaces, one per act, so
 * no two acts share a slug and nothing here needs a -2.
 *
 * `venues` counts a bar once however a source spells it (knownVenue, the
 * app's followKey): "The Red Bar" and "Red Bar" are one venue, as on the
 * app's act page and its event page's door.
 *
 * A page once written stays (10 Oct 2026). `published` is every slug an
 * act page has been written under (publishedActs; share-cards.mjs keeps
 * it in acts/published.json), and an act on it keeps its page with one
 * show ahead. Two is what starts a page, and as first built it was also
 * what took one down: acts/ was cleared on every run, so a page went the
 * run after its act's second-to-last show ended, with the last one still
 * ahead - and the page is the link the app's Share sends and the one its
 * own footer asks a band to post. Over the 24 Sep 2026 snapshot with no
 * further import, 19 acts had a page on the first run and six lost it
 * inside eight days with a show to come: Michael Johnson's went at the
 * Friday 9:47 PM run, 19 hours before his Saturday set at Havana Beach
 * Bar & Grill. What answered then was 404.html, the web app's shell, and
 * the web app has no /acts route: "404 - You've drifted off the map". A
 * slug on the list with nothing ahead at all keeps a short page of its
 * own (quietActs, renderActQuiet). The app's Share still waits for two
 * shows, so the link it sends is a page that was written at two.
 */
export function actPages(events, now, published = [], min = ACT_PAGE_MIN) {
  const handedOut = new Set(published.map((p) => p.slug));
  const ahead = events.filter((e) => Date.parse(e.ends_at) > now);
  const groups = new Map();
  // The acts first, founded by the music rows; then every row ahead that
  // names one of them, in the order given.
  for (const e of ahead) {
    const key = actKey(e);
    if (key && !groups.has(key)) groups.set(key, { key, events: [] });
  }
  for (const e of ahead) {
    const key = actTitleKey(e);
    const g = key ? groups.get(key) : undefined;
    if (g) g.events.push(e);
  }
  const out = [];
  for (const g of groups.values()) {
    const slug = actSlug(g.key);
    if (g.events.length < min && !handedOut.has(slug)) continue;
    g.events.sort(byStart);
    const label = actLabel(g.events, g.key, now);
    const venues = new Set(
      g.events.map((e) => (knownVenue(e.venue)?.name ?? String(e.venue ?? '').trim()).toLowerCase()),
    ).size;
    out.push({ ...g, label, slug, venues });
  }
  return out.sort(
    (a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key),
  );
}

/** What an act page's slug may look like: actSlug's output, so never a path that leaves acts/. */
export const ACT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The list of act pages written so far, as share-cards.mjs keeps it in
 * acts/published.json: what it held, plus every act page of this run, one
 * entry per slug under the name last shown on it. It only grows - a link
 * a band has posted, or a member has sent, does not expire - except that
 * a slug that cannot be a directory is dropped. Sorted, so the file
 * changes only when the list does. The strips have had the same list
 * since 1 Oct 2026 (publishedStrips), for the same reason: Crackings'
 * pasted strip went to the 404 shell the run after its last row ended.
 *
 * An entry also says where the act played, when its page last said "near
 * 30A" (`near: true`, actNear30A; 12 Oct 2026): the page between shows
 * has no rows to read it off, and without it a Bayside act's quiet page
 * said "on 30A" where its full page had said "near", so the card under a
 * posted link changed the run after the last show. Left out when false,
 * so a corridor act's entry, and the file, are as they were.
 */
export function publishedActs(prev, acts) {
  const bySlug = new Map(prev.map((p) => [p.slug, { name: p.name, near: p.near === true }]));
  for (const a of acts) bySlug.set(a.slug, { name: a.label, near: actNear30A(a.events) });
  return [...bySlug]
    .filter(([slug, { name }]) => ACT_SLUG.test(slug) && String(name ?? '').trim())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slug, { name, near }]) => ({ slug, name: String(name).trim(), ...(near ? { near: true } : {}) }));
}

/**
 * The slugs on the list with no page this run: an act with nothing ahead
 * of `now`, or a title the key no longer reads as one. Each keeps
 * /acts/<slug>/ as renderActQuiet writes it, under the name its page last
 * showed.
 */
export function quietActs(published, acts) {
  const written = new Set(acts.map((a) => a.slug));
  return published.filter((p) => !written.has(p.slug));
}

/**
 * The first run that keeps the list has none to read, and act pages are
 * as new as the list, so it starts empty. Unless there are act pages on
 * the site already: then the file has been lost, and the list starts from
 * them, each under the name in its <h1> and the place its card says (the
 * full page's and the quiet page's og:title are one), so losing the file
 * takes no page down. `dirs` is [{ dir, html }], the directories under
 * acts/.
 */
export function seedPublishedActs(dirs) {
  const seen = new Map();
  for (const { dir, html } of dirs) {
    if (!ACT_SLUG.test(dir) || seen.has(dir)) continue;
    const name = unescapeHtml(/<h1>([^<]*)<\/h1>/.exec(html ?? '')?.[1] ?? '').trim();
    const near = /<meta property="og:title" content="[^"]* near 30A — upcoming shows">/.test(html ?? '');
    if (name) seen.set(dir, { name, near });
  }
  return publishedActs([...seen].map(([slug, { name, near }]) => ({ slug, name, near })), []);
}

// ---------------------------------------------------------------------------
// Calendar feeds (18 Oct 2026; scripts/ics.mjs has the format and why).
// Each lives where its page's link can never go dead: a venue's beside its
// strip, under embed/<slug>/, which keeps every slug a venue page has handed
// out (embed/published.json) even when the venue has fallen below the
// venue page's three rows; an act's beside its page, under acts/<slug>/,
// kept the same way (acts/published.json). A quiet week writes the file
// with no events, so a subscription never meets a 404.
// ---------------------------------------------------------------------------

/** The place line a calendar shows: the street when the venue is known, else the town as the pages' structured data names it. */
export function icsLocation(e) {
  const venue = String(e.venue ?? '').trim();
  const known = knownVenue(venue);
  if (known) return `${venue}, ${known.address}, FL`;
  const town = e.area && !isOffBeach(e.area) ? `${e.area}, Santa Rosa Beach` : 'Santa Rosa Beach';
  return venue && venue !== e.area ? `${venue}, ${town}, FL` : `${town}, FL`;
}

/** One row as a calendar entry: the price and a few lines of the blurb, then the link back to its page here. */
export function icsEntry(e) {
  const blurb = String(e.description ?? '').trim();
  const short = blurb.length > 400 ? `${blurb.slice(0, 399).trimEnd()}…` : blurb;
  return {
    id: e.id,
    title: e.title,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    location: icsLocation(e),
    notes: [e.price, short, `Times, the live map and the app: ${SITE}/e/${e.id}`].filter(Boolean).join('\n\n'),
    url: `${SITE}/e/${e.id}?s=${CALENDAR_TAG}`,
  };
}

/** A venue's feed, beside its strip: embed/<slug>/calendar.ics. */
export const venueCalendarPath = (slug) => `/embed/${slug}/calendar.ics`;
/** An act's feed, beside its page: acts/<slug>/calendar.ics. */
export const actCalendarPath = (slug) => `/acts/${slug}/calendar.ics`;

/** One feed per strip (embedVenues' groups), its venue's rows still on, soonest first. */
export function venueCalendarFiles(venues, now) {
  return venues.map((v) => [
    venueCalendarPath(v.slug).slice(1),
    calendarIcs(
      {
        name: `${v.name} on 30A Now`,
        description: `Every event at ${v.name} listed on 30A Now, kept up to date: ${SITE}/venues/${v.slug}/`,
        events: [...v.events].filter((e) => Date.parse(e.ends_at) > now).sort(byStart).map(icsEntry),
      },
      now,
    ),
  ]);
}

/** One feed per act page, and an empty one for every act on the list with nothing ahead. */
export function actCalendarFiles(acts, published, now) {
  const feed = (slug, name, events) => [
    actCalendarPath(slug).slice(1),
    calendarIcs(
      {
        name: `${name} on 30A`,
        description: `${name}'s shows on 30A, as 30A Now lists them, kept up to date: ${SITE}/acts/${slug}/`,
        events: [...events].filter((e) => Date.parse(e.ends_at) > now).sort(byStart).map(icsEntry),
      },
      now,
    ),
  ];
  return [...acts.map((a) => feed(a.slug, a.label, a.events)), ...quietActs(published, acts).map((p) => feed(p.slug, p.name, []))];
}

/** The page's "In your calendar" section, linking a feed at `path`. */
export function calendarSection(path, lead) {
  const links = calendarLinks(path, SITE);
  return (
    `<section class="cal"><h2>In your calendar</h2><p>${esc(lead)} ` +
    `<a href="${esc(links.webcal)}">Apple Calendar or Outlook</a> · <a href="${esc(links.google)}">Google Calendar</a></p></section>\n`
  );
}

/**
 * Every file under acts/ for one run, as [path, contents]: the index, a page
 * per act, a quiet page per slug left on the list, a calendar feed beside
 * each of those pages (18 Oct 2026; empty for a quiet one), and the list.
 */
export function actFiles(acts, published, now, venueSlugs = new Map(), posters = new Map()) {
  return [
    ['acts/index.html', renderActsIndex(acts, now).html],
    ...acts.map((a) => [`acts/${a.slug}/index.html`, withJsonLd(renderAct(a, now, venueSlugs, posters))]),
    ...quietActs(published, acts).map((p) => [`acts/${p.slug}/index.html`, renderActQuiet(p)]),
    ...actCalendarFiles(acts, published, now),
    ['acts/published.json', `${JSON.stringify(published, null, 2)}\n`],
  ];
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
  // MORE_VENUE_CARDS in the app repo's src/data/venues.ts (18 Oct 2026),
  // checked on each venue's own site that day, with no field the site does
  // not confirm (North Beach Social's page shows one number and dials
  // another, so it has none). Each name is the spelling the importer
  // stores, and each pattern is anchored to it. A venue's slug is its name
  // either way, so no published page, strip or sign moves. A loose
  // /havana beach/ would take The Pearl's rooftop bar, and /idyll hound/
  // would take Idyll Hound Proper in Inlet Beach.
  {
    name: 'The Big Chill 30A',
    match: /^(?:the )?big chill(?: 30a)?$/i,
    address: '20 Hub Lane, Watersound Beach',
    website: 'https://thebigchill.com',
    phone: '850-213-0782',
  },
  {
    name: "Redd's Pub",
    match: /^redd'?s pub$/i,
    address: '3906 Hwy 98 W, Santa Rosa Beach',
    website: 'https://reddspub.com',
    phone: '850-325-0252',
  },
  {
    name: 'North Beach Social',
    match: /^north beach social$/i,
    address: '24200 Hwy 331 S, Santa Rosa Beach',
    website: 'https://www.northbeach.social',
  },
  // Later the same day. No phone: its page shows 850-378-3117 and its own
  // structured data says 850-622-2291.
  {
    name: 'The Bay',
    match: /^the bay(?: restaurant)?$/i,
    address: '24215 Hwy 331 S, Santa Rosa Beach',
    website: 'https://baysouthwalton.com',
  },
  {
    name: 'Crackings',
    match: /^crackings$/i,
    address: '51 Uptown Grayton Cir, Grayton Beach',
    website: 'https://www.crackingsfl.com',
    phone: '850-608-8221',
  },
  {
    name: 'Red Fish Taco',
    match: /^red fish taco$/i,
    address: '2052 W County Hwy 30A, Blue Mountain Beach',
    website: 'https://www.redfishtaco.com',
    phone: '850-994-7443',
  },
  {
    name: 'Idyll Hounds Brewing Company',
    match: /^idyll hounds brew(?:ery|ing(?: co(?:mpany)?\.?)?)$/i,
    address: '845 Serenoa Rd, Santa Rosa Beach',
    website: 'https://www.idyllhoundsbrewingcompany.com',
    phone: '850-231-1138',
  },
  {
    name: 'Havana Beach Bar & Grill',
    match: /^havana beach bar (?:&|and) grill$/i,
    address: '63 Main St, Rosemary Beach',
    website: 'https://www.havanabeachbar.com',
    phone: '850-588-2882',
  },
  {
    name: 'Bayou Arts Center',
    match: /^bayou arts cent(?:er|re)$/i,
    address: '105 Hogtown Bayou Ln, Santa Rosa Beach',
    website: 'https://www.culturalartsalliance.com',
    phone: '850-622-5970',
  },
  {
    name: 'Distillery 98',
    match: /^distillery 98$/i,
    address: '835 Serenoa Rd, Santa Rosa Beach',
    website: 'https://distillery98.com',
    phone: '850-919-2400',
  },
  {
    name: 'Eden Gardens State Park',
    match: /^eden gardens(?: state park)?$/i,
    address: '181 Eden Gardens Rd, Santa Rosa Beach',
    website: 'https://www.floridastateparks.org/parks-and-trails/eden-gardens-state-park',
    phone: '850-267-8320',
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
  // part a searcher actually types. Bayside is not one a searcher types:
  // "Bayside, Santa Rosa Beach" is no place, so the town alone.
  return {
    '@type': 'PostalAddress',
    addressLocality: e.area && !isOffBeach(e.area) ? `${e.area}, Santa Rosa Beach` : 'Santa Rosa Beach',
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

/**
 * The same row on an act's page: a MusicEvent, the act its performer. The
 * MusicGroup carries the name and nothing else - no image, no link, no
 * bio - since the site holds nothing of the act's but its dates.
 */
export function actJsonLd(e, label, poster = null) {
  return {
    ...eventJsonLd(e, poster),
    '@type': 'MusicEvent',
    performer: { '@type': 'MusicGroup', name: label },
  };
}

export function actJsonLdScript(events, label, posterOf = () => null) {
  const json = JSON.stringify(events.map((e) => actJsonLd(e, label, posterOf(e)))).replace(/</g, '\\u003c');
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
  // An act's page and the index of them (6 Oct 2026), the venue pair's
  // shape. The app's own share of an act page carries `share-act` instead
  // (app/act/[name].tsx in the app repo), so a page passed on by a band is
  // told from one found in a search.
  act: 'seo-act',
  acts: 'seo-act-index',
  // A town's page and the index of them (15 Oct 2026), the same pair again.
  town: 'seo-town',
  towns: 'seo-town-index',
  // The "Planning a trip? Plan your stay" line on /lineup/ and /tonight/
  // (15 Oct 2026; stayLine). One value for the line on both pages, as
  // seo-venue-owner is one value for the footer on every venue page: it
  // answers whether anyone plans a stay off the site at all, and the app's
  // web_arrival keeps s= and ref= only, never the path, so without a value
  // of its own an arrival at /stay could not be told from one at /weekend.
  stay: 'seo-stay',
  // A share stub's "Within a walk of <venue>" rows (18 Oct 2026), so a
  // reader who hops from one show to the next bar's is told from one who
  // came in on the first.
  walk: 'seo-walk',
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
// arrivals on the web only. (The feed's link has a tag of its own that
// never changes, FEED_APP_LINK below; from= goes on after it.) A member
// id in from= also unhides the invite
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
// <code> beside the button, so it is exactly what is shown. The act page's
// footer uses the same button for its own link (shareFooter), so after
// "Copied" the button goes back to whatever it said - "Copy" there, "Copy
// link" here - rather than to the venue page's word.
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
    var was=copy.textContent;
    copy.addEventListener('click',function(){
      var done=function(){copy.textContent='Copied';setTimeout(function(){copy.textContent=was;},2000);};
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
 * The feed, as these pages hand it to the installed app (10 Oct 2026):
 * on /tonight/, on the acts index, and on an act's page until the store's
 * binary has the act route (actAppArgument). The app's home-screen widget
 * opens the bare thirtyanow://feed, and the app reads a launch by exactly
 * that link as the widget's own tap: it counts the open as one the widget
 * brought, and it retires the first-week card that teaches the widget
 * without showing it, since a reader who came in by the widget has it
 * (WIDGET_OWN_LINK in the app's src/state/AppContext.tsx). These pages
 * sent the same bare link. So someone handed a "Share tonight" link who
 * tapped Open in 30A Now here, or OPEN on Safari's banner, was taken for
 * a widget owner: never shown the card, and counted as a widget launch.
 * The tag tells the two apart. It is the link's own and always "web",
 * never the visitor's s= or ref=, and the app reads nothing from it.
 * Every bundle still opens the feed: Expo Router matches the path and
 * hands the query to a screen that does not look at it, and the app's
 * walk-in for a signed-out phone (WIDGET_FEED_LINK there) has taken a
 * query since it was written.
 */
export const FEED_APP_LINK = 'thirtyanow://feed?s=web';

/**
 * Shared <head>. Every page unfurls as the large card: the branded
 * 1200x630 og-default.png with its size declared, so Facebook draws the
 * full-width card on the first share rather than after it has fetched the
 * image, or a page's own poster when it passes one (the event stub only).
 * A poster's size is not
 * known here, so only the default declares one — a wrong pair is worse
 * than none. `extraHead` is for the stub's <noscript> refresh, and the
 * noindex on an act's page between shows (renderActQuiet).
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
 * says once instead of on all fourteen rows. `showArea: false` is a
 * town's page, whose <h1> names the neighbourhood every row is in.
 */
export function rowHtml(
  e,
  venueSlugs = new Map(),
  { showVenue = true, showArea = true, compact = false, tag = '', ref = '', note = '' } = {},
) {
  const slug = venueSlugs.get(String(e.venue ?? '').trim().toLowerCase());
  const venue = !showVenue
    ? ''
    : slug
      ? `<a href="/venues/${slug}/">${esc(e.venue)}</a>`
      : esc(e.venue);
  const area = showArea && !compact && e.area && e.area !== e.venue ? esc(e.area) : '';
  // `note`, when given, ends the line: a stub's walk rows say how far.
  const meta = [venue, area, esc(fmtWhen(e)), e.price ? esc(e.price) : '', note ? esc(note) : '']
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

/**
 * /lineup/ — Friday to Sunday, the same window as the app's /weekend.
 * `towns` is this run's town pages (townPages), for the "By town:" row;
 * share-cards.mjs passes the list it writes, so the row never links a page
 * the run did not.
 */
export function renderLineup(events, venues, now, posters = new Map(), towns = townPages(events, now)) {
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
    stayLine() +
    townsLine(towns) +
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

/** /tonight/ — the 4 PM-to-midnight window the nightly push counts. `towns` as on the lineup. */
export function renderTonight(events, venues, now, posters = new Map(), towns = townPages(events, now)) {
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
      appArgument: FEED_APP_LINK,
      updated: fmtStamp(now),
    }) +
    `<h1>Tonight on 30A</h1>
<p class="lead">${esc(day)} · from 4 PM · updated ${esc(fmtStamp(now))} beach time</p>
` +
    doneLine(beachDayKey(window.start), day, '/feed', "See what's on now, live in the app", ARRIVAL.tonight) +
    cta({
      appArgument: FEED_APP_LINK,
      livePath: '/feed',
      liveLabel: 'See it live in the app',
      tag: ARRIVAL.tonight,
    }) +
    stayLine() +
    townsLine(towns) +
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
 * same thread as one who filled the form. And, since 14 Oct 2026, the
 * door sign under the Copy button: the page at /embed/<slug>/sign/
 * (renderSign) with the QR code the owner used to have to make by hand.
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
<p><a href="${signPath(slug)}">Print a door sign</a> — a QR code that opens tonight’s lineup here.</p>
<p><a href="${esc(advertise)}">Feature a show — $25, first one free</a> · or email <a href="${esc(mail)}">${esc(SUPPORT_EMAIL)}</a></p>
</section>
`;
}

/**
 * /venues/<slug>/ — everything ahead at one venue, with its card when we
 * know it, and the owner footer unless no one runs the place (`owner:
 * false`, a neighbourhood or a NO_OWNER place: venuePages). `towns` is
 * this run's town pages (townPages): where the venue's area has one, the
 * page's "Also" leads with "More in <town> →".
 */
export function renderVenue(venue, now, posters = new Map(), towns = []) {
  const { name, area, events, slug, known } = venue;
  const town = townOf(area, towns);
  const more = town ? `<a href="/towns/${town.slug}/">More in ${esc(town.name)} →</a> · ` : '';
  const days = groupByDay(events);
  const next = events[0];
  const place = area && area !== name ? `${name} (${area})` : name;
  const description = `${countLabel(events.length, 'upcoming event', 'upcoming events')} at ${place} ${where30A(area)} — next up ${next.title}, ${fmtWhen(next)}. Times, prices and the live map on 30A Now.`;
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
      ogDescription: `Upcoming events and live music at ${place} ${where30A(area)}. Times, prices and the live map on 30A Now.`,
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
    // The feed sits beside the strip, which a place someone runs always has
    // (the owner footer's condition); a town-named page has neither.
    (venue.owner === false
      ? ''
      : calendarSection(venueCalendarPath(slug), `Subscribe to ${name}'s lineup and it stays up to date in your own calendar:`)) +
    `<section><h2>Also</h2><p>${more}<a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
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
<p class="lead">Looking for a band? <a href="/acts/">Every act with a show coming up</a>, at every bar.</p>
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
// Act pages
// ---------------------------------------------------------------------------

/**
 * The act page's footer: the one line a band needs, with the page's own
 * link beside the copy button the owner footer has. A band that plays
 * four bars a week has no page that lists them all, so this is the one it
 * can post on a Monday - and it rewrites itself five times a day. No
 * strip, no price, nothing sold: the act is not the customer here. Outside
 * <main> like the owner footer, so the forwarder leaves the link as the
 * clean URL a reader will paste.
 */
export function shareFooter(page) {
  return `<section class="owner">
<p><strong>Play on 30A?</strong> Share this page — it updates itself.</p>
<p><code id="snippet">${esc(page)}</code> <button type="button" id="copy">Copy link</button></p>
</section>
`;
}

/**
 * Whether the binary in the App Store carries the app's act route in the
 * bundle it ships with. Not yet (10 Oct 2026): 1.1.0 was built on 15 Sep,
 * and /act/<name> reaches phones as an over-the-air update, which a phone
 * downloads on one launch and runs from the next. Until then the bundle
 * on the phone has no such route, and Expo Router answers a link it
 * cannot match with the app's own 404 screen ("You've drifted off the
 * map"). That is every member who has not opened the app twice since the
 * update, and every new install's first session - the reader these pages
 * are for, who taps "Get it for iPhone", comes back and taps Open.
 * Universal links do not help before 1.2.0 either, the first binary with
 * the associated domain. The venue pages never had the gap: /venue/<name>
 * has been in the binary since 1.0.0.
 *
 * So while this is false, an act page's banner and its "Open in 30A Now"
 * button open the feed, a route every bundle has (actAppArgument), and
 * the page's own link to the web app goes on naming the act. Set it to
 * true once the store's binary was built with the route - 1.2.0, the
 * step is in docs/app-store-checklist.md in the app repo ("A new
 * binary") - and the test beside it says what changes.
 */
export const ACT_ROUTE_IN_BINARY = false;

/** What an act page hands the installed app: the act's own screen once every binary has it, the feed until then (tagged: FEED_APP_LINK). */
export function actAppArgument(slug, inBinary = ACT_ROUTE_IN_BINARY) {
  return inBinary ? `thirtyanow://act/${slug}` : FEED_APP_LINK;
}

/**
 * /acts/<slug>/ — every show one act has ahead, at any venue: "Upcoming on
 * 30A", a row per show with its venue linked to its page, the EXPIRE line
 * once every row has ended, and the app's act page as the live link. The
 * card is undated like a venue's (the URL is a band's for good), the
 * image is the branded default - never a photo of the act, which the site
 * does not hold - and the JSON-LD is a MusicEvent per row with the act as
 * its performer.
 */
export function renderAct(act, now, venueSlugs = new Map(), posters = new Map()) {
  const { label, slug, events, venues } = act;
  const days = groupByDay(events);
  const next = events[0];
  const shows = countLabel(events.length, 'show', 'shows');
  const where = countLabel(venues, 'venue', 'venues');
  // "near 30A" for an act whose every show is at Bayside (actNear30A); the
  // page between shows says the same (renderActQuiet, off the list).
  const near = actNear30A(events);
  const on30A = actWhere(near);
  const description = `${label} ${on30A}: ${shows} coming up at ${where} — next at ${next.venue}, ${fmtWhen(next)}. Every date, time and bar on 30A Now.`;
  const livePath = `/act/${slug}`;
  const appArgument = actAppArgument(slug);
  const liveLabel = `See ${label} live in the app`;
  const body =
    head({
      title: `${label} ${on30A} — upcoming shows | 30A Now`,
      description,
      ogTitle: `${label} ${on30A} — upcoming shows`,
      ogDescription: `Every show ${label} has coming up ${near ? 'near' : 'along'} 30A, at every bar, on one page that keeps itself up to date.`,
      path: `/acts/${slug}/`,
      appArgument,
      updated: fmtStamp(now),
    }) +
    `<h1>${esc(label)}</h1>
<p class="lead">Upcoming ${on30A} · ${shows} at ${where} · updated ${esc(fmtStamp(now))} beach time</p>
` +
    doneLine('', label, livePath, liveLabel, ARRIVAL.act) +
    cta({ appArgument, livePath, liveLabel, tag: ARRIVAL.act }) +
    days.map((d) => daySection(d, venueSlugs, { showVenue: true, tag: ARRIVAL.act })).join('\n') +
    calendarSection(actCalendarPath(slug), `Subscribe to ${label}'s 30A shows and every new date lands in your own calendar:`) +
    `<section><h2>Also</h2><p><a href="/acts/">Every act</a> · <a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot(shareFooter(`${SITE}/acts/${slug}/`));
  return { html: body, jsonLd: actJsonLdScript(events, label, (e) => checkedPoster(e, posters)) };
}

/**
 * /acts/<slug>/ for a slug on the list whose act has nothing ahead
 * (quietActs): the name its page last showed, one line that says so, and
 * the same ways on. A link a band posted in a busy week, or one a member
 * sent, opens this in a quiet one rather than the web app's 404, and the
 * full page is back at the same address the run after a show is listed.
 * The card is the full page's, word for word, so a share unfurls the same
 * whichever week it is read: `near` is the list's memory of where the act
 * played (publishedActs), since a Bayside act's card says "near 30A" and
 * this page has no rows to read it off. noindex, and in neither the
 * sitemap nor the index: there is nothing here for a search to find. No
 * rows, no JSON-LD and no time on it - it takes no `now` - so the file is
 * the same bytes run after run and the Action commits it once, not five
 * times a day.
 */
export function renderActQuiet({ slug, name, near = false }) {
  const livePath = `/act/${slug}`;
  const appArgument = actAppArgument(slug);
  const liveLabel = `See ${name} live in the app`;
  const where = actWhere(near);
  return (
    head({
      title: `${name} ${where} | 30A Now`,
      description: `Nothing listed for ${name} ${where} right now. Every act with a show coming up, at every bar, is on 30A Now.`,
      ogTitle: `${name} ${where} — upcoming shows`,
      ogDescription: `Every show ${name} has coming up ${near ? 'near' : 'along'} 30A, at every bar, on one page that keeps itself up to date.`,
      path: `/acts/${slug}/`,
      appArgument,
      updated: 'between shows',
      extraHead: '<meta name="robots" content="noindex">\n',
    }) +
    `<h1>${esc(name)}</h1>
<p class="lead">Nothing listed for ${esc(name)} ${where} right now. This page fills in again when a show is posted.</p>
` +
    cta({ appArgument, livePath, liveLabel, tag: ARRIVAL.act }) +
    `<section><h2>Also</h2><p><a href="/acts/">Every act</a> · <a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot()
  );
}

/** /acts/ — the index a crawler follows to every act page: by name, each with its next show. */
export function renderActsIndex(acts, now) {
  const body =
    head({
      title: 'Acts playing 30A — every band’s upcoming shows | 30A Now',
      description: `${acts.length} acts with shows coming up along 30A, from AJ's and The Red Bar in Grayton Beach to Seaside and Rosemary Beach: every date and every bar, on one page each.`,
      ogTitle: 'Acts playing 30A — every band’s upcoming shows',
      ogDescription: 'The bands, DJs and duos with shows coming up along 30A: every date and every bar, on one page each.',
      path: '/acts/',
      appArgument: FEED_APP_LINK,
      updated: fmtStamp(now),
    }) +
    `<h1>Acts playing 30A</h1>
<p class="lead">${countLabel(acts.length, 'act', 'acts')} with a show coming up · updated ${esc(fmtStamp(now))} beach time</p>
` +
    cta({
      appArgument: FEED_APP_LINK,
      livePath: '/feed',
      liveLabel: 'See what’s on live',
      tag: ARRIVAL.acts,
    }) +
    `<ul class="venues">${acts
      .map(
        (a) =>
          `<li><a href="/acts/${a.slug}/">${esc(a.label)}</a> <span class="m">next ${esc(a.events[0].venue)}, ${esc(fmtDayShort(Date.parse(a.events[0].starts_at)))}</span></li>`,
      )
      .join('\n')}</ul>
` +
    foot();
  return { html: body };
}

// ---------------------------------------------------------------------------
// Town pages (15 Oct 2026)
// ---------------------------------------------------------------------------

/**
 * How far a town's page looks ahead: today and the six beach days after
 * it, the week a visitor planning a trip means - the same seven as the
 * partner strip (EMBED_DAYS), but counted in calendar days (townWindow).
 */
export const TOWN_DAYS = 7;

/**
 * Beach midnight today to the last instant before beach midnight seven
 * days on. Calendar keys, as weekendWindow and tonightWindow walk them, so
 * a week with a DST change in it is still seven days and never six or eight.
 */
export function townWindow(now) {
  const today = beachDayKey(now);
  return {
    start: beachWallToUtc(today, 0),
    end: beachWallToUtc(addBeachDays(today, TOWN_DAYS), 0) - 1,
  };
}

/** A town's path segment: "Grayton Beach" -> "grayton-beach", "WaterColor" -> "watercolor". */
export const townSlug = (name) => slugify(name);

const areaByKey = new Map(AREA_NAMES.map((n) => [n.toLowerCase(), n]));

/**
 * One page per neighbourhood in AREA_NAMES with at least one row in the
 * next seven beach days (townWindow) that has not ended by `now`: every
 * row whose `area` is the town, whatever its venue - a bar, a pavilion,
 * the town-only rows /venues/<town>/ files under the town's own name (that
 * page is those rows; this one is the whole town), a placeholder. In
 * AREA_NAMES order, west to east and Bayside last, as the app lists them.
 * The area is matched without regard to case or outer spaces, and the page
 * takes the list's own spelling.
 */
export function townPages(events, now) {
  const byTown = new Map();
  for (const e of inWindow(events, townWindow(now), now)) {
    const name = areaByKey.get(String(e.area ?? '').trim().toLowerCase());
    if (!name) continue;
    if (!byTown.has(name)) byTown.set(name, []);
    byTown.get(name).push(e);
  }
  return AREA_NAMES.filter((n) => byTown.has(n)).map((name) => ({
    name,
    slug: townSlug(name),
    events: byTown.get(name),
  }));
}

/** This run's page for an area, or null (renderVenue's "More in <town> →"). */
function townOf(area, towns) {
  const key = String(area ?? '').trim().toLowerCase();
  return (key && towns.find((t) => t.name.toLowerCase() === key)) || null;
}

/**
 * The towns that keep a page with nothing on this week. A town page is a
 * link a search engine has, and a visitor may have bookmarked, so one that
 * has been written does not go back to the web app's 404 shell in a quiet
 * week - the act pages' rule (publishedActs, quietActs). The list here is
 * fixed, the twelve AREA_NAMES, so no file has to remember which pages
 * were written: a town's directory under towns/ is the record, and
 * share-cards.mjs overwrites it and never removes it. `have` is the
 * directory names under towns/ as the run found them. A town never written
 * gets no page until it has something on.
 */
export function quietTowns(have, towns) {
  const on = new Set(towns.map((t) => t.slug));
  const there = new Set(have);
  return AREA_NAMES.map((name) => ({ name, slug: townSlug(name) })).filter(
    (t) => there.has(t.slug) && !on.has(t.slug),
  );
}

/**
 * A schema.org BreadcrumbList for `trail`, [{ name, path }] from the top:
 * the town pages' 30A Now › Towns › <town>, which a search result shows in
 * place of the bare URL.
 */
export function breadcrumbJsonLd(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(({ name, path }, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: `${SITE}${path}`,
    })),
  };
}

/** "Seaside, Florida", or where an off-beach area is (where30A): the place in a town's own sentence. */
const townIn = (name) => (isOffBeach(name) ? `${name}, ${where30A(name)},` : `${name}, Florida`);

/** The page's one-line intro, the same words full or quiet, and its card's description. */
export const townIntro = (name) =>
  `What's on in ${townIn(name)} this week: live music, markets and more, updated every day.`;

/**
 * The search title's words before " | 30A Now", and the card's title. An
 * off-beach area is no "Serenoa, FL": Bayside is on the bay, the others
 * near 30A.
 */
const townTitle = (name) =>
  `Things to do in ${
    name === BAYSIDE ? `${name} on Choctawhatchee Bay` : isOffBeach(name) ? `${name} near 30A` : `${name}, FL`
  } this week`;

const townTrail = (town) => [
  { name: '30A Now', path: '/' },
  { name: 'Towns', path: '/towns/' },
  ...(town ? [{ name: town.name, path: `/towns/${town.slug}/` }] : []),
];

const alsoTowns = `<section><h2>Also</h2><p><a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/towns/">Every town</a> · <a href="/venues/">Every venue</a></p></section>
`;

/**
 * /towns/<slug>/ — everything on in one town in the next seven beach days,
 * a section per day as on the lineup (the day's classes folded), each row
 * linked to its venue's page where it has one; then the town's venues that
 * have a page, A to Z. The rows leave the area out (`showArea: false`),
 * which the <h1> says once. The card is undated, as a venue's is (the URL
 * is the town's for good), and the JSON-LD is an Event per row plus the
 * BreadcrumbList. The app has no town screen, so the buttons open the map.
 */
export function renderTown(town, venues, now, posters = new Map()) {
  const { name, slug, events } = town;
  const window = townWindow(now);
  const days = groupByDay(events);
  const main = events.filter((e) => e.category !== 'fitness');
  const classes = events.length - main.length;
  const range = `${fmtDayShort(window.start)} – ${fmtDayShort(window.end)}`;
  const where = where30A(name);
  const picks = main.slice(0, 3).map((e) => e.title).join(', ');
  const description = main.length
    ? `${countLabel(main.length, 'event', 'events')} in ${name} ${where} this week (${range}): ${picks}${main.length > 3 ? ' and more' : ''}. Times, venues and the live map.`
    : `Classes, clinics and court times in ${name} ${where} this week (${range}), with times, venues and the live map.`;
  const key = name.toLowerCase();
  const here = venues
    .filter((v) => String(v.area ?? '').trim().toLowerCase() === key && v.name.trim().toLowerCase() !== key)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const venueList = here.length
    ? `<section><h2>Venues in ${esc(name)}</h2><ul class="venues">${here
        .map((v) => `<li><a href="/venues/${v.slug}/">${esc(v.name)}</a></li>`)
        .join('\n')}</ul></section>
`
    : '';
  const body =
    head({
      title: `${townTitle(name)} | 30A Now`,
      description,
      ogTitle: townTitle(name),
      ogDescription: townIntro(name),
      path: `/towns/${slug}/`,
      appArgument: 'thirtyanow://',
      updated: fmtStamp(now),
    }) +
    `<h1>This week in ${esc(name)}</h1>
<p class="lead">${esc(townIntro(name))}</p>
<p class="lead">${esc(range)} · ${countLabel(main.length, 'event', 'events')}${classes ? ` + ${countLabel(classes, 'class', 'classes')}` : ''} · updated ${esc(fmtStamp(now))} beach time</p>
` +
    doneLine('', `${name} this week`, '/', 'See what’s on now on the live map', ARRIVAL.town) +
    cta({ appArgument: 'thirtyanow://', livePath: '/', liveLabel: 'See it on the live map', tag: ARRIVAL.town }) +
    days.map((d) => daySection(d, slugMap(venues), { showArea: false, tag: ARRIVAL.town })).join('\n') +
    venueList +
    alsoTowns +
    foot();
  const crumbs = JSON.stringify(breadcrumbJsonLd(townTrail(town))).replace(/</g, '\\u003c');
  return {
    html: body,
    count: events.length,
    jsonLd: `${jsonLdScript(events, (e) => checkedPoster(e, posters))}\n<script type="application/ld+json">${crumbs}</script>`,
  };
}

/**
 * /towns/<slug>/ for a town written before with nothing on this week
 * (quietTowns): one line that says so and the ways on, under the full
 * page's card word for word. noindex, and in neither the index nor the
 * sitemap - as an act's page between shows, and for the same reason: a
 * page that lists nothing is nothing for a search to find, and indexed it
 * reads to Google as a soft 404 against "things to do in <town>". It still
 * answers 200 for a link someone kept, and its links are still followed.
 * The full page is back at the same address the run after a row is. No
 * rows, no JSON-LD and no time - it takes no `now` - so the file is the
 * same bytes run after run and the Action commits it once.
 */
export function renderTownQuiet({ name, slug }) {
  return (
    head({
      title: `${townTitle(name)} | 30A Now`,
      description: `Nothing listed in ${name} ${where30A(name)} this week. Every show, market and event along 30A is on 30A Now.`,
      ogTitle: townTitle(name),
      ogDescription: townIntro(name),
      path: `/towns/${slug}/`,
      appArgument: 'thirtyanow://',
      updated: 'quiet week',
      extraHead: '<meta name="robots" content="noindex">\n',
    }) +
    `<h1>This week in ${esc(name)}</h1>
<p class="lead">Nothing listed in ${esc(townIn(name))} this week. This page fills in again when something is posted.</p>
<p><a href="/lineup/">See what’s on along 30A this weekend</a> · <a href="/towns/">Every town</a></p>
` +
    cta({ appArgument: 'thirtyanow://', livePath: '/', liveLabel: 'See it on the live map', tag: ARRIVAL.town }) +
    alsoTowns +
    foot()
  );
}

/** /towns/ — the index a crawler follows to every town page: west to east, each with its count for the week. */
export function renderTownsIndex(towns, now) {
  const window = townWindow(now);
  const range = `${fmtDayShort(window.start)} – ${fmtDayShort(window.end)}`;
  const body =
    head({
      title: 'Things to do on 30A this week, town by town | 30A Now',
      description: towns.length
        ? `What's on along 30A this week (${range}), town by town: ${towns.map((t) => t.name).join(', ')}. Live music, markets and more, with times, venues and the live map.`
        : `What's on along 30A this week (${range}), town by town, with times, venues and the live map.`,
      ogTitle: 'Things to do on 30A this week, town by town',
      ogDescription: "What's on this week in every town along 30A: live music, markets and more, updated every day.",
      path: '/towns/',
      appArgument: 'thirtyanow://',
      updated: fmtStamp(now),
    }) +
    `<h1>This week on 30A, town by town</h1>
<p class="lead">${esc(range)} · ${countLabel(towns.length, 'town', 'towns')} with something on · updated ${esc(fmtStamp(now))} beach time</p>
` +
    cta({ appArgument: 'thirtyanow://', livePath: '/', liveLabel: 'Open the live map', tag: ARRIVAL.towns }) +
    (towns.length
      ? `<ul class="venues">${towns
          .map(
            (t) =>
              `<li><a href="/towns/${t.slug}/">${esc(t.name)}</a> <span class="m">${t.events.length}${isOffBeach(t.name) ? ` · ${esc(where30A(t.name))}` : ''}</span></li>`,
          )
          .join('\n')}</ul>
`
      : `<p class="quiet">Nothing listed along 30A this week yet — the calendars are read twice a day, so check back.</p>
`) +
    `<section><h2>Also</h2><p><a href="/lineup/">This weekend on 30A</a> · <a href="/tonight/">Tonight</a> · <a href="/venues/">Every venue</a></p></section>
` +
    foot();
  return { html: body };
}

/** Every file under towns/ for one run, as [path, contents]: the index, a page per town on this week, a quiet page per town written before and not. */
export function townFiles(towns, have, venues, now, posters = new Map()) {
  return [
    ['towns/index.html', renderTownsIndex(towns, now).html],
    ...towns.map((t) => [`towns/${t.slug}/index.html`, withJsonLd(renderTown(t, venues, now, posters))]),
    ...quietTowns(have, towns).map((t) => [`towns/${t.slug}/index.html`, renderTownQuiet(t)]),
  ];
}

/**
 * Where /lineup/ and /tonight/ send a visitor planning a trip: the app's
 * /stay page on the web (live since 14 Oct 2026), where they pick the day
 * they arrive and the nights, and get the whole stay on one page. Written
 * absolute on purpose. The forwarder (SCRIPT) rewrites only links that
 * start with "/", so this one keeps seo-stay whatever the visitor came in
 * with, as the owner footer keeps seo-venue-owner by sitting outside
 * <main>; and it gets no from=, which on /stay names the door the app
 * opened it from (pill, weekend, link), never a member.
 */
export const STAY_URL = tagged(`${SITE}/stay`, { s: ARRIVAL.stay });

function stayLine() {
  return `<p class="lead">Planning a trip? <a href="${esc(STAY_URL)}">Plan your stay →</a></p>
`;
}

/** "By town:" and a link to each town page this run writes; nothing when there are none. */
function townsLine(towns) {
  if (!towns.length) return '';
  return `<p class="lead">By town: ${towns.map((t) => `<a href="/towns/${t.slug}/">${esc(t.name)}</a>`).join(' · ')}</p>
`;
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
 * and a name is dropped - the slug becomes a directory. acts/published.json
 * is the same shape and is read the same way (`file` names it in the
 * error); an act's slug is held to the same pattern (ACT_SLUG), and its
 * entry may carry `near: true` (publishedActs), which is kept as exactly
 * that and nothing else.
 */
export function parsePublished(text, file = 'embed/published.json') {
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error(`${file} is not a list`);
  return list
    .filter((p) => p && typeof p.slug === 'string' && STRIP_SLUG.test(p.slug) && typeof p.name === 'string')
    .map((p) => ({ slug: p.slug, name: p.name.trim(), ...(p.near === true ? { near: true } : {}) }))
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
  const seen = [];
  for (const { dir, html } of [...dirs, ...lost]) {
    if (!STRIP_SLUG.test(dir) || seen.some((p) => p.slug === dir)) continue;
    const name = unescapeHtml(/<h1>([^<]*)<\/h1>/.exec(html ?? '')?.[1] ?? '').trim();
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

// ---------------------------------------------------------------------------
// Door signs (14 Oct 2026)
// ---------------------------------------------------------------------------

/**
 * The link a venue's door sign carries: the app's venue route with the
 * two tags that have counted a scan since September (docs/venue-outreach.md
 * in the app repo, "The door sign": s=qr says a scan, ref says which door,
 * by the same embedRef the strip's links carry). The form a hand-made sign
 * has used, character for character, so those keep counting under the
 * same key; and the app's src/utils/ownerLink.ts names the same page for
 * the same venue, so the three places a sign is handed out from agree.
 * The name is encoded, so the text is printable ASCII whatever the name,
 * which is what the encoder's byte mode needs (qr.mjs).
 */
export function doorUrl(name) {
  return `${SITE}/venue/${encodeURIComponent(name)}?s=qr&ref=${embedRef(name)}`;
}

/** Where a venue's sign page lives, under its strip: /embed/<slug>/sign/. */
export function signPath(slug) {
  return `/embed/${slug}/sign/`;
}

/**
 * The strip directories that get a sign page: the slug and alias ones
 * (STRIP_SLUG), never the name-spelled one, of a place someone runs
 * (isVenueName: a town, a pavilion or a placeholder gets none, as it gets
 * no owner footer) whose ref is not empty. Inside embed/<slug>/, so no new
 * top-level name for the deploys' keep lists or the Action's git add, and
 * a strip once handed out keeps its sign as it keeps its page.
 */
export function signDirs(venues) {
  return embedDirs(venues).filter(
    ({ dir, venue }) =>
      STRIP_SLUG.test(dir) &&
      venue.owner !== false &&
      isVenueName(venue.name, venue.area) &&
      embedRef(venue.name) !== '',
  );
}

const SIGN_CSS = `
:root{--ink:#16303A;--sub:#5E7680;--teal:#0E7C86;--border:#E3EBEE}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--ink);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
.bar{max-width:640px;margin:0 auto;padding:14px 16px;border-bottom:1px solid var(--border);color:var(--sub);font-size:14px}
.bar p{margin:0 0 10px}
.bar p:last-child{margin:0}
button{font:inherit;font-weight:800;color:#fff;background:var(--teal);border:0;border-radius:10px;padding:12px 18px;min-height:44px;cursor:pointer}
.sheet{display:flex;flex-direction:column;align-items:center;text-align:center;max-width:640px;margin:0 auto;padding:28px 16px 40px}
h1{margin:0;font-size:clamp(28px,6vw,44px);font-weight:900;line-height:1.1}
.ask{margin:14px 0 22px;font-size:clamp(20px,4vw,28px);font-weight:700}
.qr svg{width:min(70vw,110mm);height:auto;display:block}
.how{margin:22px 0 0;font-size:clamp(16px,3vw,20px)}
.brand{margin:26px 0 0;font-size:14px;color:var(--sub)}
@page{margin:12mm}
@media print{.noprint{display:none}.sheet{padding-top:0}}
`;

/**
 * /embed/<slug>/sign/ - the printable door sign: the venue's name, the
 * question, the QR code and a Print button, whole in itself (inline CSS,
 * no bundle, no fetch, no beacon; the one script is the button). Until now
 * the code was "any free QR generator's output" and the owner made each
 * one by hand. null when the link cannot be a code (qr.mjs: not printable
 * ASCII, past QR_MAX_BYTES, or a code that qr.mjs's own reader did not
 * read back as the link - qrSvg reads every code back before it draws
 * it), so share-cards.mjs warns (signProblem says why) and writes
 * nothing rather than a code that would not scan. noindex: a search for
 * the bar should land on /venues/<slug>/, not on a sheet meant for the
 * door. The page says a scan is counted and no more: a phone with a 1.2.0+
 * binary opens the link in the app, where nothing counts it yet.
 */
export function renderSign(venue) {
  const name = String(venue.name ?? '').trim();
  const url = doorUrl(name);
  let svg;
  try {
    svg = qrSvg(url);
  } catch {
    return null;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Door sign — ${esc(name)} | 30A Now</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<style>${SIGN_CSS}</style>
</head><body>
<div class="noprint bar">
<p>Door sign for ${esc(name)}. Print it and put it by the door or the host stand. A scan opens tonight’s lineup at your place, and we count how often it is scanned.</p>
<p><button type="button" id="print">Print this sign</button></p>
</div>
<main class="sheet">
<h1>${esc(name)}</h1>
<p class="ask">What’s on here tonight?</p>
<div class="qr" role="img" aria-label="QR code that opens ${esc(name)} on 30A Now" data-url="${esc(url)}">${svg}</div>
<p class="how">Scan with your phone’s camera. Free, no account.</p>
<p class="brand">30A Now · the live map of Scenic Highway 30A · 30anow.github.io</p>
</main>
<script>
(function(){var b=document.getElementById('print');if(b)b.addEventListener('click',function(){window.print();});})();
</script>
</body></html>
`;
}

/**
 * Why renderSign answered null for this venue, in qr.mjs's words (not
 * printable ASCII, past the cap, or the first fault the reader found in
 * the code) - or null when its sign can be written. share-cards.mjs puts
 * it on the warning line, so the log says which guard refused.
 */
export function signProblem(venue) {
  return qrProblem(doorUrl(String(venue.name ?? '').trim()));
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
// ---------------------------------------------------------------------------
// Within a walk (18 Oct 2026): the app's withinAWalk (src/state/selectors.ts
// in the app repo), copied for the share stub; the two repos cannot import
// each other, so keep the two in step. A show at another venue within a
// walk of this one, on its beach day, that overlaps it or starts within two
// hours of its end, never a gym class, one per series (its earliest), nearest
// first then soonest, three at most.
// ---------------------------------------------------------------------------

/** The app's WALK_MAX_MI (src/utils/geo.ts): what it calls a walk everywhere. */
export const WALK_MAX_MI = 1.2;
/** The app's WALK_ON_AFTER_MS: a walk and a drink after a show ends. */
export const WALK_ON_AFTER_MS = 2 * 3_600_000;

/** Great-circle miles between two rows' pins. */
export function milesBetween(a, b) {
  const r = Math.PI / 180;
  const x =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(x));
}

export function withinAWalk(events, e, now, limit = 3) {
  const start = Date.parse(e.starts_at);
  const end = Date.parse(e.ends_at);
  const day = beachDayKey(start);
  // The app's sameVenue: a known venue by its one name, so "Red Bar" is The Red Bar.
  const canon = (v) => {
    const name = String(v ?? '').trim();
    return (knownVenue(name)?.name ?? name).toLowerCase();
  };
  const venue = canon(e.venue);
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) return [];
  const series = new Map();
  for (const n of [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
    if (n.id === e.id || n.category === 'fitness') continue;
    if (canon(n.venue) === venue) continue;
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) continue;
    const s = Date.parse(n.starts_at);
    const t = Date.parse(n.ends_at);
    if (!(t > now && beachDayKey(s) === day && t > start && s < end + WALK_ON_AFTER_MS)) continue;
    const miles = milesBetween(e, n);
    if (miles > WALK_MAX_MI) continue;
    const key = `${n.title}|${n.venue}`;
    if (!series.has(key)) series.set(key, { e: n, miles });
  }
  return [...series.values()]
    .sort((a, b) => a.miles - b.miles || Date.parse(a.e.starts_at) - Date.parse(b.e.starts_at))
    .slice(0, limit);
}

/** How a walk row says how far: as the app's cards do (formatMiles). */
export const walkNote = (miles) => (miles < 0.15 ? 'right here' : `${miles.toFixed(1)} mi`);

export function renderStub(e, { poster = null, now = Date.now(), venueSlugs = new Map(), nearby = [] } = {}) {
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
    // What else is on within a walk the same night (withinAWalk). Each row
    // carries its end, so EXPIRE hides a show that is over and then the
    // section once it is empty.
    (nearby.length && venue
      ? `<section><h2>Within a walk of ${esc(venue)}</h2><ul class="rows">${nearby
          .map(({ e: n, miles }) => rowHtml(n, venueSlugs, { compact: true, tag: ARRIVAL.walk, note: walkNote(miles) }))
          .join('\n')}</ul></section>\n`
      : '') +
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

/**
 * Pages plus every e/<id>; lastmod is this run, since every file is
 * rewritten. `towns` is this run's town pages (townPages): a town between
 * weeks keeps a noindex page (renderTownQuiet) and is not listed.
 */
export function sitemapXml(events, venues, now, acts = [], towns = []) {
  const lastmod = new Date(now).toISOString();
  const urls = [
    '/',
    '/lineup/',
    '/tonight/',
    '/towns/',
    ...towns.map((t) => `/towns/${t.slug}/`),
    '/venues/',
    ...venues.map((v) => `/venues/${v.slug}/`),
    '/acts/',
    ...acts.map((a) => `/acts/${a.slug}/`),
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
