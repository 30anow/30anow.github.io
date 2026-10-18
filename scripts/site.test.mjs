// node --test scripts/site.test.mjs — no dependencies, runs in the Action
// before the generator so a broken page never reaches the site. Every
// assertion holds in any machine timezone; that is the point of beach time.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ACT_PAGE_MIN, actKey, actLabel, actSlug, actTitleKey, shownTitle } from './actKey.mjs';
// The vendored encoder's class, so one test can make it hand back a wrong
// code and watch renderSign refuse it; nothing in vendor/ is changed.
import QRCode from './vendor/QRCode/index.js';
import {
  ACT_ROUTE_IN_BINARY,
  ACT_SLUG,
  actAppArgument,
  actFiles,
  actJsonLd,
  actNear30A,
  actPages,
  addBeachDays,
  APP_STORE_PROVIDER_TOKEN,
  APP_STORE_URL,
  AREA_NAMES,
  ARRIVAL,
  bannerMeta,
  BAYSIDE,
  isOffBeach,
  OFF_BEACH,
  beachDayKey,
  beachIso,
  beachWallToUtc,
  doorUrl,
  embedDirs,
  embedNameDir,
  embedRef,
  embedSnippet,
  embedVenues,
  embedWeek,
  esc,
  eventJsonLd,
  FEED_APP_LINK,
  FOOTER_LOG_ARGS,
  FOOTER_SHIPPED,
  groupByDay,
  INVITED_LINE,
  inWindow,
  isPlaceholderVenue,
  isVenueName,
  KNOWN_VENUES,
  knownVenue,
  lostFooterPages,
  OG_DEFAULT,
  ownerFooter,
  parsePublished,
  priceNumber,
  PUBLISHED_EMBEDS,
  publishedActs,
  publishedStrips,
  quietActs,
  renderAct,
  renderActQuiet,
  renderActsIndex,
  renderEmbed,
  renderLineup,
  renderSign,
  renderStub,
  renderTonight,
  renderVenue,
  renderVenuesIndex,
  robotsTxt,
  rowHtml,
  safeUrl,
  seedPublished,
  seedPublishedActs,
  shareFooter,
  shrinkRefusal,
  signDirs,
  signPath,
  signProblem,
  sitemapXml,
  slugify,
  STAY_URL,
  storeUrl,
  STRIP_SLUG,
  SUPPORT_EMAIL,
  tonightWindow,
  breadcrumbJsonLd,
  quietTowns,
  renderTown,
  renderTownQuiet,
  renderTownsIndex,
  TOWN_DAYS,
  townFiles,
  townIntro,
  townPages,
  townSlug,
  townWindow,
  truncationRefusal,
  venuePages,
  weekendWindow,
  withJsonLd,
} from './site.mjs';

const noonOn = (dayKey) => beachWallToUtc(dayKey, 12);

let seq = 0;
const row = (over = {}) => {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    title: 'Live Music',
    venue: 'The Red Bar',
    area: 'Grayton Beach',
    category: 'music',
    starts_at: '2026-09-11T23:00:00Z', // Fri Sep 11, 6 PM CDT
    ends_at: '2026-09-12T02:00:00Z',
    price: null,
    description: null,
    url: null,
    image_url: null,
    lat: 30.3,
    lng: -86.1,
    ...over,
  };
};

describe('beach time', () => {
  it('converts wall time in summer and winter like the app does', () => {
    assert.equal(beachWallToUtc('2026-07-20', 18), Date.parse('2026-07-20T23:00:00Z'));
    assert.equal(beachWallToUtc('2026-01-15', 18), Date.parse('2026-01-16T00:00:00Z'));
  });
  it('rolls the day at beach midnight', () => {
    assert.equal(beachDayKey(Date.parse('2026-07-20T04:59:00Z')), '2026-07-19');
    assert.equal(beachDayKey(Date.parse('2026-07-20T05:00:00Z')), '2026-07-20');
  });
  it('writes JSON-LD stamps with the beach offset', () => {
    assert.equal(beachIso('2026-09-11T23:00:00Z'), '2026-09-11T18:00:00-05:00');
    assert.equal(beachIso('2026-01-16T00:00:00Z'), '2026-01-15T18:00:00-06:00');
  });
  it('steps calendar days, including over month, year and DST boundaries', () => {
    assert.equal(addBeachDays('2027-03-13', 1), '2027-03-14'); // spring forward
    assert.equal(addBeachDays('2026-11-01', -1), '2026-10-31'); // fall back
    assert.equal(addBeachDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addBeachDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addBeachDays('2026-09-08', 7), '2026-09-15');
  });
});

describe('weekendWindow', () => {
  it('targets the coming Fri–Sun from a weekday', () => {
    for (const day of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']) {
      const w = weekendWindow(noonOn(day));
      assert.equal(w.start, beachWallToUtc('2026-07-24', 0));
      assert.equal(w.end, beachWallToUtc('2026-07-26', 23, 59));
    }
  });
  it('shows what is left mid-weekend', () => {
    assert.equal(weekendWindow(noonOn('2026-07-25')).start, beachWallToUtc('2026-07-25', 0));
    assert.equal(weekendWindow(noonOn('2026-07-26')).end, beachWallToUtc('2026-07-26', 23, 59));
  });
  it('cannot stretch to ten days across spring forward', () => {
    // Thu 11 Mar 2027, 23:30 CST. Stepping 24 hours at a time from here
    // skips Sun 14 Mar — a 23-hour beach day — so the old loop ran on to
    // Sun 21 Mar and /lineup/ called Mar 12–21 "this weekend".
    const late = weekendWindow(Date.parse('2027-03-12T05:30:00.000Z'));
    assert.equal(late.start, beachWallToUtc('2027-03-12', 0));
    assert.equal(late.end, beachWallToUtc('2027-03-14', 23, 59));
    // Same trap from inside the weekend: Sat 13 Mar, 23:30 CST.
    const sat = weekendWindow(Date.parse('2027-03-14T05:30:00.000Z'));
    assert.equal(sat.start, beachWallToUtc('2027-03-13', 0));
    assert.equal(sat.end, beachWallToUtc('2027-03-14', 23, 59));
  });
});

describe('tonightWindow', () => {
  it('is 4 PM to midnight on the beach clock', () => {
    const w = tonightWindow(noonOn('2026-09-08'));
    assert.equal(w.start, beachWallToUtc('2026-09-08', 16));
    assert.equal(w.end, beachWallToUtc('2026-09-09', 0));
  });
  it('still means today at 5 AM, when the morning run happens', () => {
    const w = tonightWindow(beachWallToUtc('2026-09-08', 5, 20));
    assert.equal(w.start, beachWallToUtc('2026-09-08', 16));
  });
  it('rolls to tomorrow night in the last hour of the day', () => {
    // The 05:10 UTC run is 23:10 CST in winter and its page is read after
    // midnight; it must describe the night ahead, not the one just ended.
    const w = tonightWindow(beachWallToUtc('2026-01-14', 23, 10));
    assert.equal(w.start, beachWallToUtc('2026-01-15', 16));
    assert.equal(w.end, beachWallToUtc('2026-01-16', 0));
    // The same run in summer falls at 00:10, which is already the new day.
    const summer = tonightWindow(beachWallToUtc('2026-09-09', 0, 10));
    assert.equal(summer.start, beachWallToUtc('2026-09-09', 16));
  });
  it('ends at the next calendar midnight, not 24 hours on', () => {
    // Sat 13 Mar 2027, 8 PM CST. now + 24h lands at 9 PM CDT on Sunday, so
    // the old end key was Monday and the window swallowed all of Sunday.
    const w = tonightWindow(Date.parse('2027-03-14T02:00:00.000Z'));
    assert.equal(w.start, beachWallToUtc('2027-03-13', 16));
    assert.equal(w.end, beachWallToUtc('2027-03-14', 0));
  });
});

describe('slugify', () => {
  it('drops apostrophes instead of splitting on them', () => {
    assert.equal(slugify("AJ's Grayton Beach"), 'ajs-grayton-beach');
    assert.equal(slugify('Seaside’s Central Square'), 'seasides-central-square');
  });
  it('collapses punctuation runs and trims', () => {
    assert.equal(slugify('Tennis & Pickleball Courts'), 'tennis-pickleball-courts');
    assert.equal(slugify('  Hope on the Beach - Orange Street '), 'hope-on-the-beach-orange-street');
    assert.equal(slugify('Café Thirty-A'), 'cafe-thirty-a');
  });
  it('never yields an empty path segment', () => {
    assert.equal(slugify('???'), 'venue');
  });
});

describe('inWindow and groupByDay', () => {
  it('keeps rows that start inside the window and have not ended', () => {
    const now = noonOn('2026-09-08');
    const w = weekendWindow(now);
    const fri = row();
    const thu = row({ starts_at: '2026-09-10T23:00:00Z', ends_at: '2026-09-11T02:00:00Z' });
    const mon = row({ starts_at: '2026-09-14T23:00:00Z', ends_at: '2026-09-15T02:00:00Z' });
    assert.deepEqual(inWindow([mon, thu, fri], w, now).map((e) => e.id), [fri.id]);
  });
  it('splits each beach day into events and the gym timetable', () => {
    const late = row({ starts_at: '2026-09-12T03:00:00Z', ends_at: '2026-09-12T05:00:00Z' }); // Fri 10 PM
    const gym = row({ category: 'fitness', starts_at: '2026-09-11T12:00:00Z', ends_at: '2026-09-11T13:00:00Z' });
    const sat = row({ starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' });
    const days = groupByDay([sat, late, gym, row()]);
    assert.deepEqual(days.map((d) => d.key), ['2026-09-11', '2026-09-12']);
    assert.equal(days[0].label, 'Friday, Sep 11');
    assert.equal(days[0].main.length, 2);
    assert.equal(days[0].fitness.length, 1);
    assert.equal(days[0].main[1].id, late.id);
  });
});

describe('venuePages', () => {
  const now = noonOn('2026-09-08');
  it('needs three upcoming rows and ignores the past', () => {
    const past = row({ venue: 'Crackings', starts_at: '2026-09-01T13:00:00Z', ends_at: '2026-09-01T15:00:00Z' });
    const rows = [row(), row(), row(), past, row({ venue: 'Crackings' }), row({ venue: 'Crackings' })];
    const pages = venuePages(rows, now);
    assert.deepEqual(pages.map((p) => p.slug), ['the-red-bar']);
    assert.equal(pages[0].events.length, 3);
    assert.equal(pages[0].known.name, 'The Red Bar');
  });
  it('groups spellings case-insensitively and keeps the first', () => {
    const rows = [row(), row({ venue: 'the red bar' }), row({ venue: 'THE RED BAR' })];
    const pages = venuePages(rows, now);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].name, 'The Red Bar');
  });
  it('gives colliding slugs distinct paths', () => {
    const rows = [
      ...[1, 2, 3].map(() => row({ venue: "AJ's Grayton Beach" })),
      ...[1, 2, 3].map(() => row({ venue: 'AJs Grayton Beach!' })),
    ];
    assert.deepEqual(venuePages(rows, now).map((p) => p.slug), ['ajs-grayton-beach', 'ajs-grayton-beach-2']);
  });
  it('orders by how much is on', () => {
    const rows = [
      ...[1, 2, 3].map(() => row({ venue: 'Crackings' })),
      ...[1, 2, 3, 4].map(() => row()),
    ];
    assert.deepEqual(venuePages(rows, now).map((p) => p.name), ['The Red Bar', 'Crackings']);
  });
});

/**
 * Until 1 Oct 2026 /venues/venues-along-30a/ was live and in the sitemap -
 * the importer's name for the Songwriters Festival, which plays thirty
 * rooms - closing on "Run Venues along 30A? Put this week's lineup on your
 * site, free" and a $25 pitch, and /venues/grayton-beach/, /watercolor/,
 * /alys-beach/ and /rosemary-beach/ said the same of whole towns. The
 * placeholder loses its page. A town keeps its listing - indexed, and the
 * only crawlable list of its rows past this weekend - without the pitch.
 */
describe('names that are not a venue', () => {
  const now = noonOn('2026-09-08');
  const festival = [1, 2, 3, 4].map(() => row({ title: '30A Songwriters Festival', venue: 'Venues along 30A', area: 'Seaside' }));
  const grayton = [1, 2, 3].map(() => row({ title: 'Grayton Market', venue: 'Grayton Beach', area: 'Grayton Beach' }));
  const bar = [1, 2, 3].map(() => row());
  const all = [...festival, ...grayton, ...bar];

  it('knows a placeholder, a neighbourhood and a row’s own area from a venue', () => {
    for (const name of ['Venues along 30A', 'venues along 30a ', 'SoWal', '30A.com', 'Grayton Beach', 'WATERCOLOR', 'Rosemary Beach', 'Alys Beach', 'Seaside', '', '  ', null]) {
      assert.equal(isVenueName(name), false, String(name));
    }
    assert.equal(isVenueName('Santa Rosa Beach', 'Santa Rosa Beach'), false); // an area the copy has not heard of
    // A business whose name holds a town's is still a business. (Until 1 Oct
    // 2026 this list held Seaside Pavilion, which is a pavilion: see below.)
    for (const name of ['The Red Bar', "AJ's Grayton Beach", 'The Boathouse at WaterColor', 'WaterColor Inn & Resort']) {
      assert.equal(isVenueName(name, 'Seaside'), true, name);
    }
    // Seaside's post office, where the Walking Club meets: a place, not a
    // business anyone there could put a strip on.
    for (const name of ['Post Office', 'post office ']) {
      assert.equal(isVenueName(name, 'Seaside'), false, name);
    }
    // Only the placeholders lose the listing too.
    for (const name of ['Venues along 30A', ' SOWAL', '30A.com day view', 'Visit South Walton', '', null]) {
      assert.equal(isPlaceholderVenue(name), true, String(name));
    }
    for (const name of ['Grayton Beach', 'Santa Rosa Beach', 'The Red Bar', 'Post Office']) {
      assert.equal(isPlaceholderVenue(name), false, name);
    }
  });

  it('keeps the post office’s page and its strip, and drops the pitch', () => {
    // Until 1 Oct 2026 /venues/post-office/ closed on "Run Post Office? Put
    // this week's lineup on your site, free" and "Feature a show — $25".
    const walks = [1, 2, 3, 4].map(() => row({ title: 'Walking Club', venue: 'Post Office', area: 'Seaside' }));
    const pages = venuePages([...walks, ...bar], now);
    const office = pages.find((p) => p.slug === 'post-office');
    assert.equal(office.owner, false);
    assert.match(renderVenuesIndex(pages, now).html, /<a href="\/venues\/post-office\/">Post Office<\/a>/);
    assert.match(sitemapXml([...walks, ...bar], pages, now), /\/venues\/post-office\//);
    const html = renderVenue(office, now).html;
    assert.match(html, /Walking Club/);
    assert.doesNotMatch(html, /class="owner"|Run Post Office\?|embed\/post-office|Feature a show|id="copy"/);
    // Its page hands out nothing new, but the strip it handed out before
    // 1 Oct 2026 (the seed) stays, rows and all.
    assert.deepEqual(publishedStrips([], pages).map((p) => p.slug), ['the-red-bar']);
    assert.ok(!embedDirs(embedVenues([...walks, ...bar], now)).some((d) => d.dir === 'post-office'));
    const seeded = publishedStrips(seedPublished([{ dir: 'post-office', html: '<h1>Post Office</h1>' }]), pages);
    const strip = embedDirs(embedVenues([...walks, ...bar], now, seeded)).find((d) => d.dir === 'post-office');
    assert.match(renderEmbed(strip.venue, now), /Walking Club/);
  });

  // Every venue page on https://30anow.github.io/sitemap.xml on 1 Oct 2026,
  // with its area. Twelve of them besides the post office closed on "Run
  // <it>?" and the $25 pitch: a Baptist church, a chapel, a Sunday service
  // on a beach access, a town hall, two squares, another beach access, a
  // sports complex, and Seaside's courts, stage and two pavilions.
  const PITCHED = [
    ['Old Florida Fish House', 'Seagrove'], ['The Big Chill 30A', 'WaterSound'],
    ["Stinky's Bait Shack", 'Dune Allen'], ['The Red Bar', 'Grayton Beach'],
    ['Crackings', 'Grayton Beach'], ['Red Fish Taco', 'Blue Mountain'],
    ['Seaside Fitness Center', 'Seaside'], ['The Boathouse at WaterColor', 'WaterColor'],
    ["AJ's Grayton Beach", 'Grayton Beach'], ['Peddlers Pavilion', 'Rosemary Beach'],
    ['Havana Beach Bar & Grill', 'Rosemary Beach'], ['Watersound Town Center', 'WaterSound'],
    ['Idyll Hound Proper', 'Inlet Beach'], ['Seaside Athletic Club', 'Seaside'],
    ['Shades Bar & Grill', 'Inlet Beach'], ["Pickle's Sandbar", 'Seaside'],
    ['The Shrimp Shack & Boardwalk Bar', 'Seaside'], ['Fish Out of Water', 'WaterColor'],
    ['Hibiscus Guesthouse', 'Grayton Beach'], ['NEAT Bottle Shop', 'Alys Beach'],
    ['Seaside Farmers Market', 'Seaside'], ["Stinky's Fish Camp", 'Dune Allen'],
    ['WaterColor Inn & Resort', 'WaterColor'], ['WaterColor Store', 'WaterColor'],
  ];
  const NOT_PITCHED = [
    ['Tennis & Pickleball Courts', 'Seaside'], ['Seaside Pavilion', 'Seaside'],
    ['Seaside Amphitheater', 'Seaside'], ['Coleman Pavilion', 'Seaside'],
    ['Rosemary Beach Town Hall', 'Rosemary Beach'], ['The Chapel at Seaside', 'Seaside'],
    ['Seaside’s Central Square', 'Seaside'], ['Ed Walline Beach Access', 'Gulf Place'],
    ['Hope on the Beach - Orange Street', 'Inlet Beach'], ['North Barrett Square', 'Rosemary Beach'],
    ['Post Office', 'Seaside'], ['Seagrove Baptist Church', 'Seagrove'],
    ['Walton Sports Complex', 'Seaside'],
    // The four towns, as since the first cut on 1 Oct 2026.
    ['Alys Beach', 'Alys Beach'], ['Rosemary Beach', 'Rosemary Beach'],
    ['WaterColor', 'WaterColor'], ['Grayton Beach', 'Grayton Beach'],
  ];

  it('pitches only the businesses among the live venue pages of 1 Oct 2026', () => {
    assert.equal(PITCHED.length + NOT_PITCHED.length, 41);
    for (const [name, area] of PITCHED) assert.equal(isVenueName(name, area), true, name);
    for (const [name, area] of NOT_PITCHED) assert.equal(isVenueName(name, area), false, name);
    // Through venuePages, as the run sees them.
    const rows = [...PITCHED, ...NOT_PITCHED].flatMap(([venue, area]) =>
      [1, 2, 3].map(() => row({ title: `On at ${venue}`, venue, area })),
    );
    const pages = venuePages(rows, now);
    assert.equal(pages.length, 41);
    const pitched = pages.filter((p) => p.owner).map((p) => p.name).sort();
    assert.deepEqual(pitched, PITCHED.map(([name]) => name).sort());
    const html = pages.map((v) => renderVenue(v, now).html).join('\n');
    assert.equal(html.match(/<strong>Run /g).length, PITCHED.length);
    for (const [name] of NOT_PITCHED) assert.ok(!html.includes(`Run ${esc(name)}?`), name);
  });

  it('knows the kind and the other spellings, and leaves a business named after one alone', () => {
    for (const name of [
      'hope on the beach – orange street', // en dash
      "Seaside's Central Square", // straight apostrophe
      ' SEASIDE AMPHITHEATER ',
      'Coastal Branch Library',
      'Santa Rosa Beach Town Hall',
      'Christ the King Church',
      'Church of the Holy Spirit',
      'Chapel at the Beach',
      'Grayton Beach State Park',
      'Pickleball Courts',
      'Santa Clara Beach Access',
      // Found after the first cut on 1 Oct 2026: a public school, Alys
      // Beach's stage and park, a St. Joe neighbourhood.
      'Dune Lakes Elementary School',
      'Emerald Coast Middle School',
      'South Walton High School',
      'Alys Beach Amphitheatre',
      'central park, alys beach',
      'Watersound Origins',
    ]) {
      assert.equal(isVenueName(name, 'Seaside'), false, name);
    }
    for (const name of [
      'Church Street Bistro',
      'The Library Bar',
      'Square One',
      'The Courtyard',
      'Big Kahuna’s Water Park',
      'Peddlers Pavilion', // books a band most nights
      'Seaside Post Office Coffee',
      '30A Surf School', // sells lessons
      'Watersound Origins Town Center',
    ]) {
      assert.equal(isVenueName(name, 'Seaside'), true, name);
    }
  });

  it('keeps their pages, rows and handed-out strips, and drops the pitch', () => {
    const places = ['Seagrove Baptist Church', 'Seaside Amphitheater', 'Tennis & Pickleball Courts'];
    const rows = places.flatMap((venue) => [1, 2, 3].map(() => row({ title: `On at ${venue}`, venue, area: 'Seaside' })));
    const pages = venuePages([...rows, ...bar], now);
    const index = renderVenuesIndex(pages, now).html;
    const xml = sitemapXml([...rows, ...bar], pages, now);
    for (const venue of places) {
      const page = pages.find((p) => p.name === venue);
      assert.equal(page.owner, false, venue);
      assert.match(index, new RegExp(`/venues/${page.slug}/`));
      assert.match(xml, new RegExp(`/venues/${page.slug}/`));
      const html = renderVenue(page, now).html;
      assert.ok(html.includes(`On at ${esc(venue)}`), venue);
      assert.doesNotMatch(html, /class="owner"|Run .*\?<\/strong>|Feature a show|id="copy"/, venue);
      assert.ok(!html.includes(`embed/${page.slug}/`), venue);
    }
    // No new strip handed out; the ones their footers gave out before
    // 1 Oct 2026 (all twelve are in embed/published.json) stay, rows and all.
    assert.deepEqual(publishedStrips([], pages).map((p) => p.slug), ['the-red-bar']);
    const seeded = publishedStrips(
      seedPublished([{ dir: 'seagrove-baptist-church', html: '<h1>Seagrove Baptist Church</h1>' }]),
      pages,
    );
    const dirs = embedDirs(embedVenues([...rows, ...bar], now, seeded));
    assert.ok(!dirs.some((d) => d.dir === 'seaside-amphitheater'));
    const strip = dirs.find((d) => d.dir === 'seagrove-baptist-church');
    assert.match(renderEmbed(strip.venue, now), /On at Seagrove Baptist Church/);
  });

  it('drops the pitch from the four places on their way to a page, and keeps the strips in embed/', () => {
    // Each was in the feed or embed/ on 1 Oct 2026 with no page yet; the
    // run that gave it a third row ahead would have pitched it.
    const places = [
      ['Dune Lakes Elementary School', 'Seaside', 'Soccer Sessions for Kids!'],
      ['Central Park Alys Beach', 'Alys Beach', 'Alys Classics: Parent Trap'],
      ['Alys Beach Amphitheatre', 'Alys Beach', 'Alo in Motion'],
      ['Watersound Origins', 'WaterSound', 'Watersound PorchFest'],
    ];
    const rows = places.flatMap(([venue, area, title]) => [1, 2, 3].map(() => row({ title, venue, area })));
    const pages = venuePages([...rows, ...bar], now);
    for (const [venue, , title] of places) {
      const page = pages.find((p) => p.name === venue);
      assert.equal(page.owner, false, venue);
      const html = renderVenue(page, now).html;
      assert.ok(html.includes(esc(title)), venue);
      assert.doesNotMatch(html, /class="owner"|Run .*\?<\/strong>|Feature a show|id="copy"/, venue);
    }
    assert.deepEqual(publishedStrips([], pages).map((p) => p.slug), ['the-red-bar']);
    // The amphitheatre's and Watersound Origins' strips were in embed/ that
    // day, so the seed keeps them; the school's and the park's had gone.
    const seeded = publishedStrips(
      seedPublished([
        { dir: 'alys-beach-amphitheatre', html: '<h1>Alys Beach Amphitheatre</h1>' },
        { dir: 'watersound-origins', html: '<h1>Watersound Origins</h1>' },
      ]),
      pages,
    );
    const dirs = embedDirs(embedVenues([...rows, ...bar], now, seeded)).map((d) => d.dir);
    assert.ok(dirs.includes('alys-beach-amphitheatre') && dirs.includes('watersound-origins'));
    assert.ok(!dirs.includes('dune-lakes-elementary-school') && !dirs.includes('central-park-alys-beach'));
  });

  it('gives a placeholder no venue page, no index entry and no sitemap line', () => {
    const pages = venuePages(all, now);
    assert.deepEqual(pages.map((p) => p.slug), ['grayton-beach', 'the-red-bar']);
    const index = renderVenuesIndex(pages, now).html;
    const xml = sitemapXml(all, pages, now);
    assert.doesNotMatch(index, /\/venues\/venues-along-30a\//);
    assert.doesNotMatch(xml, /\/venues\/venues-along-30a\//);
    // Its rows are still listed, with the place as plain text.
    const lineup = renderLineup(all, pages, now).html;
    assert.match(lineup, /30A Songwriters Festival/);
    assert.match(lineup, /<div class="m">Venues along 30A · Seaside · /);
    const venueSlugs = new Map(pages.map((v) => [v.name.toLowerCase(), v.slug]));
    assert.match(renderStub(festival[0], { now, venueSlugs }).html, /<p class="lead">Venues along 30A · Seaside · /);
  });

  it('keeps a neighbourhood’s listing page, in the index and the sitemap, with no one to pitch', () => {
    // A first cut on 1 Oct 2026 dropped these pages with the pitch, which
    // would have taken /venues/alys-beach/ (8 rows that day),
    // /rosemary-beach/, /watercolor/ and /grayton-beach/ out of the sitemap
    // and answered 404 where Google had them.
    const pages = venuePages(all, now);
    const town = pages.find((p) => p.slug === 'grayton-beach');
    assert.equal(town.owner, false);
    assert.equal(pages.find((p) => p.slug === 'the-red-bar').owner, true);
    assert.match(renderVenuesIndex(pages, now).html, /<a href="\/venues\/grayton-beach\/">Grayton Beach<\/a>/);
    assert.match(sitemapXml(all, pages, now), /\/venues\/grayton-beach\//);
    const html = renderVenue(town, now).html;
    assert.match(html, /<h1>Grayton Beach<\/h1>/);
    assert.match(html, /Grayton Market/);
    // An area the copy has not heard of, named as its own rows' area, too.
    const srb = [1, 2, 3].map(() => row({ venue: 'Santa Rosa Beach', area: 'Santa Rosa Beach' }));
    assert.equal(venuePages(srb, now)[0].owner, false);
  });

  it('never offers a neighbourhood to an owner: no "Run …?" block and no snippet', () => {
    const pages = venuePages(all, now);
    const town = renderVenue(pages.find((p) => p.slug === 'grayton-beach'), now).html;
    assert.doesNotMatch(town, /class="owner"|Run Grayton Beach\?|embed\/grayton-beach|Feature a show|id="copy"/);
    assert.match(renderVenue(pages.find((p) => p.slug === 'the-red-bar'), now).html, /Run The Red Bar\?/);
    assert.doesNotMatch(pages.map((v) => renderVenue(v, now).html).join('\n'), /Run Venues along 30A\?/);
    // Nor does its page add its slug to the strips handed out.
    assert.deepEqual(publishedStrips([], pages), [{ slug: 'the-red-bar', name: 'The Red Bar' }]);
  });

  it('gives them no strip, not even while one of their rows is on', () => {
    const on = { starts_at: '2026-09-08T15:00:00Z', ends_at: '2026-09-08T21:00:00Z' };
    const live = [
      row({ venue: 'Venues along 30A', area: 'Seaside', ...on }),
      row({ venue: 'Grayton Beach', area: 'Grayton Beach', ...on }),
    ];
    const dirs = embedDirs(embedVenues([...all, ...live], now)).map((d) => d.dir);
    for (const dir of ['venues-along-30a', 'Venues along 30A', 'grayton-beach', 'Grayton Beach']) {
      assert.ok(!dirs.includes(dir), dir);
    }
    assert.ok(dirs.includes('the-red-bar'));
  });

  it('keeps a town’s strip its page handed out before 1 Oct 2026, with its rows, and never the placeholder’s', () => {
    // From 25 Sep to 1 Oct /venues/grayton-beach/ offered /embed/grayton-beach/,
    // and a town's events team may have pasted it. The first run seeds the
    // list from the strips on the site.
    const seeded = seedPublished([
      { dir: 'grayton-beach', html: '<h1>Grayton Beach</h1>' },
      { dir: 'venues-along-30a', html: '<h1>Venues along 30A</h1>' },
    ]);
    const published = publishedStrips(seeded, venuePages(all, now));
    assert.deepEqual(published.map((p) => p.slug), ['crackings', 'grayton-beach', 'the-red-bar']);
    const on = { starts_at: '2026-09-08T15:00:00Z', ends_at: '2026-09-08T21:00:00Z' };
    const live = row({ title: 'Grayton Morning Market', venue: 'Grayton Beach', area: 'Grayton Beach', ...on });
    const dirs = embedDirs(embedVenues([...all, live], now, published));
    const strip = dirs.find((d) => d.dir === 'grayton-beach');
    assert.ok(strip, 'the slug its footer gave out still answers');
    const html = renderEmbed(strip.venue, now);
    assert.match(html, /Grayton Market/);
    assert.match(html, /Grayton Morning Market/); // on now
    assert.ok(!dirs.some((d) => d.dir === 'venues-along-30a' || d.dir === 'Venues along 30A'));
    // On now and nothing after it: still the town's own rows.
    const only = embedDirs(embedVenues([...bar, live], now, published)).find((d) => d.dir === 'grayton-beach');
    assert.match(renderEmbed(only.venue, now), /Grayton Morning Market/);
    // Then the honest empty strip, once the town has nothing on.
    const quiet = embedDirs(embedVenues(bar, now, published)).find((d) => d.dir === 'grayton-beach');
    assert.match(renderEmbed(quiet.venue, now), /Nothing posted for the next seven days\./);
  });
});

describe('JSON-LD', () => {
  it('reads prices the way the scraper writes them', () => {
    assert.equal(priceNumber('Free'), '0');
    assert.equal(priceNumber('$30 (from listing)'), '30');
    assert.equal(priceNumber('$12.50 · kids eat free'), '12.50');
    assert.equal(priceNumber('Tickets at the door'), null);
    assert.equal(priceNumber(null), null);
  });
  it('uses the street address when the venue is known', () => {
    const ld = eventJsonLd(row({ price: '$30', url: 'https://30a.com/x/', image_url: 'https://30a.com/p.png' }));
    assert.equal(ld['@type'], 'Event');
    assert.equal(ld.startDate, '2026-09-11T18:00:00-05:00');
    assert.equal(ld.endDate, '2026-09-11T21:00:00-05:00');
    assert.equal(ld.location.address.streetAddress, '70 Hotz Ave');
    assert.equal(ld.location.address.addressLocality, 'Grayton Beach');
    assert.equal(ld.location.geo.latitude, 30.3);
    assert.equal(ld.offers.price, '30');
    assert.equal(ld.offers.url, 'https://30a.com/x/');
    assert.equal(ld.url, 'https://30anow.github.io/e/' + ld.url.slice(-36));
  });
  it('falls back to the area plus Santa Rosa Beach', () => {
    const ld = eventJsonLd(row({ venue: 'Seaside Amphitheater', area: 'Seaside' }));
    assert.equal(ld.location.address.streetAddress, undefined);
    assert.equal(ld.location.address.addressLocality, 'Seaside, Santa Rosa Beach');
    assert.equal(ld.location.address.addressRegion, 'FL');
    assert.equal(ld.offers, undefined);
    assert.equal(ld.image, undefined);
  });
  it('knows the venues the app knows', () => {
    assert.equal(knownVenue("Stinky's Bait Shack").address, '5994 W County Hwy 30A, Dune Allen');
    assert.equal(knownVenue("Stinky's Fish Camp"), null);
  });
  it('names an image only when the poster was probed and served', () => {
    // The stub drops the <img> for a host that blocks hotlinking; structured
    // data on that same page naming the dead URL is what posterOk exists to
    // stop, and Google drops or invalidates the rich result over it.
    const e = row({ image_url: 'https://blocked.example/p.png' });
    assert.equal(eventJsonLd(e).image, undefined);
    assert.deepEqual(eventJsonLd(e, e.image_url).image, ['https://blocked.example/p.png']);
    const now = noonOn('2026-09-08');
    assert.doesNotMatch(withJsonLd(renderStub(e, { poster: null, now })), /blocked.example/);
    assert.match(
      withJsonLd(renderStub(e, { poster: e.image_url, now })),
      /"image":\["https:\/\/blocked.example\/p.png"\]/,
    );
  });
  it('carries the probe result onto the list pages too', () => {
    const now = noonOn('2026-09-08');
    const e = row({ image_url: 'https://30a.com/p.png' });
    const served = renderLineup([e], [], now, new Map([[e.image_url, true]]));
    assert.match(served.jsonLd, /"image":\["https:\/\/30a.com\/p.png"\]/);
    const blocked = renderLineup([e], [], now, new Map([[e.image_url, false]]));
    assert.doesNotMatch(blocked.jsonLd, /image/);
    // No probe ran for this page, so it claims no image at all.
    assert.doesNotMatch(renderLineup([e], [], now).jsonLd, /image/);
  });
});

describe('links out of a row', () => {
  const now = noonOn('2026-09-08');
  it('takes http and https and nothing else', () => {
    assert.equal(safeUrl('https://sowal.com/e?a=1&b=2'), 'https://sowal.com/e?a=1&b=2');
    assert.equal(safeUrl('http://30a.com/x/'), 'http://30a.com/x/');
    for (const bad of [
      // Parses fine, hostname and all — `new URL()` is not a check.
      'javascript://evil.example.com/%0aalert(document.domain)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'not a url',
      '',
      null,
    ]) {
      assert.equal(safeUrl(bad), '', `${bad} should not pass`);
    }
  });
  it('never puts a javascript: URL in an href or an offer', () => {
    const e = row({ url: 'javascript://evil.example.com/%0aalert(document.domain)', price: '$10' });
    for (const html of [rowHtml(e), renderStub(e, { now }).html]) {
      assert.doesNotMatch(html, /javascript:/);
      assert.doesNotMatch(html, /Listing on/);
    }
    assert.equal(eventJsonLd(e).offers.url, `https://30anow.github.io/e/${e.id}`);
  });
});

describe('shrinkRefusal', () => {
  it('refuses an empty or collapsed fetch and passes a normal run', () => {
    // 451 stubs and 36 venue pages were live on 8 Sep 2026; each /e/<id> is
    // a link already in a group chat. An empty 200 must never rewrite them.
    assert.match(shrinkRefusal(0, 451), /0 rows/);
    assert.match(shrinkRefusal(0, 0), /0 rows/);
    assert.match(shrinkRefusal(300, 451), /300 rows against 451/);
    assert.equal(shrinkRefusal(316, 451), '');
    assert.equal(shrinkRefusal(451, 451), '');
    assert.equal(shrinkRefusal(670, 451), '');
    assert.equal(shrinkRefusal(451, 0), ''); // nothing published yet
  });
});

describe('truncationRefusal', () => {
  it('tells a last page from a page the server cut short', () => {
    // 467 rows matched on 9 Sep 2026 and all of them came back in one page.
    assert.equal(truncationRefusal(467, 1000, 467), '');
    // A full page says nothing either way — the loop asks for the next one.
    assert.equal(truncationRefusal(1000, 1000, 1294), '');
    // No count header: content-range reads "0-466/*", so there is nothing
    // to compare and the short page is taken at its word.
    assert.equal(truncationRefusal(467, 1000, NaN), '');
    // The one that matters: max-rows set below PAGE, so page one is short
    // *and* the total says there is more. Paging would have stopped here
    // and dropped 794 rows, and shrinkRefusal would not have blinked.
    assert.match(truncationRefusal(500, 1000, 1294), /500 of 1294/);
  });
});

describe('rowHtml', () => {
  it('escapes everything that came from a feed', () => {
    const html = rowHtml(row({ title: 'Trivia <b>&</b> "Wings"', description: 'a < b', url: 'https://www.sowal.com/e?a=1&b=2' }));
    assert.match(html, /Trivia &lt;b&gt;&amp;&lt;\/b&gt; &quot;Wings&quot;/);
    assert.match(html, /<p class="d">a &lt; b<\/p>/);
    assert.match(html, /href="https:\/\/www.sowal.com\/e\?a=1&amp;b=2" rel="nofollow noopener">Listing on sowal.com/);
    assert.match(html, /Fri, Sep 11 · 6:00 PM – 9:00 PM/);
  });
  it('links the venue only when it has a page, and never repeats the title as a description', () => {
    const slugs = new Map([['the red bar', 'the-red-bar']]);
    assert.match(rowHtml(row({ description: 'Live Music' }), slugs), /<a href="\/venues\/the-red-bar\/">The Red Bar<\/a>/);
    assert.doesNotMatch(rowHtml(row({ description: 'Live Music' }), slugs), /class="d"/);
    assert.doesNotMatch(rowHtml(row(), new Map()), /venues\//);
    assert.doesNotMatch(rowHtml(row(), slugs, { showVenue: false }), /Red Bar/);
  });
});

describe('pages', () => {
  const now = noonOn('2026-09-08');
  const rows = [
    row({ title: 'Jazz Night' }),
    row({ category: 'fitness', title: 'Sunrise Yoga', venue: 'Seaside Fitness Center', starts_at: '2026-09-12T12:00:00Z', ends_at: '2026-09-12T13:00:00Z' }),
    row({ title: 'Tonight Trivia', starts_at: '2026-09-09T00:00:00Z', ends_at: '2026-09-09T02:00:00Z' }), // Tue 7 PM
    row({ title: 'Lunch Set', starts_at: '2026-09-08T17:00:00Z', ends_at: '2026-09-08T19:00:00Z' }), // Tue noon
  ];
  const venues = venuePages(rows, now);

  it('lineup lists Fri–Sun with the weekend meta and one JSON-LD Event per row', () => {
    const page = renderLineup(rows, venues, now);
    const html = withJsonLd(page);
    assert.equal(page.count, 2);
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/lineup\/">/);
    assert.match(html, /apple-itunes-app" content="app-id=6792965952, app-argument=thirtyanow:\/\/weekend"/);
    assert.match(html, /<h2>Friday, Sep 11<\/h2>/);
    assert.match(html, /<h2>Saturday, Sep 12<\/h2>/);
    assert.match(html, /<summary>1 class, clinic or court time<\/summary>/);
    assert.doesNotMatch(html, /Tonight Trivia/);
    assert.match(html, /Open in 30A Now/);
    assert.match(html, /Get it for iPhone/);
    assert.match(html, /<a class="live" href="\/weekend\?s=seo-lineup">/);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(ld.length, 2);
    assert.deepEqual(ld.map((e) => e.name).sort(), ['Jazz Night', 'Sunrise Yoga']);
  });

  it('tonight is today from 4 PM', () => {
    const html = withJsonLd(renderTonight(rows, venues, now));
    assert.match(html, /Tonight Trivia/);
    assert.doesNotMatch(html, /Lunch Set/);
    assert.doesNotMatch(html, /Jazz Night/);
    // The feed, under the tag that tells it from the widget's own link.
    assert.match(html, /app-argument=thirtyanow:\/\/feed\?s=web"/);
    assert.match(html, /<a class="live" href="\/feed\?s=seo-tonight">/);
  });

  it('tonight names the night it lists, not the moment it was generated', () => {
    // The run that covers beach midnight lands at 23:10 in winter. Before
    // this the page stamped the generation day into its title and lead, so
    // from midnight until the 4:20 AM run it read "Tonight on 30A —
    // <yesterday>" over shows that had already ended.
    const wed = row({
      title: 'Wednesday Blues',
      starts_at: '2026-09-10T00:00:00Z', // Wed Sep 9, 7 PM CDT
      ends_at: '2026-09-10T03:00:00Z',
    });
    const page = renderTonight([...rows, wed], venues, beachWallToUtc('2026-09-08', 23, 10));
    assert.match(page.html, /<title>Tonight on 30A — Wednesday, Sep 9<\/title>/);
    assert.match(page.html, /Wednesday, Sep 9 · from 4 PM/);
    assert.match(page.html, /Wednesday Blues/);
    assert.doesNotMatch(page.html, /Tonight Trivia/); // Tuesday's, and over
  });

  it('tonight says so when nothing is on', () => {
    const page = renderTonight([rows[0]], venues, now);
    assert.equal(page.count, 0);
    assert.match(page.html, /Quiet night/);
    assert.equal(page.jsonLd, '');
  });

  it('venue page carries the card and the encoded live link', () => {
    const v = venuePages([...rows, row({ title: "Dread Clampitt" })], now).find((p) => p.slug === 'the-red-bar');
    const html = withJsonLd(renderVenue(v, now));
    assert.match(html, /<h1>The Red Bar<\/h1>/);
    assert.match(html, /70 Hotz Ave, Grayton Beach/);
    assert.match(html, /theredbar.com/);
    assert.match(html, /href="\/venue\/The%20Red%20Bar\?s=seo-venue"/);
    assert.match(html, /app-argument=thirtyanow:\/\/venue\/The%20Red%20Bar"/);
    assert.match(html, /Dread Clampitt/);
    assert.doesNotMatch(html, /Sunrise Yoga/);
  });

  it('venues index links every page', () => {
    const html = renderVenuesIndex(venues, now).html;
    for (const v of venues) assert.match(html, new RegExp(`href="/venues/${v.slug}/"`));
  });

  it('a title cannot break out of the JSON-LD script', () => {
    const html = withJsonLd(renderLineup([row({ title: 'x</script><script>alert(1)' })], [], now));
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /\\u003c\/script/);
  });

  it('reads $ in scraped text as text, not as a substitution pattern', () => {
    // withJsonLd used to pass the JSON-LD as a replacement *string*, where
    // $&, $` , $' and $$ mean something: a description of "Ladies night $'
    // free wine" spliced everything after </head> — the SCRIPT block's own
    // </script> included — into the ld+json tag and re-parsed the body,
    // which is how a 5,783-byte stub became 7,489 bytes with two footers.
    const e = row({ title: 'Rock $& Roll', description: "Ladies night $' free wine $$ tapas" });
    const html = withJsonLd(renderStub(e, { now }));
    assert.equal((html.match(/<footer>/g) || []).length, 1);
    assert.equal((html.match(/<\/head>/g) || []).length, 1);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(ld[0].name, 'Rock $& Roll');
    assert.equal(ld[0].description, "Ladies night $' free wine $$ tapas");
  });
});

describe('share stub', () => {
  const now = noonOn('2026-09-08');
  it('is a page of its own, with the poster as the large card', () => {
    const e = row({
      title: 'Jazz Night',
      price: '$10',
      description: 'Two sets.',
      url: 'https://30a.com/x/',
      image_url: 'https://30a.com/p.png',
    });
    const html = withJsonLd(
      renderStub(e, { poster: e.image_url, now, venueSlugs: new Map([['the red bar', 'the-red-bar']]) }),
    );
    assert.match(html, new RegExp(`<link rel="canonical" href="https://30anow.github.io/e/${e.id}">`));
    assert.match(html, /<meta property="og:image" content="https:\/\/30a.com\/p.png">/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.match(html, new RegExp(`app-argument=thirtyanow://event/${e.id}"`));
    assert.match(html, new RegExp(`<noscript><meta http-equiv="refresh" content="3;url=/event/${e.id}"></noscript>`));
    assert.doesNotMatch(html, /content="0;url/);
    assert.match(html, /<h1>Jazz Night<\/h1>/);
    assert.match(html, /<a href="\/venues\/the-red-bar\/">The Red Bar<\/a> · Grayton Beach · Fri, Sep 11 · 6:00 PM – 9:00 PM · \$10/);
    assert.match(html, /<img class="poster" src="https:\/\/30a.com\/p.png"/);
    assert.match(html, /<p class="d">Two sets.<\/p>/);
    assert.match(html, /Listing on 30a.com/);
    assert.match(
      html,
      new RegExp(`<a class="live" href="/event/${e.id}\\?s=seo-event">See it on the live map</a>`),
    );
    assert.match(html, new RegExp(`data-app="thirtyanow://event/${e.id}"`));
    assert.match(html, /Get it for iPhone/);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(ld.length, 1);
    assert.equal(ld[0].name, 'Jazz Night');
    assert.equal(ld[0].url, `https://30anow.github.io/e/${e.id}`);
  });
  it('falls back to the branded card without a poster', () => {
    const html = renderStub(row(), { now }).html;
    assert.match(html, /og:image" content="https:\/\/30anow.github.io\/og-default.png"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html, /class="poster"/);
    assert.match(html, /<p class="lead">The Red Bar · Grayton Beach · Fri, Sep 11 · 6:00 PM – 9:00 PM<\/p>/);
    assert.match(html, /Grayton Beach · Fri, Sep 11 · 6:00 PM – 9:00 PM — on the 30A Now live map\./);
  });
  it('carries the query through to the live link and escapes the feed', () => {
    const html = renderStub(row({ title: 'A <b>"night"</b>', venue: 'Bud & Alley\'s', area: '' }), { now }).html;
    assert.deepEqual(forward(html, '?s=share', ['/event/abc?s=seo-event']), ['/event/abc?s=share']);
    assert.match(html, /<title>A &lt;b&gt;&quot;night&quot;&lt;\/b&gt; — 30A Now<\/title>/);
    assert.match(html, /<p class="lead">Bud &amp; Alley&#39;s|<p class="lead">Bud &amp; Alley's/);
  });
});

/**
 * Runs a page's own forwarder the way a browser would: the anchors read
 * their href back absolute, as a real <a> does, and hand back the attribute
 * the script left behind. The script asks for two kinds of anchor, the
 * internal links and the store links, and gets the ones whose href says
 * which it is.
 */
function forward(html, search, hrefs) {
  const js = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
  const links = hrefs.map((h) => {
    const a = { attr: h };
    Object.defineProperty(a, 'href', {
      get: () => new URL(a.attr, 'https://30anow.github.io/lineup/').toString(),
      set: (v) => {
        a.attr = v;
      },
    });
    return a;
  });
  const env = {
    location: { search },
    navigator: { userAgent: 'node' },
    document: {
      hidden: false,
      getElementById: () => null,
      querySelectorAll: (sel) =>
        sel.includes('a[href^="/"]')
          ? links.filter((a) => a.attr.startsWith('/'))
          : sel.includes('apps.apple.com')
            ? links.filter((a) => a.attr.startsWith('https://apps.apple.com/'))
            : [],
    },
    URL,
    URLSearchParams,
    Date,
    setTimeout,
  };
  new Function(...Object.keys(env), js)(...Object.values(env));
  return links.map((a) => a.attr);
}

describe('arrival tags', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venues = venuePages(rows, now);

  it('gives every way into the live app a tag, so an arrival from Google is countable', () => {
    // Until 9 Sep 2026 every cta() caller passed a bare path. app_open fires
    // only for a member or a guest and web_arrival only on a tag, so a
    // visitor who found /lineup/ in Google and clicked through wrote no row
    // at all — the one channel whose point is new people, with no data.
    assert.match(renderLineup(rows, venues, now).html, /class="live" href="\/weekend\?s=seo-lineup"/);
    assert.match(renderTonight(rows, venues, now).html, /class="live" href="\/feed\?s=seo-tonight"/);
    assert.match(renderVenue(venues[0], now).html, /class="live" href="[^"]*\?s=seo-venue"/);
    assert.match(renderVenuesIndex(venues, now).html, /class="live" href="\/\?s=seo-venue-index"/);
    assert.match(renderStub(rows[0], { now }).html, /class="live" href="[^"]*\?s=seo-event"/);
    const acts = actPages([row({ title: 'Jared Herzog' }), row({ title: 'Jared Herzog' })], now);
    assert.match(renderAct(acts[0], now).html, /class="live" href="\/act\/jared-herzog\?s=seo-act"/);
    assert.match(renderActsIndex(acts, now).html, /class="live" href="\/feed\?s=seo-act-index"/);
    assert.equal(ARRIVAL.act, 'seo-act');
  });

  it('names the page that fed the click on the row link, not just the stub', () => {
    // Without this every SEO arrival collapses into seo-event, because the
    // stub's own CTA is the last hop, and "is the weekend list working or
    // are the venue pages?" stays unanswerable.
    assert.match(renderLineup(rows, venues, now).html, new RegExp(`href="/e/${rows[0].id}\\?s=seo-lineup"`));
    assert.match(renderVenue(venues[0], now).html, new RegExp(`href="/e/${rows[0].id}\\?s=seo-venue"`));
  });

  it('merges the visitor’s own tag into internal links instead of concatenating', () => {
    // `live[i].href+=location.search` was fine while the links were bare.
    // With a tag of their own it produced "/weekend?s=seo-lineup?utm_source=x",
    // which parseArrival reads as one value and drops against ^[\w.-]+$ —
    // the tag silently lost on exactly the visits worth counting.
    const html = renderLineup(rows, venues, now).html;
    assert.deepEqual(
      forward(html, '?s=fb&utm_source=x', [
        '/weekend?s=seo-lineup',
        `/e/${rows[0].id}?s=seo-lineup`,
        '/venues/the-red-bar/',
      ]),
      ['/weekend?s=fb', `/e/${rows[0].id}?s=fb`, '/venues/the-red-bar/?s=fb'],
    );
  });

  it('leaves the page’s own tag alone when the visitor carries none, and rides ref through', () => {
    const html = renderLineup(rows, venues, now).html;
    assert.deepEqual(forward(html, '', ['/weekend?s=seo-lineup']), ['/weekend?s=seo-lineup']);
    assert.deepEqual(forward(html, '?utm_medium=email', ['/weekend?s=seo-lineup']), ['/weekend?s=seo-lineup']);
    assert.deepEqual(forward(html, '?ref=the-red-bar', ['/weekend?s=seo-lineup']), [
      '/weekend?s=seo-lineup&ref=the-red-bar',
    ]);
  });

  it('rewrites the nav and the rows, but not the footer boilerplate', () => {
    // Privacy and Terms are the only footer links that are also SPA routes,
    // and a reader opening one from a share stub would be counted as a
    // second arrival. They live outside <main>, so the selector says so.
    const html = renderLineup(rows, venues, now).html;
    assert.equal(
      /querySelectorAll\('([^']+)'\)/.exec(html)[1],
      'header a[href^="/"],main a[href^="/"]',
    );
    assert.match(html, /<footer>[\s\S]*legal\/privacy/);
  });

  it('keeps every tag inside what parseArrival will accept', () => {
    for (const tag of Object.values(ARRIVAL)) {
      assert.match(tag, /^[\w.-]+$/);
      assert.ok(tag.length <= 40);
    }
  });

  it('carries the invite and the share the app hands out into the live app', () => {
    // The app's "Join me on 30A Now" invite and the weekend page's share
    // button both point at /lineup/ with these two tags since 25 Sep 2026
    // (app/(tabs)/friends.tsx, app/weekend.tsx in the app repo); before
    // that they pointed at the /weekend shell with no tag, so neither was
    // countable. This is the hop that keeps them so.
    const html = renderLineup(rows, venues, now).html;
    for (const tag of ['invite', 'share']) {
      assert.deepEqual(
        forward(html, `?s=${tag}`, ['/weekend?s=seo-lineup', `/e/${rows[0].id}?s=seo-lineup`]),
        [`/weekend?s=${tag}`, `/e/${rows[0].id}?s=${tag}`],
      );
    }
  });
});

/**
 * App Store Connect attributes downloads per campaign tag for free, but
 * only on a link that carries both pt= and ct= — Apple ignores a ct without
 * a pt. Until the provider token is filled in every store link on the site
 * is the bare listing, so nothing changes for a visitor on the day it is.
 */
describe('campaign links', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venues = venuePages(rows, now);
  const CAMPAIGN = 'https://apps.apple.com/app/id6792965952?pt=123456&ct=seo-lineup&mt=8';

  it('is the bare listing while the provider token is empty, and a campaign link once it is set', () => {
    assert.equal(storeUrl('seo-lineup', ''), APP_STORE_URL);
    assert.equal(storeUrl('seo-lineup', '123456'), CAMPAIGN);
    assert.equal(storeUrl('', '123456'), APP_STORE_URL);
  });

  it('holds the tag to what parseArrival accepts and to Apple’s forty, and every page tag survives it', () => {
    assert.match(storeUrl('bud & alley’s', '123456'), /&ct=budalleys&mt=8$/);
    assert.match(storeUrl('x'.repeat(60), '123456'), /&ct=x{40}&mt=8$/);
    for (const tag of Object.values(ARRIVAL)) {
      assert.match(storeUrl(tag, '123456'), new RegExp(`&ct=${tag}&mt=8$`));
    }
  });

  it('ships with the token the checklist says to fill, or a numeric one', () => {
    // Apple's provider token is a number; anything else is a paste of the
    // whole campaign link, which would produce pt=https://...
    assert.match(APP_STORE_PROVIDER_TOKEN, /^\d*$/);
  });

  it('puts the page’s tag on both store buttons of every page', () => {
    const pages = {
      'seo-lineup': renderLineup(rows, venues, now).html,
      'seo-tonight': renderTonight(rows, venues, now).html,
      'seo-venue': renderVenue(venues[0], now).html,
      'seo-venue-index': renderVenuesIndex(venues, now).html,
      'seo-event': renderStub(rows[0], { now }).html,
    };
    for (const [tag, html] of Object.entries(pages)) {
      const want = storeUrl(tag);
      assert.equal((html.split(`href="${want}"`).length - 1), 2, `${tag}: two store buttons`);
      // The token is empty in this checkout, so the buttons are the bare
      // listing and no page says pt= anywhere.
      if (!APP_STORE_PROVIDER_TOKEN) assert.doesNotMatch(html, /[?&]pt=/);
    }
  });

  it('rewrites ct= to the visitor’s own tag, so an invite install is not counted as seo-lineup', () => {
    const html = renderLineup(rows, venues, now).html;
    assert.deepEqual(forward(html, '?s=invite', [CAMPAIGN, '/weekend?s=seo-lineup']), [
      'https://apps.apple.com/app/id6792965952?pt=123456&ct=invite&mt=8',
      '/weekend?s=invite',
    ]);
    assert.deepEqual(forward(html, '?s=fb', [CAMPAIGN]), [
      'https://apps.apple.com/app/id6792965952?pt=123456&ct=fb&mt=8',
    ]);
    // Off a partner's strip the arrival carries ref=, and the store link is
    // tagged embed-<venue>: the key the app's own front page would mint.
    assert.deepEqual(forward(html, '?ref=the-red-bar', [CAMPAIGN]), [
      'https://apps.apple.com/app/id6792965952?pt=123456&ct=embed-the-red-bar&mt=8',
    ]);
  });

  it('leaves a store link alone when there is nothing honest to write on it', () => {
    const html = renderLineup(rows, venues, now).html;
    // No tag on the visit; a tag parseArrival would refuse whole, as it
    // does rather than keep the letters (so "<x>" is no campaign "x"); a
    // tag past forty, cut where parseArrival cuts; a bare listing with no
    // ct= to rewrite (the token is empty).
    assert.deepEqual(forward(html, '', [CAMPAIGN]), [CAMPAIGN]);
    assert.deepEqual(forward(html, '?utm_source=x', [CAMPAIGN]), [CAMPAIGN]);
    assert.deepEqual(forward(html, '?s=%3Cx%3E', [CAMPAIGN]), [CAMPAIGN]);
    assert.deepEqual(forward(html, `?s=${'y'.repeat(50)}`, [CAMPAIGN]), [
      `https://apps.apple.com/app/id6792965952?pt=123456&ct=${'y'.repeat(40)}&mt=8`,
    ]);
    assert.deepEqual(forward(html, '?s=invite', [APP_STORE_URL]), [APP_STORE_URL]);
  });
});

/**
 * Runs a page's forwarder with its "Open in 30A Now" button present, and
 * answers with the button's app link afterwards. `forward` has no button
 * (getElementById answers null there), and the phone-only click handler is
 * kept out by the user agent: what is under test is the attribute.
 */
function openLink(html, search) {
  const js = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
  let dataApp = /id="open" href="[^"]*" data-app="([^"]*)"/.exec(html)[1];
  const open = {
    href: 'https://apps.apple.com/app/id6792965952',
    getAttribute: (name) => (name === 'data-app' ? dataApp : null),
    setAttribute: (name, v) => {
      if (name === 'data-app') dataApp = v;
    },
    addEventListener: () => {},
  };
  const env = {
    location: { search },
    navigator: { userAgent: 'node' },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'open' ? open : null),
      querySelectorAll: () => [],
    },
    URL,
    URLSearchParams,
    Date,
    setTimeout,
  };
  new Function(...Object.keys(env), js)(...Object.values(env));
  return dataApp;
}

/**
 * The app's friend invite names who sent it since 27 Sep 2026: the link is
 * /lineup/?s=invite&from=<member id>, and the live Weekend screen turns the
 * id into "Add <name> to your crew?". Before that an invite said nothing
 * about its sender, and made a friendship only when the invitee happened
 * to have the inviter's number in their contacts. These pages are the hop
 * in between, so they carry from= into the app exactly as they carry s=.
 */
describe('invite links', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venues = venuePages(rows, now);
  const html = renderLineup(rows, venues, now).html;
  const SAM = '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c';
  const CAMPAIGN = 'https://apps.apple.com/app/id6792965952?pt=123456&ct=seo-lineup&mt=8';

  it('carries the inviter onto every link into the live app, beside the invite tag, and nothing else', () => {
    assert.deepEqual(
      forward(html, `?s=invite&from=${SAM}`, ['/weekend?s=seo-lineup', `/e/${rows[0].id}?s=seo-lineup`]),
      [`/weekend?s=invite&from=${SAM}`, `/e/${rows[0].id}?s=invite&from=${SAM}`],
    );
    // Lowercased, so the app sees one spelling of one member.
    assert.deepEqual(forward(html, `?s=invite&from=${SAM.toUpperCase()}`, ['/weekend?s=seo-lineup']), [
      `/weekend?s=invite&from=${SAM}`,
    ]);
    // Only a member id: the link travels through share sheets and group
    // chats, and the app would only send anything else to the lookup.
    for (const bad of ['abc', `${SAM}0`, '%3Cscript%3E', `${SAM.slice(0, -1)}g`, '']) {
      assert.deepEqual(forward(html, `?s=invite&from=${bad}`, ['/weekend?s=seo-lineup']), [
        '/weekend?s=invite',
      ]);
    }
  });

  it('carries from= alone without inventing a store campaign for it', () => {
    // The store rewrite reads s or ref; run on from= alone it would write
    // ct=embed-null onto the buttons.
    assert.deepEqual(forward(html, `?from=${SAM}`, [CAMPAIGN, '/weekend?s=seo-lineup']), [
      CAMPAIGN,
      `/weekend?s=seo-lineup&from=${SAM}`,
    ]);
    // And the invite's store link is still counted as the invite.
    assert.deepEqual(forward(html, `?s=invite&from=${SAM}`, [CAMPAIGN]), [
      'https://apps.apple.com/app/id6792965952?pt=123456&ct=invite&mt=8',
    ]);
  });

  it('puts the inviter on the Open in 30A Now link, for a phone that has the app', () => {
    // A 1.0.0 or 1.1.0 binary does not claim /lineup as a universal link,
    // so this button is the way in; without from= it opened the Weekend
    // screen with no idea who had sent the invite.
    assert.equal(openLink(html, `?s=invite&from=${SAM}`), `thirtyanow://weekend?from=${SAM}`);
    assert.equal(openLink(html, '?s=invite'), 'thirtyanow://weekend');
    assert.equal(openLink(html, '?s=invite&from=abc'), 'thirtyanow://weekend');
    assert.equal(openLink(html, ''), 'thirtyanow://weekend');
  });

  it('says what to do with the invite, only on a page opened with one', () => {
    // An App Store install drops from=: someone who installs from here
    // opens a fresh app that knows nothing of the invite.
    assert.match(html, new RegExp(`<p class="invited" id="invited" hidden>${INVITED_LINE}</p>`));
    assert.match(INVITED_LINE, /come back to this link and tap Open in 30A Now/);
    assert.equal(invitedShown(html, `?s=invite&from=${SAM}`), true);
    assert.equal(invitedShown(html, `?s=invite&from=${SAM.toUpperCase()}`), true);
    assert.equal(invitedShown(html, '?s=invite'), false);
    assert.equal(invitedShown(html, '?s=invite&from=abc'), false);
    assert.equal(invitedShown(html, ''), false);
  });

  it('puts the inviter on the Smart App Banner’s OPEN, which Safari reads before the forwarder runs', () => {
    assert.equal(banner(html, `?s=invite&from=${SAM}`), `thirtyanow://weekend?from=${SAM}`);
    assert.equal(banner(html, `?s=invite&from=${SAM.toUpperCase()}`), `thirtyanow://weekend?from=${SAM}`);
    for (const bad of ['', '?s=invite', '?s=invite&from=abc', `?from=${SAM}0`, '?from=%22%3E%3Cscript%3E']) {
      assert.equal(banner(html, bad), 'thirtyanow://weekend', bad);
    }
    // Without JavaScript, the plain banner.
    assert.match(
      html,
      /<noscript><meta name="apple-itunes-app" content="app-id=6792965952, app-argument=thirtyanow:\/\/weekend"><\/noscript>/,
    );
    // Written once, in <head>, and never as a bare meta beside it.
    const head = html.slice(0, html.indexOf('</head>'));
    assert.equal(head.split('apple-itunes-app').length - 1, 2);
    assert.equal(html.indexOf('apple-itunes-app', html.indexOf('</head>')), -1);
  });

  it('keeps an argument that already has a query, and escapes what it writes', () => {
    const meta = bannerMeta('thirtyanow://venue/AJ%27s?x=1');
    const written = runBanner(meta, `?from=${SAM}`);
    assert.equal(written, `<meta name="apple-itunes-app" content="app-id=6792965952, app-argument=thirtyanow://venue/AJ%27s?x=1&amp;from=${SAM}">`);
    assert.doesNotMatch(bannerMeta('x"><script>alert(1)</script>'), /"><script>alert/);
  });
});

/** Runs a page's (or a meta's) banner script and answers what it wrote. */
function runBanner(html, search) {
  const js = /<script>(\(function\(\)\{var a=[\s\S]*?)<\/script>/.exec(html)[1];
  let written = '';
  new Function('location', 'document', 'URLSearchParams', js)(
    { search },
    { write: (s) => (written += s) },
    URLSearchParams,
  );
  return written;
}

/** The app-argument a page's banner script writes, as Safari reads it. */
function banner(html, search) {
  const arg = /app-argument=([^"]*)"/.exec(runBanner(html, search))[1];
  return arg.replace(/&amp;/g, '&');
}

/** Whether the forwarder unhides the invite line. */
function invitedShown(html, search) {
  const js = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
  const invited = { hidden: true };
  const env = {
    location: { search },
    navigator: { userAgent: 'node' },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'invited' ? invited : null),
      querySelectorAll: () => [],
    },
    URL,
    URLSearchParams,
    Date,
    setTimeout,
  };
  new Function(...Object.keys(env), js)(...Object.values(env));
  return !invited.hidden;
}

/**
 * What a share of these pages unfurls as. Until 25 Sep 2026 the lineup,
 * tonight and venue pages asked Facebook for the small "summary" card with
 * the 1024x1024 icon, so the Thursday post into groups of ~250K, 40K and
 * 36K members showed a square thumbnail instead of the full-width card,
 * although the 1200x630 og-default.png sat at the site root and was used
 * only by the posterless event stubs.
 */
describe('unfurl card', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venues = venuePages(rows, now);
  const LARGE = [
    /<meta property="og:image" content="https:\/\/30anow.github.io\/og-default.png">/,
    /<meta property="og:image:width" content="1200">/,
    /<meta property="og:image:height" content="630">/,
    /<meta name="twitter:card" content="summary_large_image">/,
  ];

  it('asks for the large branded card on every listing page and the posterless stub', () => {
    const pages = [
      renderLineup(rows, venues, now).html,
      renderTonight(rows, venues, now).html,
      renderVenue(venues[0], now).html,
      renderVenuesIndex(venues, now).html,
      renderStub(rows[0], { now }).html,
    ];
    for (const html of pages) {
      for (const meta of LARGE) assert.match(html, meta);
      assert.doesNotMatch(html, /og\.png/);
      assert.doesNotMatch(html, /twitter:card" content="summary"/);
    }
    assert.equal(OG_DEFAULT, 'https://30anow.github.io/og-default.png');
  });

  it('unfurls the weekly lineup as the branded card with its size, even when every show has a served poster', () => {
    // 24 Sep 2026: the first checked poster in time order was a Friday
    // 9:30 AM gig's month calendar, a 1080x1920 portrait flyer shared by
    // two rows, cropped to a strip on every invite and weekend share.
    const morning = row({ title: 'Steven Theriot', image_url: 'https://30a.com/september-live-music.jpg' });
    const flyer = row({ title: 'Dread Clampitt', image_url: 'https://30a.com/dread.png' });
    const served = new Map([
      ['https://30a.com/september-live-music.jpg', true],
      ['https://30a.com/dread.png', true],
    ]);
    const page = renderLineup([morning, flyer], venuePages([morning, flyer], now), now, served);
    for (const meta of LARGE) assert.match(page.html, meta);
    assert.doesNotMatch(page.html, /og:image" content="https:\/\/30a\.com/);
    // The posters still ride in the JSON-LD, where each belongs to its row.
    assert.match(page.jsonLd, /dread\.png/);
  });

  it('keeps the stub’s own poster as its card, without a size it cannot know', () => {
    const e = row({ image_url: 'https://30a.com/p.png' });
    const html = renderStub(e, { poster: e.image_url, now }).html;
    assert.match(html, /<meta property="og:image" content="https:\/\/30a.com\/p.png">/);
    assert.doesNotMatch(html, /og:image:width/);
  });

  it('names no date on the card of a page that turns over under one URL', () => {
    // Every Thursday post, weekend share and invite is /lineup/ under one
    // og:url. Facebook re-reads a card every 30 days and freezes its title
    // after 50 interactions, so from the second Thursday the card under
    // the post read "… Fri, Oct 2 – Sun, Oct 4" over the next weekend's.
    const og = (html) => ({
      title: /<meta property="og:title" content="([^"]*)">/.exec(html)[1],
      description: /<meta property="og:description" content="([^"]*)">/.exec(html)[1],
      url: /<meta property="og:url" content="([^"]*)">/.exec(html)[1],
      page: /<title>([^<]*)<\/title>/.exec(html)[1],
    });
    // A weekday, a month, a day of the month or a count of what is on.
    const day = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b\d{1,2}\b(?! PM)|\d+ (events?|classes)/;
    const dated = (s) => day.test(s);
    const thu1 = Date.parse('2026-10-01T17:00:00Z');
    const thu8 = Date.parse('2026-10-08T17:00:00Z');
    const weekend = [
      row({ title: 'Steven Theriot', starts_at: '2026-10-02T23:00:00Z', ends_at: '2026-10-03T02:00:00Z' }),
      row({ title: 'Emily Bass', starts_at: '2026-10-09T23:00:00Z', ends_at: '2026-10-10T02:00:00Z' }),
      row({ title: 'Wed Trivia', starts_at: '2026-10-01T23:00:00Z', ends_at: '2026-10-02T02:00:00Z' }),
      row({ title: 'Thu Trivia', starts_at: '2026-10-08T23:00:00Z', ends_at: '2026-10-09T02:00:00Z' }),
    ];
    for (const render of [renderLineup, renderTonight]) {
      const a = og(render(weekend, [], thu1).html);
      const b = og(render(weekend, [], thu8).html);
      assert.equal(a.url, b.url);
      assert.deepEqual([a.title, a.description], [b.title, b.description], 'the card is the same every week');
      assert.ok(!dated(a.title), a.title);
      assert.ok(!dated(a.description), a.description);
      // Search still gets the dated title, and it does move on.
      assert.notEqual(a.page, b.page);
      assert.ok(dated(a.page), a.page);
    }
    assert.equal(og(renderLineup(weekend, [], thu1).html).title, 'This weekend on 30A — live music, markets and events');
    assert.equal(og(renderTonight(weekend, [], thu1).html).title, 'Tonight on 30A — live music and events from 4 PM');
    // A venue page is one URL for good too; its "next up" is a date.
    const v = og(renderVenue(venues[0], now).html);
    assert.ok(!dated(v.description), v.description);
    assert.match(v.description, /The Red Bar \(Grayton Beach\)/);
  });
});

describe('owner footer', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venue = venuePages(rows, now)[0];
  const snippet =
    '<iframe src="https://30anow.github.io/embed/the-red-bar/" width="100%" height="420" style="border:0" title="This week at The Red Bar"></iframe>';

  it('hands the owner the strip snippet for this slug, the tagged advertise link and the mail fallback', () => {
    // The live Red Bar page on 24 Sep 2026 had the schedule, two App Store
    // buttons and nothing for the person most likely to read it to the
    // bottom: the one who runs the place.
    const html = renderVenue(venue, now).html;
    assert.match(html, /<strong>Run The Red Bar\?<\/strong> Put this week's lineup on your site, free/);
    assert.equal(embedSnippet('the-red-bar', 'The Red Bar'), snippet);
    assert.ok(html.includes(`<code id="snippet">${esc(snippet)}</code>`));
    assert.match(html, /<button type="button" id="copy">Copy<\/button>/);
    assert.match(
      html,
      /href="\/advertise\?business=The%20Red%20Bar&amp;s=seo-venue-owner">Feature a show — \$25, first one free</,
    );
    // The subject the app's own advertise form uses for its mail fallback.
    assert.match(
      html,
      new RegExp(`href="mailto:${SUPPORT_EMAIL}\\?subject=Advertising%20on%2030A%20Now%20%E2%80%94%20The%20Red%20Bar"`),
    );
    assert.equal(ARRIVAL.owner, 'seo-venue-owner');
  });

  it('writes the snippet as HTML an owner can paste, then escapes it once more to show it', () => {
    // The title attribute inside the snippet is HTML, so an ampersand in the
    // name is &amp; there; the page escapes the whole snippet a second time
    // so the browser shows the tag instead of rendering an iframe.
    assert.equal(
      embedSnippet('bud-alleys', "Bud & Alley's"),
      `<iframe src="https://30anow.github.io/embed/bud-alleys/" width="100%" height="420" style="border:0" title="This week at Bud &amp; Alley's"></iframe>`,
    );
    const html = ownerFooter({ name: "Bud & Alley's", slug: 'bud-alleys' });
    assert.match(html, /&lt;iframe src=&quot;https:\/\/30anow\.github\.io\/embed\/bud-alleys\/&quot;/);
    assert.match(html, /title=&quot;This week at Bud &amp;amp; Alley's&quot;/);
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /business=Bud%20%26%20Alley's&amp;s=seo-venue-owner/);
  });

  it('sits outside <main>, so the forwarder leaves its tag alone', () => {
    // Inside <main> a reader who arrived off the Thursday post would turn
    // the link into ?s=fb, and the one web signal that an owner came through
    // the block would be gone with it.
    const html = renderVenue(venue, now).html;
    const main = html.indexOf('</main>');
    const owner = html.indexOf('<section class="owner">');
    const footer = html.indexOf('<footer>');
    assert.ok(main > 0 && main < owner && owner < footer, `${main} ${owner} ${footer}`);
    assert.equal(/querySelectorAll\('([^']+)'\)/.exec(html)[1], 'header a[href^="/"],main a[href^="/"]');
    // And only the venue page carries it.
    assert.doesNotMatch(renderLineup(rows, [venue], now).html, /class="owner"/);
    assert.doesNotMatch(renderStub(rows[0], { now }).html, /class="owner"/);
  });

  it('every venue page has a strip under its own slug, so the snippet never points at a 404', () => {
    // venuePages needs three rows and embedVenues one; both order by how
    // much is on, so a slug a page takes is taken first among the strips
    // too — the -2 a collision hands out included. A town's page offers
    // no snippet and gets no strip, and taking it out does not move a slug.
    const town = [1, 2, 3, 4, 5].map((n) => row({ venue: 'Grayton Beach', title: `Market ${n}` }));
    const many = [
      ...town,
      ...rows,
      row({ venue: 'Crackings', title: 'A' }),
      row({ venue: 'Crackings', title: 'B' }),
      row({ venue: 'Crackings', title: 'C' }),
      row({ venue: 'CRACKINGS!', title: 'D' }),
      row({ venue: 'CRACKINGS!', title: 'E' }),
      row({ venue: 'CRACKINGS!', title: 'F' }),
      row({ venue: "Pickle's", title: 'one row' }),
      row({ venue: 'Now Playing', title: 'on stage', starts_at: '2026-09-08T16:00:00Z', ends_at: '2026-09-08T20:00:00Z' }),
    ];
    const pages = venuePages(many, now);
    const dirs = new Set(embedDirs(embedVenues(many, now)).map((d) => d.dir));
    assert.ok(pages.some((p) => p.slug === 'crackings-2'));
    assert.equal(pages[0].slug, 'grayton-beach');
    assert.ok(!dirs.has('grayton-beach'));
    for (const p of pages) {
      if (p.owner) assert.ok(dirs.has(p.slug), `${p.name} -> /embed/${p.slug}/`);
      else assert.doesNotMatch(renderVenue(p, now).html, /<iframe|class="owner"/, p.name);
    }
  });

  it('copies the snippet, by running the button', async () => {
    // navigator.clipboard where the page may use it, select-and-execCommand
    // where it may not; either way the text is the <code> beside the
    // button, so what is copied is what is shown.
    const js = /<script>\n([\s\S]*?)<\/script>/.exec(renderVenue(venue, now).html)[1];
    const press = (clipboard) => {
      const handlers = {};
      const button = { textContent: 'Copy', addEventListener: (ev, fn) => { handlers[ev] = fn; } };
      const selected = [];
      const env = {
        location: { search: '' },
        navigator: { userAgent: 'node', ...(clipboard ? { clipboard } : {}) },
        document: {
          hidden: false,
          getElementById: (id) => ({ copy: button, snippet: { textContent: snippet } })[id] ?? null,
          querySelectorAll: () => [],
          createRange: () => ({ selectNodeContents: (el) => selected.push(el.textContent) }),
          execCommand: (cmd) => cmd === 'copy',
        },
        getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
        URL,
        URLSearchParams,
        Date,
        setTimeout: () => {}, // the 2 s reset back to "Copy" is not the test
      };
      new Function(...Object.keys(env), js)(...Object.values(env));
      handlers.click();
      return { button, selected };
    };
    let copied = '';
    const modern = press({ writeText: (t) => { copied = t; return Promise.resolve(); } });
    await Promise.resolve();
    assert.equal(copied, snippet);
    assert.equal(modern.button.textContent, 'Copied');
    assert.deepEqual(modern.selected, []);
    const legacy = press(null);
    assert.deepEqual(legacy.selected, [snippet]);
    assert.equal(legacy.button.textContent, 'Copied');
  });
});

describe('embed strip', () => {
  const now = noonOn('2026-09-08');
  const soon = row({ title: 'Dread Clampitt' }); // Fri Sep 11
  const later = row({ title: 'Far Off', starts_at: '2026-10-20T23:00:00Z', ends_at: '2026-10-21T02:00:00Z' });
  const other = row({ title: 'Yoga', venue: 'Seaside Fitness Center', area: 'Seaside' });
  const venue = () => embedVenues([soon, later, other], now).find((v) => v.slug === 'the-red-bar');

  it('is a whole page with the rows in it — no bundle to download, nothing to go blank', () => {
    // /embed/The%20Red%20Bar answered HTTP 404 with the 26,940-byte SPA
    // shell (checked 9 Sep 2026) and only painted once a 3.0 MB bundle had
    // booted inside a partner's iframe. This file is the answer itself.
    const html = renderEmbed(venue(), now);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>This week at The Red Bar — 30A Now<\/title>/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /Dread Clampitt/);
    assert.ok(html.length < 20_000, `strip is ${html.length} bytes`);
    assert.doesNotMatch(html, /_expo|\.js"/); // no bundle, no external script
  });

  it('shows the next seven days and nothing beyond them', () => {
    const html = renderEmbed(venue(), now);
    assert.match(html, /Dread Clampitt/);
    assert.doesNotMatch(html, /Far Off/);
    assert.doesNotMatch(html, /Yoga/); // another venue's row
  });

  it('still shows the band that went on an hour ago', () => {
    // venuePages keeps only rows starting after `now` — right for a page of
    // upcoming events, wrong for a strip on the bar's homepage during the
    // set. The whole pipeline is tested, not embedWeek alone: the row was
    // dropped one step earlier than the window.
    const live = row({ title: 'On Now', starts_at: '2026-09-08T15:00:00Z', ends_at: '2026-09-08T21:00:00Z' });
    const only = embedVenues([live], now).find((v) => v.slug === 'the-red-bar');
    assert.ok(only, 'a venue with nothing but a show in progress still gets a strip');
    assert.match(renderEmbed(only, now), /On Now/);
    assert.match(renderEmbed(embedVenues([live, soon], now).find((v) => v.slug === 'the-red-bar'), now), /On Now/);
    // Over is over.
    const done = row({ title: 'Finished', starts_at: '2026-09-08T12:00:00Z', ends_at: '2026-09-08T14:00:00Z' });
    assert.equal(embedWeek([done, live, later], now).length, 1);
  });

  it('opens every link in a new tab, tagged with the venue', () => {
    const html = renderEmbed(venue(), now);
    assert.match(html, /<base target="_blank">/);
    assert.match(html, new RegExp(`href="/e/${soon.id}\\?ref=the-red-bar"`));
    assert.match(html, /id="pitch" href="\/\?ref=the-red-bar"/);
    // The ref must be the key embedRef() mints in the app, or the strip's
    // installs land in a bucket of their own.
    assert.equal(embedRef('Red Bar'), 'the-red-bar');
    assert.equal(embedRef("Stinky's Bait Shack"), 'stinkys-bait-shack');
    assert.equal(embedRef('  '), '');
  });

  it('says so honestly when the week is empty, instead of showing nothing', () => {
    const html = renderEmbed({ name: 'The Red Bar', area: '', events: [later], slug: 'the-red-bar' }, now);
    assert.match(html, /Nothing posted for the next seven days\./);
    assert.match(html, /This week at The Red Bar/);
  });

  it('leaves the scraped blurb and the aggregator link off a partner’s homepage', () => {
    const e = row({ description: 'Two sets.', url: 'https://www.sowal.com/e/1' });
    const html = renderEmbed({ name: 'The Red Bar', area: '', events: [e], slug: 'the-red-bar' }, now);
    assert.doesNotMatch(html, /sowal.com/);
    assert.doesNotMatch(html, /Two sets\./);
  });

  it('keeps a page for the strips already handed out, however quiet the week', () => {
    // docs/featured-shows.md gave partners /embed/<name>, so those URLs
    // cannot 404 in an off week.
    const names = embedVenues([], now).map((v) => v.name);
    for (const n of PUBLISHED_EMBEDS) assert.ok(names.includes(n), `${n} lost its strip`);
    // One strip per venue with anything at all ahead — a page needs three.
    assert.deepEqual(
      embedVenues([soon, other], now).map((v) => v.slug).sort(),
      ['old-florida-fish-house', 'red-fish-taco', 'seaside-fitness-center', 'stinkys-bait-shack', 'the-red-bar'],
    );
  });

  it('refuses a venue name that cannot safely be a directory', () => {
    assert.equal(embedNameDir('The Red Bar'), 'The Red Bar');
    assert.equal(embedNameDir("Stinky's Bait Shack"), "Stinky's Bait Shack");
    assert.equal(embedNameDir('Seaside’s Central Square'), 'Seaside’s Central Square');
    assert.equal(embedNameDir('Bud & Alley\'s'), "Bud & Alley's");
    // A "/" would write outside embed/; the rest make a tree Windows cannot
    // check out, which would take the whole site's deploy with it.
    assert.equal(embedNameDir('Cafe / Bar'), '');
    assert.equal(embedNameDir('..'), '');
    assert.equal(embedNameDir('Bar: The Sequel'), '');
    assert.equal(embedNameDir('What?'), '');
    assert.equal(embedNameDir('Trailing.'), '');
    assert.equal(embedNameDir('NUL'), '');
    assert.equal(embedNameDir(''), '');
  });

  it('writes both spellings, but never two paths that differ only in case', () => {
    // /embed/The%20Red%20Bar is the URL docs/featured-shows.md handed out.
    const dirs = embedDirs(embedVenues([soon, other], now)).map((d) => d.dir);
    assert.ok(dirs.includes('the-red-bar'));
    assert.ok(dirs.includes('The Red Bar'));
    // "Crackings" and "crackings" are two paths on the Linux box that builds
    // the site and one on the Windows machine that clones it: two git
    // entries over one file, and a tree that can never be clean.
    const one = [{ name: 'Crackings', slug: 'crackings' }];
    assert.deepEqual(embedDirs(one).map((d) => d.dir), ['crackings']);
    // Nor may one venue's name take another's slug.
    assert.deepEqual(
      embedDirs([
        { name: 'The Red Bar', slug: 'the-red-bar' },
        { name: 'THE-RED-BAR', slug: 'the-red-bar-2' },
      ]).map((d) => d.dir),
      ['the-red-bar', 'The Red Bar', 'the-red-bar-2'],
    );
  });

  it('escapes the venue name into its own beacon', () => {
    const html = renderEmbed(
      { name: 'x</script><script>alert(1)', area: '', events: [], slug: 'x' },
      now,
    );
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /embed_view/);
  });
});

/**
 * Every venue page's owner footer has handed out /embed/<slug>/ since
 * 25 Sep 2026, but a strip lived only while its venue had a row ahead: the
 * run after the last one ended deleted it, and a bar that had pasted the
 * snippet showed the 404 shell inside its own homepage, under "THIS WEEK AT
 * pickles-sandbar". Crackings lost its strip that way on 30 Sep.
 */
describe('handed-out strips', () => {
  const oct1 = Date.parse('2026-10-01T17:00:00Z');
  const pickles = (day) =>
    row({ venue: "Pickle's Sandbar", area: 'Seagrove', starts_at: `2026-10-${day}T21:00:00Z`, ends_at: `2026-10-${day}T23:00:00Z` });
  const fridays = [pickles('09'), pickles('16'), pickles('23')];
  const after = Date.parse('2026-10-24T11:00:00Z'); // Sat 6 AM, the last Friday set long over

  it('keeps a strip for a venue whose page handed one out, after its last row has ended', () => {
    const published = publishedStrips([], venuePages(fridays, oct1));
    assert.deepEqual(published, [{ slug: 'pickles-sandbar', name: "Pickle's Sandbar" }]);
    // What the old run did: nothing ahead, so no directory at all.
    assert.ok(!embedDirs(embedVenues(fridays, after)).some((d) => d.dir === 'pickles-sandbar'));
    const dirs = embedDirs(embedVenues(fridays, after, published));
    const strip = dirs.find((d) => d.dir === 'pickles-sandbar');
    assert.ok(strip, 'the slug the footer gave out still answers');
    assert.ok(dirs.some((d) => d.dir === "Pickle's Sandbar"), 'and so does the name');
    const html = renderEmbed(strip.venue, after);
    assert.match(html, /<h1>Pickle's Sandbar<\/h1>/);
    assert.match(html, /<p class="quiet">Nothing posted for the next seven days\.<\/p>/);
  });

  it('is the venue’s live strip when the slug it handed out now belongs to another spelling', () => {
    // A page under "Red Bar" handed out red-bar; the rows now come in as
    // "The Red Bar", whose strip is the-red-bar. red-bar is that strip too.
    const published = [{ slug: 'red-bar', name: 'Red Bar' }];
    const dirs = embedDirs(embedVenues([row({ title: 'Jazz Night' })], noonOn('2026-09-08'), published));
    const alias = dirs.find((d) => d.dir === 'red-bar');
    assert.equal(alias.venue.slug, 'the-red-bar');
    assert.match(renderEmbed(alias.venue, noonOn('2026-09-08')), /Jazz Night/);
  });

  it('keeps the list in embed/published.json: it only grows, by slug, sorted, and never with a placeholder', () => {
    const prev = [
      { slug: 'pickles-sandbar', name: "Pickle's Sandbar" },
      { slug: 'crackings', name: 'Crackings' },
      { slug: 'venues-along-30a', name: 'Venues along 30A' },
    ];
    const red = () => row({ starts_at: '2026-10-02T23:00:00Z', ends_at: '2026-10-03T02:00:00Z' });
    const pages = venuePages([red(), red(), red(), ...fridays], oct1);
    assert.deepEqual(publishedStrips(prev, pages), [
      { slug: 'crackings', name: 'Crackings' },
      { slug: 'pickles-sandbar', name: "Pickle's Sandbar" },
      { slug: 'the-red-bar', name: 'The Red Bar' },
    ]);
    // What the run writes is what the next run reads.
    const list = publishedStrips(prev, pages);
    assert.deepEqual(parsePublished(`${JSON.stringify(list, null, 2)}\n`), list);
  });

  it('reads the list back safely: a broken file stops the run, a bad entry never becomes a path', () => {
    assert.throws(() => parsePublished('{not json'));
    assert.throws(() => parsePublished('{"slug":"x","name":"X"}'), /not a list/);
    assert.deepEqual(
      parsePublished(JSON.stringify([
        { slug: '../../e', name: 'Escape' },
        { slug: 'Pickles Sandbar', name: 'Spaces' },
        { slug: 'ok-one', name: '  OK One  ' },
        { slug: 'no-name', name: '' },
        { slug: 'no-name-2' },
        null,
      ])),
      [{ slug: 'ok-one', name: 'OK One' }],
    );
  });

  it('starts the list, the first time, from the strips already on the site', () => {
    const red = renderEmbed({ name: "Bud & Alley's", area: '', events: [], slug: 'bud-alleys' }, oct1);
    const seeded = seedPublished([
      { dir: 'bud-alleys', html: red },
      { dir: "Bud & Alley's", html: red }, // the name spelling of the same strip
      { dir: 'empty', html: '' },
    ]);
    assert.deepEqual(seeded, [
      { slug: 'bud-alleys', name: "Bud & Alley's" },
      // Handed out by its page from 25 to 28 Sep, deleted with its strip on 30 Sep.
      { slug: 'crackings', name: 'Crackings' },
    ]);
    // Once only, whatever is already on the site.
    assert.equal(seedPublished([{ dir: 'crackings', html: '<h1>Crackings</h1>' }]).length, 1);
  });

  it('starts it from git history too, so a strip the old run deleted before this one landed still counts', () => {
    // The old generator runs until this one replaces it. Pickle's Sandbar's
    // last set ends Fri 23 Oct, the old run deletes embed/pickles-sandbar/
    // on the Saturday, this one first runs on the Sunday: the strips on the
    // site no longer have it, the venue pages in history do.
    const [a, b] = ['a'.repeat(40), 'b'.repeat(40)];
    const log = [
      `commit ${a}`, '', 'venues/the-red-bar/index.html', 'venues/pickles-sandbar/index.html', '',
      `commit ${b}`, '', 'venues/index.html', 'venues/pickles-sandbar/index.html', 'venues/crackings/index.html',
      'venues/Not A Slug/index.html', 'venues/crackings/extra.html', '',
    ].join('\n');
    const lost = lostFooterPages(log, ['the-red-bar', 'The Red Bar']);
    // Each at the newest commit that wrote it; the strips still up are not lost.
    assert.deepEqual(lost, [{ slug: 'pickles-sandbar', at: a }, { slug: 'crackings', at: b }]);
    assert.deepEqual(lostFooterPages(log.replace(/\n/g, '\r\n'), ['the-red-bar']), lost);
    assert.deepEqual(lostFooterPages('', []), []);

    // The page as it last stood names the venue in its <h1>, like a strip.
    const page = renderVenue(venuePages(fridays, oct1)[0], oct1).html;
    const red = renderEmbed({ name: 'The Red Bar', area: '', events: [], slug: 'the-red-bar' }, oct1);
    const seeded = seedPublished([{ dir: 'the-red-bar', html: red }], [
      { dir: 'pickles-sandbar', html: page },
      { dir: 'the-red-bar', html: '<h1>Not This One</h1>' }, // the strip on the site wins
    ]);
    assert.deepEqual(seeded, [
      { slug: 'the-red-bar', name: 'The Red Bar' },
      { slug: 'pickles-sandbar', name: "Pickle's Sandbar" },
      { slug: 'crackings', name: 'Crackings' },
    ]);
    const strip = embedDirs(embedVenues(fridays, after, publishedStrips(seeded, []))).find((d) => d.dir === 'pickles-sandbar');
    assert.ok(strip, 'the slug its footer gave out answers again');
    assert.match(renderEmbed(strip.venue, after), /<h1>Pickle's Sandbar<\/h1>/);
  });

  it('reads that history from the commit that shipped the footer on, itself included', () => {
    assert.equal(FOOTER_SHIPPED, '106958c86c0043a8aea7823afc3a6842b878d9af');
    assert.ok(FOOTER_LOG_ARGS.includes(`${FOOTER_SHIPPED}^..HEAD`));
    assert.ok(FOOTER_LOG_ARGS.includes('--format=commit %H'));
    assert.deepEqual(FOOTER_LOG_ARGS.slice(-2), ['--', 'venues/']);
  });

  it('fetches that history only for the run that starts the list', () => {
    const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
    const steps = yml.split(/\r?\n/);
    const fetch = steps.findIndex((l) => /git fetch --unshallow origin/.test(l));
    assert.ok(fetch > 0, 'no history fetch');
    assert.match(steps[fetch - 1], /if: hashFiles\('embed\/published\.json'\) == ''/);
    assert.ok(fetch < steps.findIndex((l) => /run: node scripts\/share-cards\.mjs/.test(l)), 'after the generator');
  });
});

/**
 * Runs a page's EXPIRE in a fake DOM at `now`: the rows, the day sections
 * and fitness <details> that hold them, and #done, read out of the HTML
 * the way a browser would build them. Answers which rows are still shown,
 * how many boxes were hidden, and whether #done is showing.
 */
function expireAt(html, now) {
  const js = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('li.ev[data-end]'));
  const rows = [...html.matchAll(/<li class="ev" id="([^"]+)"(?: data-end="(\d+)")?>/g)].map((m) => ({
    id: m[1],
    at: m.index,
    hidden: false,
    getAttribute: (name) => (name === 'data-end' ? m[2] ?? null : null),
  }));
  const boxes = [];
  for (const tag of ['section', 'details']) {
    for (const m of html.matchAll(new RegExp(`<${tag}[ >]`, 'g'))) {
      const end = html.indexOf(`</${tag}>`, m.index);
      const inside = rows.filter((r) => r.at > m.index && r.at < end);
      boxes.push({ hidden: false, querySelectorAll: () => inside });
    }
  }
  const d = /<p class="[^"]*" id="done"(?: data-day="([^"]*)")? hidden>/.exec(html);
  const done = d ? { hidden: true, getAttribute: (name) => (name === 'data-day' ? d[1] ?? null : null) } : null;
  let ticking = null;
  const env = {
    location: { search: '' },
    navigator: { userAgent: 'node' },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'done' ? done : null),
      querySelectorAll: (sel) =>
        sel === 'li.ev[data-end]' ? rows.filter((r) => r.getAttribute('data-end')) : sel === 'section,details' ? boxes : [],
    },
    URL,
    URLSearchParams,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout,
    setInterval: (fn) => {
      ticking = fn;
    },
  };
  new Function(...Object.keys(env), js)(...Object.values(env));
  return {
    shown: rows.filter((r) => !r.hidden).map((r) => r.id),
    hiddenBoxes: boxes.filter((b) => b.hidden).length,
    done: done ? !done.hidden : null,
    ticking: Boolean(ticking),
  };
}

/**
 * The 05:10 UTC run meant to turn /tonight/ over at beach midnight never
 * started before 09:13 UTC (10-30 Sep 2026, every night), so until dawn the
 * page read "Tonight on 30A — Wednesday" over shows that had ended hours
 * before, and every strip led with the previous night's finished sets.
 * The page now knows when each row ends and tidies itself in the browser.
 */
describe('finished rows', () => {
  const now = noonOn('2026-09-08'); // Tue noon
  const seven = row({ title: 'Seven O’Clock Set', starts_at: '2026-09-09T00:00:00Z', ends_at: '2026-09-09T02:00:00Z' }); // Tue 7-9 PM
  const late = row({ title: 'Late Set', starts_at: '2026-09-09T03:00:00Z', ends_at: '2026-09-09T05:30:00Z' }); // Tue 10 PM-12:30 AM
  const gym = row({ category: 'fitness', title: 'Night Yoga', starts_at: '2026-09-08T23:00:00Z', ends_at: '2026-09-09T00:00:00Z' }); // Tue 6-7 PM
  const tonight = renderTonight([seven, late, gym], [], now).html;

  it('writes each row’s end on the row, and the night the page covers on its done line', () => {
    assert.match(rowHtml(seven), new RegExp(`<li class="ev" id="e-${seven.id}" data-end="${Date.parse(seven.ends_at)}">`));
    assert.match(
      tonight,
      /<p class="done" id="done" data-day="2026-09-08" hidden>Everything listed for Tuesday, Sep 8 has finished\. <a href="\/feed\?s=seo-tonight">See what's on now, live in the app<\/a><\/p>/,
    );
    const lineup = renderLineup([row()], [], now).html;
    assert.match(lineup, /id="done" data-day="2026-09-13" hidden>Everything listed for Fri, Sep 11 – Sun, Sep 13 has finished\. <a href="\/weekend\?s=seo-lineup">/);
  });

  it('shows everything before it ends, and keeps watching', () => {
    const r = expireAt(tonight, now);
    assert.deepEqual(r.shown.length, 3);
    assert.equal(r.done, false);
    assert.equal(r.ticking, true);
  });

  it('hides each row once it is over, then the box it was in', () => {
    const r = expireAt(tonight, beachWallToUtc('2026-09-08', 21, 30)); // Tue 9:30 PM
    assert.deepEqual(r.shown, [`e-${late.id}`]);
    assert.equal(r.hiddenBoxes, 1); // the yoga's <details>; the day still has the late set
    assert.equal(r.done, false);
  });

  it('says the night is over once everything on it has ended', () => {
    const r = expireAt(tonight, beachWallToUtc('2026-09-09', 1)); // Wed 1 AM, the late set over
    assert.deepEqual(r.shown, []);
    assert.equal(r.done, true);
    assert.equal(r.hiddenBoxes, 2); // the day's <section> and the <details> in it
  });

  it('keeps quiet past beach midnight while a set that crosses it is still playing', () => {
    // Until review on 1 Oct 2026 the day being over was enough on its own,
    // so at 12:10 AM the page said "Everything listed for Tuesday, Sep 8
    // has finished" above the late set it was still showing.
    const r = expireAt(tonight, beachWallToUtc('2026-09-09', 0, 10)); // Wed 12:10 AM
    assert.deepEqual(r.shown, [`e-${late.id}`]);
    assert.equal(r.done, false);
    assert.equal(expireAt(tonight, beachWallToUtc('2026-09-09', 0, 31)).done, true); // the set over
    // /lineup/ the same, on Sunday night into Monday.
    const sunday = row({ title: 'Sunday Late Set', starts_at: '2026-09-14T03:00:00Z', ends_at: '2026-09-14T05:30:00Z' }); // Sun 10 PM-12:30 AM
    const lineup = renderLineup([sunday], [], now).html;
    const mon = expireAt(lineup, beachWallToUtc('2026-09-14', 0, 10)); // Mon 12:10 AM
    assert.deepEqual(mon.shown, [`e-${sunday.id}`]);
    assert.equal(mon.done, false);
    assert.equal(expireAt(lineup, beachWallToUtc('2026-09-14', 0, 31)).done, true);
  });

  it('says so after beach midnight even on a quiet night, by the beach clock and not the reader’s', () => {
    const quiet = renderTonight([], [], now).html;
    // 11:30 PM at the beach is 12:30 AM in Atlanta and 04:30 UTC: still Tuesday here.
    assert.equal(expireAt(quiet, beachWallToUtc('2026-09-08', 23, 30)).done, false);
    assert.equal(expireAt(quiet, beachWallToUtc('2026-09-09', 0, 30)).done, true);
    // Nothing to watch, so no timer.
    assert.equal(expireAt(quiet, now).ticking, false);
  });

  it('leaves a page that rolled forward alone until its own night is over', () => {
    // The 23:10 winter run describes tomorrow night.
    const page = renderTonight(
      [row({ starts_at: '2026-01-16T01:00:00Z', ends_at: '2026-01-16T04:00:00Z' })], // Thu 7-10 PM CST
      [],
      beachWallToUtc('2026-01-14', 23, 10),
    ).html;
    assert.match(page, /data-day="2026-01-15"/);
    assert.equal(expireAt(page, beachWallToUtc('2026-01-14', 23, 50)).done, false);
    assert.equal(expireAt(page, beachWallToUtc('2026-01-15', 9)).done, false);
  });

  it('takes last night’s finished sets off a partner’s strip, and says so when nothing is left', () => {
    const v = { name: 'The Red Bar', area: 'Grayton Beach', events: [seven, late, row()], slug: 'the-red-bar' };
    const html = renderEmbed(v, now);
    assert.match(html, /<section><h2>Tuesday, Sep 8<\/h2><ul class="rows">/);
    assert.match(html, /<p class="quiet" id="done" hidden>Nothing posted for the next seven days\.<\/p>/);
    const wed = expireAt(html, beachWallToUtc('2026-09-09', 2)); // Wed 2 AM
    assert.deepEqual(wed.shown, [`e-${v.events[2].id}`]); // Friday's
    assert.equal(wed.hiddenBoxes, 1);
    assert.equal(wed.done, false);
    assert.equal(expireAt(html, Date.parse('2026-09-12T03:00:00Z')).done, true);
    // A strip with nothing on shows the line as written, and carries no script for it.
    const empty = renderEmbed({ name: 'The Red Bar', area: '', events: [], slug: 'the-red-bar' }, now);
    assert.match(empty, /<p class="quiet">Nothing posted for the next seven days\.<\/p>/);
    assert.doesNotMatch(empty, /li\.ev\[data-end\]/);
  });

  it('hides by the row, never the whole page, on a venue page', () => {
    const v = venuePages([seven, late, row()], now)[0];
    const r = expireAt(renderVenue(v, now).html, beachWallToUtc('2026-09-09', 2));
    assert.equal(r.shown.length, 1);
    assert.equal(r.done, false); // Friday's still to come
    assert.equal(r.hiddenBoxes, 1); // Tuesday's section, not the owner block or "Also"
  });

  it('says so on a venue page once every set on it is over, instead of going blank', () => {
    // Until review on 1 Oct 2026 a venue page had no done line, so one
    // written at the three-row floor with all three sets on one evening hid
    // every row and day by 1 AM and showed nothing under "3 upcoming events".
    const set = (h) => row({ venue: "Pickle's Sandbar", area: 'Seagrove', starts_at: new Date(beachWallToUtc('2026-10-01', h)).toISOString(), ends_at: new Date(beachWallToUtc('2026-10-01', h + 2)).toISOString() });
    const thu = beachWallToUtc('2026-10-01', 15, 30); // Thu 3:30 PM, the late 17:20 UTC run
    const v = venuePages([set(16), set(18), set(20)], thu)[0];
    const html = renderVenue(v, thu).html;
    assert.match(html, /3 upcoming events · updated Thu, Oct 1, 3:30 PM beach time/);
    assert.match(
      html,
      /<p class="done" id="done" hidden>Everything listed for Pickle's Sandbar has finished\. <a href="\/venue\/Pickle's%20Sandbar\?s=seo-venue">See Pickle's Sandbar live in the app<\/a><\/p>/,
    );
    const eight = expireAt(html, beachWallToUtc('2026-10-01', 21)); // the 8 PM set still on
    assert.equal(eight.shown.length, 1);
    assert.equal(eight.done, false);
    const r = expireAt(html, beachWallToUtc('2026-10-02', 1)); // Fri 1 AM
    assert.deepEqual(r.shown, []);
    assert.equal(r.done, true);
    assert.equal(r.hiddenBoxes, 1); // Thursday's section
  });
});

/**
 * The workflow's crons, as minutes past midnight UTC. Until 1 Oct 2026
 * nothing followed the 20:13 import, and the one run meant for beach
 * midnight (05:10) was started 4 to 6.5 hours late every night from 10 to
 * 30 Sep, so /tonight/ read yesterday until 4-6:40 AM.
 */
describe('the schedule', () => {
  const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
  const runs = [...yml.matchAll(/- cron: '(\d+) ([\d,]+) \* \* \*'/g)].flatMap(([, m, hours]) =>
    hours.split(',').map((h) => Number(h) * 60 + Number(m)),
  );

  it('follows each of the app repo’s imports, the evening one included', () => {
    for (const [h, m] of [[10, 13], [17, 13], [20, 13]]) {
      const at = h * 60 + m;
      assert.ok(runs.some((r) => r > at && r - at <= 30), `nothing within 30 min of the ${h}:${m} import`);
    }
  });

  it('turns /tonight/ over in the beach night whether GitHub starts it on time or hours late', () => {
    // 11 PM to 5 AM CDT, when tonightWindow already means the new night.
    const night = (min) => {
      const t = ((min % 1440) + 1440) % 1440;
      return t >= 4 * 60 && t < 10 * 60;
    };
    const late = [2, 4, 6.5].map((h) => h * 60); // what the :13 and 05:10 crons were
    assert.ok(runs.some((r) => late.every((l) => night(r + l))), runs.join(', '));
  });

  it('queues a late run behind the one still going', () => {
    assert.match(yml, /concurrency:\r?\n  group: share-cards\r?\n  cancel-in-progress: false/);
  });

  it('also starts when the app repo’s import has written, and only for that', () => {
    // 18 Oct 2026: the 10:20 run fetched at 14:02:45, a minute and a half
    // into the 10:13 import GitHub had started at 14:01:15, before its
    // upsert. The import now asks for a run once it has written; the app
    // repo's tests/pagesRefresh.test.mjs holds the type it sends.
    assert.match(yml, /\non:\r?\n(?:  #[^\n]*\n)*  repository_dispatch:\r?\n    types: \[events-imported\]\r?\n  schedule:\r?\n/);
    assert.equal(yml.match(/repository_dispatch:/g).length, 1);
    // The crons stay as the fallback, and so does the hand run.
    assert.equal(runs.length, 5);
    assert.match(yml, /\n  workflow_dispatch:\r?\n    inputs:\r?\n      allow_shrink:/);
  });

  it('a dispatched run cannot publish a collapsed fetch', () => {
    // It has no inputs, so the flag is the empty string, and only the exact
    // 'true' of a hand run's checkbox clears the refusal.
    assert.match(yml, /\n          ALLOW_SHRINK: \$\{\{ inputs\.allow_shrink \}\}\r?\n/);
    const src = readFileSync(new URL('./share-cards.mjs', import.meta.url), 'utf8');
    assert.equal(src.match(/process\.env\.ALLOW_SHRINK/g).length, 1);
    assert.match(src, /process\.env\.ALLOW_SHRINK === 'true'/);
  });
});

describe('sitemap and robots', () => {
  const now = noonOn('2026-09-08');
  it('lists the pages, every venue and every stub', () => {
    const rows = [row(), row(), row()];
    const venues = venuePages(rows, now);
    const xml = sitemapXml(rows, venues, now);
    assert.match(xml, /<loc>https:\/\/30anow.github.io\/lineup\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/30anow.github.io\/tonight\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/30anow.github.io\/venues\/the-red-bar\/<\/loc>/);
    for (const r of rows) assert.match(xml, new RegExp(`<loc>https://30anow.github.io/e/${r.id}</loc>`));
    // The four listing pages, the acts index and the towns index, the
    // venue, the stubs. No town page: none was passed.
    assert.match(xml, /<loc>https:\/\/30anow.github.io\/acts\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/30anow.github.io\/towns\/<\/loc>/);
    assert.equal((xml.match(/<url>/g) || []).length, 6 + 1 + 3);
    assert.match(xml, /<lastmod>2026-09-08T17:00:00.000Z<\/lastmod>/);
  });
  it('lists every act page after the venues and before the stubs', () => {
    const rows = [
      row({ title: 'Jared Herzog' }),
      row({ title: 'Jared Herzog', venue: 'Crackings' }),
      row({ title: 'MECO', venue: "Stinky's Bait Shack" }),
    ];
    const acts = actPages(rows, now);
    assert.deepEqual(acts.map((a) => a.slug), ['jared-herzog']);
    const xml = sitemapXml(rows, [], now, acts);
    const at = (s) => xml.indexOf(s);
    assert.ok(at('/acts/</loc>') > at('/venues/</loc>'));
    assert.ok(at('/acts/jared-herzog/</loc>') > at('/acts/</loc>'));
    assert.ok(at(`/e/${rows[0].id}</loc>`) > at('/acts/jared-herzog/</loc>'));
    assert.doesNotMatch(xml, /\/acts\/meco\//);
  });
  it('points crawlers at the sitemap and away from account screens', () => {
    const txt = robotsTxt();
    assert.match(txt, /^User-agent: \*\nAllow: \/\n/);
    assert.match(txt, /Disallow: \/admin\n/);
    assert.match(txt, /Sitemap: https:\/\/30anow.github.io\/sitemap.xml\n$/);
  });
  it('leaves the JS bundle crawlable', () => {
    // Every page here that is not generated is a client-rendered shell, "/"
    // included — and "/" is the first URL in sitemap.xml and the App Store
    // marketing URL. Blocking _expo/ leaves Googlebot the unhydrated shell.
    assert.doesNotMatch(robotsTxt(), /_expo/);
  });
});

// ---------------------------------------------------------------------------
// Acts (6 Oct 2026)
// ---------------------------------------------------------------------------

/**
 * The act behind a title (actKey.mjs), pinned to the spellings the sources
 * actually write. Everything is read from scripts/act-titles.json: the
 * table of titles and the key each must get, and one week of rows read at
 * three moments. The app repo holds the same file as
 * tests/fixtures/act-titles.json and runs it through its own copy of the
 * rules (tests/actKey.test.ts, tests/actPage.test.ts there): the app's act
 * page and these /acts/<slug>/ pages must name the same act, under the
 * same name, at the same path, for every row - or a band's share link
 * opens a page about someone else, or none. Both tests pin the file's
 * hash, so neither copy changes alone. A row marked `synthetic` pins a
 * rule the scrape it was copied from (24 Sep 2026) held no example of.
 */
const ACT_FIXTURE_TEXT = readFileSync(new URL('./act-titles.json', import.meta.url), 'utf8');
const ACT_FIXTURE = JSON.parse(ACT_FIXTURE_TEXT);
const ACT_TABLE = ACT_FIXTURE.table;
// The hash of the fixture as parsed, so a checkout's line endings do not
// count. The same line is in the app repo's tests/actKey.test.ts.
const ACT_FIXTURE_SHA256 = 'eb4e4c71a7971f40fb0765ac33326d4069261ed27ea112a98d3ecda9a30c932a';

describe('actKey: the same act the app names', () => {
  it('reads the fixture the app repo pins too, by its hash', () => {
    const sha = createHash('sha256').update(JSON.stringify(JSON.parse(ACT_FIXTURE_TEXT))).digest('hex');
    assert.equal(sha, ACT_FIXTURE_SHA256);
  });
  it('keys every row of the table as the app does', () => {
    assert.ok(ACT_TABLE.filter((t) => !t.synthetic).length >= 30);
    for (const t of ACT_TABLE) {
      assert.equal(actKey({ title: t.title, venue: t.venue, category: t.category }), t.key, t.title);
    }
    // The further listings of that scrape: a row that is not music founds
    // no act, though it may be a show of one (the describe after next).
    const notMusic = ACT_FIXTURE.listings.filter((e) => e.category !== 'music');
    assert.ok(notMusic.length >= 30);
    for (const e of notMusic) assert.equal(actKey(e), null, e.title);
  });
  it('gives a night that is no one’s show no key, and so no page', () => {
    // The importer files an open mic under music: two bars' "Open Mic" rows
    // were one act, with a page here whose performer was Open Mic.
    for (const title of ['Open Mic', 'Open Mic with Jared Herzog', 'Open-Mic Thursdays', 'Happy Hour', 'Happy Hour with Jared Herzog', 'Jam Session', 'Sunday Funday', 'Karaoke with DJ Dan', 'Bingo & Beats', 'Trivia']) {
      assert.equal(actKey({ title, category: 'music' }), null, title);
    }
    for (const title of ['Live Band', 'DJ Set', 'Live DJ Set', 'TBA', 'TBD', 'Band TBA', 'Special Guest', 'Guest DJ', 'Resident DJ', 'Local Artist Showcase']) {
      assert.equal(actKey({ title, category: 'music' }), null, title);
    }
    // The phrase and not its words; no genre word is a kind word.
    assert.equal(actKey({ title: 'Mic Drop', category: 'music' }), 'mic drop');
    assert.equal(actKey({ title: 'Jam Therapy', category: 'music' }), 'jam therapy');
    assert.equal(actKey({ title: 'Happy Jack', category: 'music' }), 'happy jack');
    assert.equal(actKey({ title: 'The Guest List', category: 'music' }), 'guest list');
    assert.equal(actKey({ title: 'The Red Bar Jazz Band', venue: 'The Red Bar', category: 'music' }), 'red bar jazz');
    const now = noonOn('2026-09-08');
    const mics = [
      row({ title: 'Open Mic', venue: 'Crackings' }),
      row({ title: 'Open Mic', venue: "Pickle's Sandbar", starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
      row({ title: 'Happy Hour', venue: 'Crackings' }),
      row({ title: 'Happy Hour', venue: 'Crackings', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    ];
    assert.deepEqual(actPages(mics, now), []);
    assert.doesNotMatch(sitemapXml(mics, [], now, actPages(mics, now)), /\/acts\/[a-z]/);
  });
  it('makes the key the page’s address: a to z and digits, its slug the key with dashes, one per act', () => {
    const keys = [...new Set(ACT_TABLE.map((t) => t.key).filter((k) => k !== null))];
    assert.ok(keys.length >= 20);
    for (const key of keys) {
      assert.match(key, /^[a-z0-9]+(?: [a-z0-9]+)*$/);
      assert.equal(actSlug(key), key.split(' ').join('-'));
      // Read back as a title, as the app reads a slug it does not hold.
      assert.equal(actKey({ title: actSlug(key), category: 'music' }), key);
    }
    assert.equal(new Set(keys.map(actSlug)).size, keys.length);
    // A sign a source hangs on a title is not a second act, and a name
    // with no a to z in it has no path, so it is no act.
    assert.equal(actKey({ title: 'Jared Herzog ♫', category: 'music' }), 'jared herzog');
    assert.equal(actKey({ title: '🎸 Jared Herzog 🎸', category: 'music' }), 'jared herzog');
    assert.equal(actKey({ title: 'Жар-птица', category: 'music' }), null);
    assert.equal(actKey({ title: 'Beyoncé Tribute Experience', category: 'music' }), 'beyonce tribute experience');
  });
  it('never splits a bill, and keys a row the same with or without its venue', () => {
    for (const title of ['Bill Garrett + John Reinlie', 'Bill Garrett & John Reinlie', 'Bill Garrett and John Reinlie']) {
      assert.equal(actKey({ title, category: 'music' }), 'bill garrett and john reinlie');
    }
    for (const t of ACT_TABLE) {
      if (t.key !== null) assert.equal(actKey({ title: t.title, category: 'music' }), t.key, t.title);
    }
    assert.equal(actKey({ title: 'Jared Herzog', category: 'nightlife' }), null);
  });
  it('shows the most frequent spelling with the framing taken off, and slugs text as the app does', () => {
    const now = noonOn('2026-09-08');
    const rows = [
      row({ title: 'Sunday Funday with Will Thompson Band', starts_at: '2026-09-11T23:00:00Z' }),
      row({ title: 'Sunday Funday with Will Thompson', starts_at: '2026-09-10T23:00:00Z', ends_at: '2026-09-11T02:00:00Z' }),
      row({ title: 'Sunday Funday with Will Thompson Band', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    ];
    assert.equal(actLabel(rows, 'will thompson', now), 'Will Thompson Band');
    // A tie goes to the soonest row.
    assert.equal(actLabel(rows.slice(0, 2), 'will thompson', now), 'Will Thompson');
    assert.equal(actLabel(rows, 'nobody', now), '');
    // Only what has not ended is counted, as in the app, which holds rows
    // two days back: by Friday noon Thursday's spelling is over, and by
    // Saturday noon two of the three are - the one left names the act. With
    // nothing ahead the rows in hand are counted.
    assert.equal(actLabel(rows.slice(0, 2), 'will thompson', noonOn('2026-09-11')), 'Will Thompson Band');
    assert.equal(actLabel(rows, 'will thompson', noonOn('2026-09-12')), 'Will Thompson Band');
    assert.equal(actLabel(rows.slice(1, 2), 'will thompson', noonOn('2026-09-12')), 'Will Thompson');
    assert.equal(actLabel(rows, 'will thompson', noonOn('2026-09-20')), 'Will Thompson Band');
    assert.equal(shownTitle('Alex Napier-Main Stage'), 'Alex Napier');
    assert.equal(actSlug('Dion Jones & The Neon Tears'), 'dion-jones-the-neon-tears');
    assert.equal(actSlug("Dwayne O'Brien"), 'dwayne-obrien');
    assert.equal(actSlug('Café Thirty-A Trio'), 'cafe-thirty-a-trio');
    assert.equal(actSlug('…'), '');
  });
});

describe('actPages', () => {
  const now = noonOn('2026-09-08');
  const rows = [
    row({ title: 'Jared Herzog', venue: "Pickle's Sandbar" }),
    row({ title: 'Live Music with Jared Herzog', venue: 'Crackings', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    row({ title: 'Jared Herzog', venue: 'Crackings', starts_at: '2026-09-13T23:00:00Z', ends_at: '2026-09-14T02:00:00Z' }),
    row({ title: 'Dion Jones & The Neon Tears', venue: "AJ's Grayton Beach" }),
    row({ title: 'Dion Jones and The Neon Tears', venue: "Stinky's Bait Shack", starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    row({ title: 'MECO', venue: "Stinky's Bait Shack" }),
    row({ title: 'Live Music', venue: 'Fish Out of Water' }),
    row({ title: 'Live Music', venue: 'Fish Out of Water', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    row({ title: 'Alex Napier-Main Stage', venue: 'Old Florida Fish House', starts_at: '2026-09-01T23:00:00Z', ends_at: '2026-09-02T02:00:00Z' }),
    row({ title: 'Alex Napier', venue: 'Old Florida Fish House', starts_at: '2026-09-07T23:00:00Z', ends_at: '2026-09-08T02:00:00Z' }),
  ];

  it('needs two rows still on or ahead, under every spelling, and skips what names no act', () => {
    assert.equal(ACT_PAGE_MIN, 2);
    const pages = actPages(rows, now);
    // The path is the act's key with dashes, whichever spelling is shown.
    assert.deepEqual(pages.map((p) => p.slug), ['dion-jones-and-neon-tears', 'jared-herzog']);
    assert.equal(pages[0].label, 'Dion Jones & The Neon Tears');
    const jared = pages.find((p) => p.slug === 'jared-herzog');
    assert.equal(jared.label, 'Jared Herzog');
    assert.equal(jared.events.length, 3);
    assert.equal(jared.venues, 2);
    assert.deepEqual(jared.events.map((e) => e.venue), ["Pickle's Sandbar", 'Crackings', 'Crackings']);
    // MECO has one row, Live Music is no act, Alex Napier's two have ended.
    assert.ok(!pages.some((p) => /meco|live-music|alex/.test(p.slug)));
  });

  it('keeps a row that is on now and drops one that has ended', () => {
    const on = row({ title: 'MECO', venue: "Stinky's Bait Shack", starts_at: '2026-09-08T16:00:00Z', ends_at: '2026-09-08T18:00:00Z' });
    const over = row({ title: 'MECO', venue: 'Crackings', starts_at: '2026-09-08T13:00:00Z', ends_at: '2026-09-08T15:00:00Z' });
    assert.deepEqual(actPages([rows[5], on, over], now).map((p) => p.slug), ['meco']);
    assert.deepEqual(actPages([rows[5], over], now), []);
  });

  it('is alphabetical by the spelling shown, and gives every act a path of its own that no spelling moves', () => {
    // "Dion Jones & Neon Tears" is the band the two spellings above name
    // (the key reads & as "and"), and with two more rows it is the most
    // frequent spelling, so the name shown is its - and the path is where
    // it was, under the key. A band called "Dion Jones Neon Tears" is a
    // different key and so a different path; when the path was the slug of
    // the name, which drops the &, the two collided and one got -2.
    // Punctuation in a title is a space to the key, so "Jared-Herzog!" is
    // Jared Herzog, not a page of its own.
    const many = [
      ...rows,
      row({ title: 'Zack Miller', venue: "Pickle's Sandbar" }),
      row({ title: 'Zack Miller', venue: 'Crackings' }),
      row({ title: 'Jared-Herzog!', venue: 'The Red Bar' }),
      row({ title: 'Dion Jones & Neon Tears', venue: 'Red Fish Taco' }),
      row({ title: 'Dion Jones & Neon Tears', venue: 'Red Fish Taco', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
      row({ title: 'Dion Jones Neon Tears', venue: 'The Red Bar' }),
      row({ title: 'Dion Jones Neon Tears', venue: 'The Red Bar', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
      row({ title: 'aj moss', venue: 'The Red Bar' }),
      row({ title: 'aj moss', venue: 'The Red Bar', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    ];
    const pages = actPages(many, now);
    assert.deepEqual(
      pages.map((p) => p.label),
      ['aj moss', 'Dion Jones & Neon Tears', 'Dion Jones Neon Tears', 'Jared Herzog', 'Zack Miller'],
    );
    assert.deepEqual(
      pages.map((p) => p.slug),
      ['aj-moss', 'dion-jones-and-neon-tears', 'dion-jones-neon-tears', 'jared-herzog', 'zack-miller'],
    );
    assert.equal(new Set(pages.map((p) => p.slug)).size, pages.length);
    for (const p of pages) assert.equal(p.slug, p.key.split(' ').join('-'));
    assert.equal(pages.find((p) => p.slug === 'jared-herzog').events.length, 4);
    // The same path as before the two extra rows changed the name shown.
    assert.equal(actPages(rows, now).find((p) => p.key === 'dion jones and neon tears').slug, 'dion-jones-and-neon-tears');
  });

  it('counts a bar once however a source spells it, as the app does', () => {
    const pair = [
      row({ title: 'Jared Herzog', venue: 'The Red Bar' }),
      row({ title: 'Jared Herzog', venue: 'Red Bar', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    ];
    const [page] = actPages(pair, now);
    assert.equal(page.venues, 1);
    assert.match(renderAct(page, now).html, /Upcoming on 30A · 2 shows at 1 venue · updated /);
    assert.equal(actPages([pair[0], row({ title: 'Jared Herzog', venue: 'Crackings' })], now)[0].venues, 2);
  });
});

describe('a show the importer filed under something else (10 Oct 2026)', () => {
  // The importer calls a listing with no keyword music only from 4 PM at
  // one of its music bars, and a blurb's "friends and family" files a set
  // under family. In the scrape of 24 Sep, Jason Tyler Findley's 11 AM
  // Sunday set at AJ's came in as community and his Wednesday 4 PM one as
  // music; the Pickled Pickers' Sunday set at AJ's as family beside four
  // that were music. Counted by music rows alone, the page that says
  // "Every show ... on one page" left those sets out, and Findley - two
  // shows that week, one music row - had no page for the app to share.
  const now = noonOn('2026-09-24');
  const sunday = row({ title: 'Jason Tyler Findley', venue: "AJ's Grayton Beach", category: 'community', starts_at: '2026-09-27T16:00:00Z', ends_at: '2026-09-27T20:00:00Z' });
  const wednesday = row({ title: 'Jason Tyler Findley', venue: "AJ's Grayton Beach", category: 'music', starts_at: '2026-09-30T21:00:00Z', ends_at: '2026-10-01T01:00:00Z' });

  it('reads the act off any row’s title, and leaves founding one to a music row', () => {
    assert.equal(actTitleKey(sunday), 'jason tyler findley');
    assert.equal(actKey(sunday), null);
    assert.equal(actKey(wednesday), 'jason tyler findley');
    for (const t of ACT_TABLE) {
      if (t.category === 'music') assert.equal(actTitleKey({ title: t.title, venue: t.venue }), t.key, t.title);
    }
    // On its own it says nothing of a row that is not music.
    assert.equal(actTitleKey({ title: 'Church on the Beach', venue: 'Seaside Amphitheater' }), 'church on beach');
  });

  it('writes the page with the daytime set on it, once a music row ahead names the act', () => {
    const [page] = actPages([sunday, wednesday], now);
    assert.equal(page.slug, 'jason-tyler-findley');
    assert.equal(page.label, 'Jason Tyler Findley');
    assert.deepEqual(page.events, [sunday, wednesday]);
    assert.equal(page.venues, 1);
    // The Pickled Pickers' family-filed Sunday is on their page, in its place.
    const pickers = [
      row({ title: 'Pickled Pickers', venue: 'Red Fish Taco', category: 'music', starts_at: '2026-09-26T23:00:00Z', ends_at: '2026-09-27T02:00:00Z' }),
      row({ title: 'Pickled Pickers', venue: "AJ's Grayton Beach", category: 'family', starts_at: '2026-09-27T22:00:00Z', ends_at: '2026-09-28T01:00:00Z' }),
      row({ title: 'The Pickled Pickers', venue: "AJ's Grayton Beach", category: 'music', starts_at: '2026-10-04T22:00:00Z', ends_at: '2026-10-05T01:00:00Z' }),
    ];
    const [theirs] = actPages(pickers, now);
    assert.deepEqual(theirs.events, pickers);
    assert.equal(theirs.venues, 2);
  });

  it('makes no page of rows that no music row ahead names', () => {
    // Community both Saturdays: nothing founds the act.
    const larsen = [
      row({ title: 'Christy Larsen', venue: 'Crackings', category: 'community', starts_at: '2026-09-26T14:30:00Z', ends_at: '2026-09-26T17:30:00Z' }),
      row({ title: 'Christy Larsen', venue: 'Crackings', category: 'community', starts_at: '2026-10-03T14:30:00Z', ends_at: '2026-10-03T17:30:00Z' }),
    ];
    assert.deepEqual(actPages(larsen, now), []);
    // The music row has ended: what is left names no act.
    const played = row({ title: 'Jason Tyler Findley', venue: "AJ's Grayton Beach", category: 'music', starts_at: '2026-09-23T21:00:00Z', ends_at: '2026-09-24T01:00:00Z' });
    const later = row({ title: 'Jason Tyler Findley', venue: 'The Red Bar', category: 'community', starts_at: '2026-09-28T16:00:00Z', ends_at: '2026-09-28T20:00:00Z' });
    assert.deepEqual(actPages([played, sunday, later], now), []);
    // A title that is no act under any category stays none.
    const trivia = [
      row({ title: 'Trivia Night', venue: 'Crackings', category: 'nightlife' }),
      row({ title: 'Trivia Night', venue: "Pickle's Sandbar", category: 'music', starts_at: '2026-09-26T23:00:00Z', ends_at: '2026-09-27T02:00:00Z' }),
    ];
    assert.deepEqual(actPages(trivia, now), []);
  });

  it('names the act from its rows of any category, and from none when no music row carries the key', () => {
    assert.equal(actLabel([sunday, wednesday], 'jason tyler findley', now), 'Jason Tyler Findley');
    assert.equal(actLabel([sunday], 'jason tyler findley', now), '');
  });

  it('writes the pages the fixture says for its second week, as the app answers for it too', () => {
    // `elsewhere` is the rows of those acts as the scrape filed them,
    // moved into the fixture's week and read at its three moments. The
    // app's tests/actKey.test.ts and tests/actPage.test.ts are held to
    // the same answers.
    const { calendar, moments } = ACT_FIXTURE.elsewhere;
    assert.deepEqual(moments.map((m) => m.now), ACT_FIXTURE.moments.map((m) => m.now));
    for (const m of moments) {
      const pages = actPages(calendar, Date.parse(m.now))
        .map((p) => ({ key: p.key, label: p.label, slug: p.slug, shows: p.events.length, venues: p.venues }))
        .sort((a, b) => (a.key < b.key ? -1 : 1));
      assert.deepEqual(pages, m.acts, m.name);
    }
    // Findley's page is one music row and one that is not; the market's
    // guitarist, community both Saturdays, has none.
    assert.deepEqual(
      calendar.filter((e) => e.title === 'Jason Tyler Findley').map((e) => e.category),
      ['community', 'music'],
    );
    for (const m of moments) assert.ok(!m.acts.some((a) => a.key === 'christy larsen'), m.name);
    // And in the first week Jared Herzog's set at Crackings, filed under
    // community, is his fourth show and third venue.
    const jared = actPages(ACT_FIXTURE.calendar, Date.parse(ACT_FIXTURE.moments[0].now)).find((p) => p.key === 'jared herzog');
    assert.equal(jared.events.length, 4);
    assert.ok(jared.events.some((e) => e.category === 'community' && e.venue === 'Crackings'));
  });
});

describe('one week, three moments: the site and the app answer alike', () => {
  // The fixture's calendar is one week of rows; at each moment its `acts`
  // are the pages there must be: the name shown, the path, the shows left
  // and the venues. tests/actKey.test.ts in the app repo computes the same
  // list from the same rows with the app's own functions, and
  // tests/actPage.test.ts opens each of these paths on the app's act page.
  const at = (m) =>
    actPages(ACT_FIXTURE.calendar, Date.parse(m.now))
      .map((p) => ({ key: p.key, label: p.label, slug: p.slug, shows: p.events.length, venues: p.venues }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

  it('writes the pages the fixture says, under the names and at the paths it says', () => {
    assert.equal(ACT_FIXTURE.moments.length, 3);
    for (const m of ACT_FIXTURE.moments) assert.deepEqual(at(m), m.acts, m.name);
  });

  it('keeps a band’s page where the band posted it while the name on it changes', () => {
    const [, monday, thursday] = ACT_FIXTURE.moments;
    const page = (m) => actPages(ACT_FIXTURE.calendar, Date.parse(m.now)).find((p) => p.key === 'dion jones and neon tears');
    assert.equal(page(monday).label, 'Dion Jones and The Neon Tears');
    assert.equal(page(thursday).label, 'Dion Jones & Neon Tears');
    assert.equal(page(monday).slug, 'dion-jones-and-neon-tears');
    assert.equal(page(thursday).slug, page(monday).slug);
    // The slug of the name, which the path was first built from, is two
    // different pages those two days; share-cards.mjs wipes acts/ on every
    // run, so Monday's link would have been a 404 by Thursday.
    assert.notEqual(actSlug(page(monday).label), actSlug(page(thursday).label));
    const html = (m) => renderAct(page(m), Date.parse(m.now)).html;
    assert.match(html(monday), /<h1>Dion Jones and The Neon Tears<\/h1>/);
    assert.match(html(thursday), /<h1>Dion Jones &amp; Neon Tears<\/h1>/);
    for (const m of [monday, thursday]) {
      assert.match(html(m), /<link rel="canonical" href="https:\/\/30anow.github.io\/acts\/dion-jones-and-neon-tears\/">/);
      assert.match(html(m), /<a class="live" href="\/act\/dion-jones-and-neon-tears\?s=seo-act">/);
    }
    // And the link the installed app is handed, once it names the act
    // (actAppArgument: the feed until the store's binary has the route).
    assert.equal(actAppArgument(page(monday).slug, true), actAppArgument(page(thursday).slug, true));
    assert.equal(actAppArgument(page(monday).slug, true), 'thirtyanow://act/dion-jones-and-neon-tears');
  });

  it('lists the same paths in the sitemap and the index at every moment', () => {
    for (const m of ACT_FIXTURE.moments) {
      const now = Date.parse(m.now);
      const acts = actPages(ACT_FIXTURE.calendar, now);
      const xml = sitemapXml([], [], now, acts);
      const index = renderActsIndex(acts, now).html;
      for (const a of m.acts) {
        assert.match(xml, new RegExp(`<loc>https://30anow.github.io/acts/${a.slug}/</loc>`), `${m.name}: ${a.slug}`);
        assert.match(index, new RegExp(`href="/acts/${a.slug}/"`), `${m.name}: ${a.slug}`);
      }
      assert.equal((xml.match(/\/acts\/[a-z0-9-]+\/<\/loc>/g) || []).length, m.acts.length);
      assert.doesNotMatch(xml, /\/acts\/(meco|open-mic|live-music)\//);
    }
  });
});

describe('act page', () => {
  const now = noonOn('2026-09-08');
  const rows = [
    row({ title: 'Jared Herzog', venue: "Pickle's Sandbar", description: 'Acoustic on the deck' }),
    row({ title: 'Live Music with Jared Herzog', venue: 'Crackings', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z', price: 'Free', url: 'https://sowal.com/x' }),
    row({ title: 'Jared Herzog', venue: 'Crackings', starts_at: '2026-09-13T23:00:00Z', ends_at: '2026-09-14T02:00:00Z' }),
    row({ title: 'Trivia', venue: 'Crackings', category: 'nightlife' }),
  ];
  const venues = venuePages([...rows, ...[1, 2].map(() => row({ venue: 'Crackings', title: 'Open Mic' }))], now);
  const venueSlugs = new Map(venues.map((v) => [v.name.toLowerCase(), v.slug]));
  const act = actPages(rows, now)[0];

  it('lists every show with its venue linked, the app link by slug, and the undated card', () => {
    const page = renderAct(act, now, venueSlugs);
    const html = withJsonLd(page);
    assert.match(html, /<h1>Jared Herzog<\/h1>/);
    assert.match(html, /<p class="lead">Upcoming on 30A · 3 shows at 2 venues · updated /);
    assert.match(html, /<title>Jared Herzog on 30A — upcoming shows \| 30A Now<\/title>/);
    assert.match(html, /<meta property="og:title" content="Jared Herzog on 30A — upcoming shows">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/30anow.github.io\/og-default.png">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/acts\/jared-herzog\/">/);
    // The banner and the Open button carry actAppArgument (its own test is
    // below); the link to the web app names the act by its slug.
    assert.ok(html.includes(`app-argument=${actAppArgument('jared-herzog')}"`));
    assert.match(html, /<a class="live" href="\/act\/jared-herzog\?s=seo-act">See Jared Herzog live in the app<\/a>/);
    assert.match(html, /Open in 30A Now/);
    // Three rows, by day, each with the venue (linked when it has a page), the when, the price and the source.
    assert.equal((html.match(/<li class="ev"/g) || []).length, 3);
    assert.match(html, /<h2>Friday, Sep 11<\/h2>/);
    assert.match(html, /<h2>Saturday, Sep 12<\/h2>/);
    assert.match(html, /<a href="\/venues\/crackings\/">Crackings<\/a> · Grayton Beach · Sat, Sep 12 · 6:00 PM – 9:00 PM · Free/);
    assert.match(html, /Pickle's Sandbar · Grayton Beach · Fri, Sep 11/);
    assert.match(html, /Listing on sowal.com/);
    assert.match(html, new RegExp(`href="/e/${rows[0].id}\\?s=seo-act"`));
    assert.doesNotMatch(html, /Trivia/);
    // The row's own title stays as the source wrote it; the page's name is the act's.
    assert.match(html, /Live Music with Jared Herzog/);
    // Every row carries its end for EXPIRE, and the line for when all have ended.
    assert.equal((html.match(/ data-end="\d+"/g) || []).length, 3);
    assert.match(html, /<p class="done" id="done" hidden>Everything listed for Jared Herzog has finished\. <a href="\/act\/jared-herzog\?s=seo-act">/);
  });

  it('writes a MusicEvent per row with the act as its performer, and nothing else of the act’s', () => {
    const html = withJsonLd(renderAct(act, now, venueSlugs));
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(ld.length, 3);
    for (const e of ld) {
      assert.equal(e['@type'], 'MusicEvent');
      assert.deepEqual(e.performer, { '@type': 'MusicGroup', name: 'Jared Herzog' });
      assert.equal(e.location['@type'], 'Place');
    }
    assert.deepEqual(ld.map((e) => e.name), ['Jared Herzog', 'Live Music with Jared Herzog', 'Jared Herzog']);
    assert.equal(ld[1].offers.price, '0');
    const one = actJsonLd(rows[0], 'Jared Herzog');
    assert.equal(one['@context'], 'https://schema.org');
    assert.equal(Object.keys(one)[1], '@type');
    assert.ok(!('image' in one.performer) && !('url' in one.performer) && !('sameAs' in one.performer));
  });

  it('closes on the share line with the page’s own link in the copy button, outside <main>, and no pitch', () => {
    const html = renderAct(act, now, venueSlugs).html;
    assert.ok(html.includes(shareFooter('https://30anow.github.io/acts/jared-herzog/')));
    assert.match(html, /<strong>Play on 30A\?<\/strong> Share this page — it updates itself\./);
    assert.match(html, /<code id="snippet">https:\/\/30anow\.github\.io\/acts\/jared-herzog\/<\/code> <button type="button" id="copy">Copy link<\/button>/);
    const main = html.indexOf('</main>');
    const share = html.indexOf('<section class="owner">');
    const footer = html.indexOf('<footer>');
    assert.ok(main > 0 && main < share && share < footer, `${main} ${share} ${footer}`);
    assert.doesNotMatch(html, /\$25|Feature a show|<iframe|Run Jared|embed\//);
  });

  it('copies the link by running the button, and goes back to "Copy link" after', () => {
    const js = /<script>\n([\s\S]*?)<\/script>/.exec(renderAct(act, now, venueSlugs).html)[1];
    const link = 'https://30anow.github.io/acts/jared-herzog/';
    const handlers = {};
    const button = { textContent: 'Copy link', addEventListener: (ev, fn) => { handlers[ev] = fn; } };
    let copied = '';
    let reset = null;
    const env = {
      location: { search: '' },
      navigator: { userAgent: 'node', clipboard: { writeText: (t) => { copied = t; return Promise.resolve(); } } },
      document: {
        hidden: false,
        getElementById: (id) => ({ copy: button, snippet: { textContent: link } })[id] ?? null,
        querySelectorAll: () => [],
      },
      URL,
      URLSearchParams,
      Date,
      setTimeout: (fn) => { reset = fn; },
    };
    new Function(...Object.keys(env), js)(...Object.values(env));
    handlers.click();
    return Promise.resolve().then(() => {
      assert.equal(copied, link);
      assert.equal(button.textContent, 'Copied');
      reset();
      assert.equal(button.textContent, 'Copy link');
    });
  });

  it('indexes every act by name with its next show, from the venues page and the sitemap', () => {
    const acts = actPages([...rows, row({ title: 'MECO', venue: "Stinky's Bait Shack" }), row({ title: 'MECO', venue: 'Crackings', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' })], now);
    const html = renderActsIndex(acts, now).html;
    assert.match(html, /<h1>Acts playing 30A<\/h1>/);
    assert.match(html, /2 acts with a show coming up/);
    for (const a of acts) assert.match(html, new RegExp(`href="/acts/${a.slug}/"`));
    assert.match(html, /<a href="\/acts\/jared-herzog\/">Jared Herzog<\/a> <span class="m">next Pickle's Sandbar, Fri, Sep 11<\/span>/);
    assert.ok(html.indexOf('/acts/jared-herzog/') < html.indexOf('/acts/meco/'));
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/acts\/">/);
    assert.match(renderVenuesIndex(venues, now).html, /<a href="\/acts\/">Every act with a show coming up<\/a>/);
    assert.match(renderAct(act, now, venueSlugs).html, /<a href="\/acts\/">Every act<\/a>/);
  });

  it('is committed by the Action with the other generated pages', () => {
    const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
    assert.match(yml, /git add -A e lineup tonight venues acts towns embed sitemap\.xml robots\.txt/);
  });
});

/**
 * An act page is a link that gets handed out: the app's Share sends it,
 * and the page's own footer asks a band to post it. As first built the
 * floor of two that starts a page also took it down, and share-cards.mjs
 * cleared acts/ on every run, so a page went the run after its act's
 * second-to-last show ended - with the last one still ahead - and the
 * link fell through to 404.html, the web app's shell, which has no /acts
 * route. Over the 24 Sep 2026 snapshot with no further import, 19 acts
 * had a page on the first run and six lost it inside eight days with a
 * show to come (Michael Johnson's 19 hours before his Saturday set). The
 * strips have kept a list of what was handed out since 1 Oct 2026
 * (embed/published.json); these pages keep the same (10 Oct 2026).
 */
describe('an act page stays where it was handed out', () => {
  const cal = ACT_FIXTURE.calendar.map((r, i) => ({ id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, area: 'Grayton Beach', ...r }));
  const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
  const CRON = [...yml.matchAll(/- cron: '(\d+) ([\d,]+) \* \* \*'/g)].flatMap(([, m, hours]) =>
    hours.split(',').map((h) => Number(h) * 60 + Number(m)),
  );
  /** Every scheduled run from `from` to `to`, in order, at the times the workflow asks for. */
  const runsBetween = (from, to) => {
    const out = [];
    for (let day = Date.parse(`${from.slice(0, 10)}T00:00:00Z`); day <= Date.parse(to); day += 86400000) {
      for (const min of CRON) out.push(day + min * 60000);
    }
    return out.filter((t) => t >= Date.parse(from) && t <= Date.parse(to)).sort((a, b) => a - b);
  };
  /** The runs as share-cards.mjs makes them: the list read, the pages, the list handed on. */
  const walk = (rows, from, to, seed = []) => {
    let published = seed;
    return runsBetween(from, to).map((now) => {
      const acts = actPages(rows, now, published);
      published = publishedActs(published, acts);
      return { now, acts, published, files: new Map(actFiles(acts, published, now)) };
    });
  };
  const slugsAhead = (rows, now) =>
    new Set(rows.filter((e) => Date.parse(e.ends_at) > now && actKey(e)).map((e) => actSlug(actKey(e))));
  const zack = (p) => p.slug === 'zack-miller';
  const thuNoon = Date.parse('2026-10-15T17:00:00Z');
  const thuEvening = Date.parse('2026-10-15T20:35:00Z');

  it('keeps the page while one show is ahead: Zack Miller on Thursday evening, Friday at Crackings still to come', () => {
    assert.equal(CRON.length, 5);
    assert.ok(CRON.includes(20 * 60 + 35));
    // Thursday noon he has two shows and a page; his afternoon set at
    // Pickle's ends at 2 PM, and the 20:35 UTC run finds one.
    assert.equal(actPages(cal, thuNoon).find(zack).events.length, 2);
    // Two is still what starts a page: with no list, one show is none.
    assert.ok(!actPages(cal, thuEvening).some(zack));
    assert.ok(!actPages(cal, thuEvening, []).some(zack));
    // With the list the noon run left, the page is there with Friday on it.
    const list = publishedActs([], actPages(cal, thuNoon));
    assert.ok(list.some(zack));
    const kept = actPages(cal, thuEvening, list).find(zack);
    assert.ok(kept, 'the page a member shared at noon is gone by the evening');
    assert.deepEqual(kept.events.map((e) => e.venue), ['Crackings']);
    assert.equal(kept.label, 'Zack Miller');
    const html = renderAct(kept, thuEvening).html;
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/acts\/zack-miller\/">/);
    assert.match(html, /<p class="lead">Upcoming on 30A · 1 show at 1 venue · updated /);
    assert.equal((html.match(/<li class="ev"/g) || []).length, 1);
    assert.doesNotMatch(html, /noindex/);
    // A page with a show on it is still in the index and the sitemap.
    const acts = actPages(cal, thuEvening, list);
    assert.match(renderActsIndex(acts, thuEvening).html, /href="\/acts\/zack-miller\/"/);
    assert.match(sitemapXml([], [], thuEvening, acts), /<loc>https:\/\/30anow.github.io\/acts\/zack-miller\/<\/loc>/);
    // MECO has one show and never had a page: the list starts none.
    assert.ok(!list.some((p) => p.slug === 'meco'));
    assert.ok(!acts.some((p) => p.slug === 'meco'));
    // The floor is the fourth argument now, after the list.
    assert.ok(actPages(cal, thuEvening, [], 1).some((p) => p.slug === 'meco'));
  });

  it('never takes down a page a run has written, through the fixture’s week and three weeks past its last show', () => {
    const runs = walk(cal, '2026-10-11T17:20:00Z', '2026-11-20T00:00:00Z');
    assert.ok(runs.length > 150, String(runs.length));
    const everWritten = new Set();
    let quietSeen = 0;
    for (const run of runs) {
      for (const a of run.acts) everWritten.add(a.slug);
      const ahead = slugsAhead(cal, run.now);
      const at = new Date(run.now).toISOString();
      for (const slug of everWritten) {
        // The address answers on every run after the first that wrote it...
        const page = run.files.get(`acts/${slug}/index.html`);
        assert.ok(page, `${at}: /acts/${slug}/ is not written`);
        // ...with its shows on it for as long as it has one ahead.
        if (ahead.has(slug)) {
          assert.match(page, /<li class="ev"/, `${at}: /acts/${slug}/ has a show ahead and lists none`);
          assert.ok(run.acts.some((a) => a.slug === slug), `${at}: ${slug}`);
        } else {
          assert.match(page, /<meta name="robots" content="noindex">/, `${at}: ${slug}`);
          quietSeen += 1;
        }
      }
      // The list is what the files are: one directory per entry, no more.
      const dirs = [...run.files.keys()].filter((p) => /^acts\/[^/]+\/index\.html$/.test(p)).map((p) => p.split('/')[1]);
      assert.deepEqual(dirs.sort(), run.published.map((p) => p.slug));
      assert.ok(run.files.has('acts/index.html') && run.files.has('acts/published.json'));
    }
    assert.deepEqual([...everWritten].sort(), ['dion-jones-and-neon-tears', 'jared-herzog', 'will-thompson', 'zack-miller']);
    assert.ok(quietSeen > 0, 'the walk never reached a week with nothing on');
    // The last run: every show in the fixture is over, and all four answer.
    const last = runs[runs.length - 1];
    assert.equal(last.acts.length, 0);
    assert.equal(quietActs(last.published, last.acts).length, 4);
    // Without the list (the generator as first built) the same walk drops
    // each of the four while it still has a show to come.
    const dropped = new Set();
    let had = new Set();
    for (const now of runsBetween('2026-10-11T17:20:00Z', '2026-11-20T00:00:00Z')) {
      const on = new Set(actPages(cal, now).map((a) => a.slug));
      const ahead = slugsAhead(cal, now);
      for (const slug of had) if (!on.has(slug) && ahead.has(slug)) dropped.add(slug);
      had = on;
    }
    assert.deepEqual([...dropped].sort(), ['dion-jones-and-neon-tears', 'jared-herzog', 'will-thompson', 'zack-miller']);
  });

  it('brings the full page back at the same address when a show is posted again', () => {
    const list = [{ slug: 'zack-miller', name: 'Zack Miller' }];
    const later = Date.parse('2026-11-10T17:20:00Z');
    assert.deepEqual(quietActs(list, actPages(cal, later, list)), list);
    const booked = [...cal, { id: '00000000-0000-4000-9000-000000000999', title: 'Zack Miller', venue: 'The Red Bar', area: 'Grayton Beach', category: 'music', starts_at: '2026-11-14T00:00:00Z', ends_at: '2026-11-14T03:00:00Z' }];
    const acts = actPages(booked, later, list);
    assert.deepEqual(acts.map((a) => [a.slug, a.events.length]), [['zack-miller', 1]]);
    assert.deepEqual(quietActs(list, acts), []);
    const files = new Map(actFiles(acts, publishedActs(list, acts), later));
    assert.match(files.get('acts/zack-miller/index.html'), /The Red Bar/);
    assert.doesNotMatch(files.get('acts/zack-miller/index.html'), /noindex/);
  });

  it('writes a short page for a slug with nothing ahead: named, noindex, the same card, the same bytes every run', () => {
    const entry = { slug: 'dion-jones-and-neon-tears', name: 'Dion Jones & Neon Tears' };
    const html = renderActQuiet(entry);
    assert.match(html, /<h1>Dion Jones &amp; Neon Tears<\/h1>/);
    assert.match(html, /<p class="lead">Nothing listed for Dion Jones &amp; Neon Tears on 30A right now\. This page fills in again when a show is posted\.<\/p>/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/acts\/dion-jones-and-neon-tears\/">/);
    // The ways on: the app, the store, the act's screen on the web, every act.
    assert.match(html, /Open in 30A Now/);
    assert.ok(html.includes(`data-app="${actAppArgument(entry.slug)}"`));
    assert.match(html, /<a class="live" href="\/act\/dion-jones-and-neon-tears\?s=seo-act">See Dion Jones &amp; Neon Tears live in the app<\/a>/);
    assert.match(html, /<a href="\/acts\/">Every act<\/a>/);
    // Nothing listed: no rows, no schema.org events, no "has finished" line.
    assert.doesNotMatch(html, /<li class="ev"|application\/ld\+json|id="done"/);
    // The card a share draws is the full page's, so a link unfurls the
    // same in a quiet week as in a busy one.
    const full = renderAct(actPages(cal, thuNoon).find((p) => p.slug === entry.slug), thuNoon).html;
    assert.equal(actPages(cal, thuNoon).find((p) => p.slug === entry.slug).label, entry.name);
    for (const prop of ['og:title', 'og:description', 'og:url', 'og:image']) {
      const tag = new RegExp(`<meta property="${prop}" content="[^"]*">`);
      assert.equal(tag.exec(html)[0], tag.exec(full)[0], prop);
    }
    // No clock in it: the file is committed once, not on each of five runs a day.
    assert.equal(renderActQuiet.length, 1);
    assert.doesNotMatch(html, /beach time|updated /);
    const list = [entry];
    const a = new Map(actFiles([], list, Date.parse('2026-11-10T17:20:00Z'))).get('acts/dion-jones-and-neon-tears/index.html');
    const b = new Map(actFiles([], list, Date.parse('2026-12-24T02:47:00Z'))).get('acts/dion-jones-and-neon-tears/index.html');
    assert.equal(a, html);
    assert.equal(b, html);
    // In neither the index nor the sitemap.
    assert.doesNotMatch(renderActsIndex([], thuNoon).html, /dion-jones/);
    assert.doesNotMatch(sitemapXml([], [], thuNoon, []), /dion-jones/);
    // A name is text, never markup.
    assert.match(renderActQuiet({ slug: 'x', name: '<b>"X" & Y</b>' }), /<h1>&lt;b&gt;&quot;X&quot; &amp; Y&lt;\/b&gt;<\/h1>/);
  });

  it('keeps the list in acts/published.json: it only grows, by slug, sorted, under the name last shown', () => {
    const prev = [
      { slug: 'zack-miller', name: 'Zack Miller' },
      { slug: 'dion-jones-and-neon-tears', name: 'Dion Jones and The Neon Tears' },
      { slug: '../e', name: 'Escape' },
      { slug: 'no-name', name: '  ' },
    ];
    const acts = actPages(cal, thuNoon, prev);
    const list = publishedActs(prev, acts);
    assert.deepEqual(list, [
      // Thursday's name for the band, at Monday's address.
      { slug: 'dion-jones-and-neon-tears', name: 'Dion Jones & Neon Tears' },
      { slug: 'jared-herzog', name: 'Jared Herzog' },
      { slug: 'will-thompson', name: 'Will Thompson Band' },
      { slug: 'zack-miller', name: 'Zack Miller' },
    ]);
    for (const p of list) assert.match(p.slug, ACT_SLUG);
    // Nothing ahead and nothing new: the list is what it was.
    const later = Date.parse('2026-12-01T17:20:00Z');
    assert.deepEqual(publishedActs(list, actPages(cal, later, list)), list);
    // What the run writes is what the next run reads.
    const file = new Map(actFiles(acts, list, thuNoon)).get('acts/published.json');
    assert.equal(file, `${JSON.stringify(list, null, 2)}\n`);
    assert.deepEqual(parsePublished(file, 'acts/published.json'), list);
    // A broken file stops the run and says which file; a bad entry never becomes a path.
    assert.throws(() => parsePublished('{"slug":"x","name":"X"}', 'acts/published.json'), /acts\/published\.json is not a list/);
    assert.throws(() => parsePublished('{not json', 'acts/published.json'));
    assert.deepEqual(parsePublished(JSON.stringify([{ slug: '../../e', name: 'Escape' }, { slug: 'ok-one', name: ' OK One ' }]), 'acts/published.json'), [
      { slug: 'ok-one', name: 'OK One' },
    ]);
    // The strips' list still names itself.
    assert.throws(() => parsePublished('{}'), /embed\/published\.json is not a list/);
  });

  it('starts the list from the act pages on the site when there is no file, so a lost file takes no page down', () => {
    assert.deepEqual(seedPublishedActs([]), []);
    const acts = actPages(cal, thuNoon);
    const dirs = [
      ...acts.map((a) => ({ dir: a.slug, html: renderAct(a, thuNoon).html })),
      { dir: 'michael-johnson', html: renderActQuiet({ slug: 'michael-johnson', name: 'Michael Johnson' }) },
      { dir: 'Not A Slug', html: '<h1>Nope</h1>' },
      { dir: 'empty', html: '' },
    ];
    assert.deepEqual(seedPublishedActs(dirs), [
      { slug: 'dion-jones-and-neon-tears', name: 'Dion Jones & Neon Tears' },
      { slug: 'jared-herzog', name: 'Jared Herzog' },
      { slug: 'michael-johnson', name: 'Michael Johnson' },
      { slug: 'will-thompson', name: 'Will Thompson Band' },
      { slug: 'zack-miller', name: 'Zack Miller' },
    ]);
  });

  it('share-cards.mjs reads the list before it writes anything, and never clears it with the pages', () => {
    const src = readFileSync(new URL('./share-cards.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const at = (s) => {
      const i = src.indexOf(s);
      assert.ok(i > -1, `share-cards.mjs has no "${s}"`);
      return i;
    };
    // Read, then the pages from it, then the list handed on - all before the first write.
    assert.ok(at('const actsBefore = await readPublishedActs();') < at('const acts = actPages(events, now, actsBefore);'));
    assert.ok(at('const acts = actPages(events, now, actsBefore);') < at('const actsPublished = publishedActs(actsBefore, acts);'));
    assert.ok(at('const actsPublished = publishedActs(actsBefore, acts);') < at('await writeStubs(events, venues, now, posters);'));
    assert.ok(at("parsePublished(await readFile('acts/published.json', 'utf8'), 'acts/published.json')") > -1);
    // acts/ is not wiped with lineup/, tonight/ and venues/: only its
    // directories are cleared, so the list is never off the disk.
    assert.match(src, /for \(const dir of \['lineup', 'tonight', 'venues'\]\) \{\n    await rm\(dir, \{ recursive: true, force: true \}\);/);
    assert.doesNotMatch(src, /rm\('acts'/);
    const writeActs = src.slice(at('async function writeActs(files) {'), at('async function readPublishedActs() {'));
    assert.match(writeActs, /if \(entry\.isDirectory\(\)\) await rm\(`acts\/\$\{entry\.name\}`, \{ recursive: true, force: true \}\);/);
    // Every file under acts/ is one actFiles named.
    at('await writeActs(actFiles(acts, actsPublished, now, venueSlugs, posters));');
    assert.doesNotMatch(src, /writeFile\(['`]acts\//);
    // And the Action commits the list with the pages.
    assert.match(yml, /git add -A e lineup tonight venues acts towns embed sitemap\.xml robots\.txt/);
  });
});

/**
 * The act page was the first on the site to hand the installed app a
 * route newer than the binary in the store: thirtyanow://act/<slug>, on
 * Safari's banner and on "Open in 30A Now". 1.1.0 was built on 15 Sep
 * 2026 and the route reaches phones over the air, applied on the launch
 * after the one that downloads it, so every member who had not opened the
 * app twice since the update, and every new install's first session, got
 * the app's own 404 screen from the page whose point is to bring them in.
 */
describe('the act page’s door into the app', () => {
  const now = noonOn('2026-09-08');
  const act = actPages([row({ title: 'Jared Herzog' }), row({ title: 'Jared Herzog', venue: 'Crackings' })], now)[0];

  it('opens the feed, which every bundle has, until the store’s binary has the act route', () => {
    // Flip ACT_ROUTE_IN_BINARY when 1.2.0 is in the store, and this line with it.
    assert.equal(ACT_ROUTE_IN_BINARY, false);
    // The feed as these pages hand it over: tagged, so the app does not
    // take the tap for its widget's (FEED_APP_LINK; its own tests are below).
    assert.equal(actAppArgument('jared-herzog'), 'thirtyanow://feed?s=web');
    assert.equal(actAppArgument('jared-herzog', false), FEED_APP_LINK);
    const html = renderAct(act, now).html;
    // Safari's banner (and its no-script copy) and the Open button.
    assert.equal((html.match(/app-argument=thirtyanow:\/\/feed\?s=web"/g) || []).length, 1);
    assert.ok(html.includes(bannerMeta(FEED_APP_LINK)));
    assert.match(html, /<a class="btn" id="open" href="[^"]+" data-app="thirtyanow:\/\/feed\?s=web">Open in 30A Now<\/a>/);
    assert.doesNotMatch(html, /thirtyanow:\/\/act\//);
    // The page between shows hands out the same.
    const quiet = renderActQuiet({ slug: 'jared-herzog', name: 'Jared Herzog' });
    assert.match(quiet, /data-app="thirtyanow:\/\/feed\?s=web"/);
    assert.doesNotMatch(quiet, /thirtyanow:\/\/act\//);
    // The same argument the acts index and /tonight/ carry.
    assert.match(renderActsIndex([act], now).html, /data-app="thirtyanow:\/\/feed\?s=web"/);
    // The web app is not a binary: its link names the act, as before.
    assert.match(html, /<a class="live" href="\/act\/jared-herzog\?s=seo-act">/);
    // The venue page's route has been in the binary since 1.0.0.
    const venue = venuePages([row(), row(), row()], now)[0];
    assert.match(renderVenue(venue, now).html, /data-app="thirtyanow:\/\/venue\/The%20Red%20Bar"/);
  });

  it('names the act once the binary has the route', () => {
    assert.equal(actAppArgument('jared-herzog', true), 'thirtyanow://act/jared-herzog');
    assert.equal(actAppArgument('dion-jones-and-neon-tears', true), 'thirtyanow://act/dion-jones-and-neon-tears');
  });
});

/**
 * The app's home-screen widget opens the bare thirtyanow://feed, and the
 * app reads a launch by exactly that link as the widget's own tap: the
 * open is counted as one the widget brought, and the first-week card that
 * teaches the widget is retired without being shown (WIDGET_OWN_LINK in
 * the app's src/state/AppContext.tsx, 10 Oct 2026). /tonight/, the acts
 * index and every act page sent the same bare link from their Open button
 * and from Safari's banner. So someone handed a "Share tonight" link, who
 * had the app and no widget, tapped Open and was taken for a widget
 * owner: never shown the card, and counted as a widget launch.
 */
describe('the feed link these pages hand the app is not the widget’s (10 Oct 2026)', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];
  const venues = venuePages(rows, now);
  const act = actPages([row({ title: 'Jared Herzog' }), row({ title: 'Jared Herzog', venue: 'Crackings' })], now)[0];
  const SAM = '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c';
  // The app's two patterns, as its src/state/AppContext.tsx has them: the
  // widget's own link, and any link that opens the feed.
  const WIDGET_OWN_LINK = /^thirtyanow:\/\/\/?feed\/?$/i;
  const WIDGET_FEED_LINK = /^thirtyanow:\/\/\/?feed\/?(?:[?#]|$)/i;
  const feedPages = () => ({
    tonight: renderTonight(rows, venues, now).html,
    'acts index': renderActsIndex([act], now).html,
    act: renderAct(act, now).html,
    'act between shows': renderActQuiet({ slug: 'jared-herzog', name: 'Jared Herzog' }),
  });

  it('carries a tag the widget’s link does not, and still opens the feed in every bundle', () => {
    assert.equal(FEED_APP_LINK, 'thirtyanow://feed?s=web');
    assert.equal(WIDGET_OWN_LINK.test('thirtyanow://feed'), true);
    assert.equal(WIDGET_OWN_LINK.test(FEED_APP_LINK), false);
    assert.equal(WIDGET_FEED_LINK.test(FEED_APP_LINK), true);
    // The path is the feed's and the tag is all that follows it.
    assert.match(FEED_APP_LINK, /^thirtyanow:\/\/feed\?s=[\w.-]+$/);
  });

  it('is what the Open button and the banner carry on /tonight/, the acts index and an act page', () => {
    for (const [name, html] of Object.entries(feedPages())) {
      assert.equal(/id="open" href="[^"]*" data-app="([^"]*)"/.exec(html)[1], FEED_APP_LINK, name);
      assert.ok(html.includes(bannerMeta(FEED_APP_LINK)), name);
      assert.equal(banner(html, ''), FEED_APP_LINK, name);
      // Nowhere the bare link: every mention of the feed's link has the tag after it.
      assert.equal(html.split('thirtyanow://feed').length, html.split('thirtyanow://feed?s=web').length, name);
      assert.ok(html.split('thirtyanow://feed').length > 2, name);
    }
    // And no page function writes the link by hand.
    const src = readFileSync(new URL('./site.mjs', import.meta.url), 'utf8');
    assert.deepEqual(src.match(/'thirtyanow:\/\/feed[^']*'/g), ["'thirtyanow://feed?s=web'"]);
    assert.equal(src.split('appArgument: FEED_APP_LINK,').length - 1, 4);
    assert.match(src, /return inBinary \? `thirtyanow:\/\/act\/\$\{slug\}` : FEED_APP_LINK;/);
  });

  it('keeps the visitor’s own tag off the link, and puts an inviter after the tag', () => {
    for (const [name, html] of Object.entries(feedPages())) {
      // s= and ref= are for the web's arrival count; the link's tag stays "web".
      assert.equal(openLink(html, '?s=share-tonight'), FEED_APP_LINK, name);
      assert.equal(openLink(html, '?s=share-act&ref=the-red-bar'), FEED_APP_LINK, name);
      assert.equal(banner(html, '?s=share-tonight'), FEED_APP_LINK, name);
      // A member id rides along as it does on the lineup's link: after the tag, with "&".
      assert.equal(openLink(html, `?from=${SAM}`), `thirtyanow://feed?s=web&from=${SAM}`, name);
      assert.equal(banner(html, `?from=${SAM}`), `thirtyanow://feed?s=web&from=${SAM}`, name);
      assert.equal(WIDGET_OWN_LINK.test(openLink(html, `?from=${SAM}`)), false, name);
      assert.equal(WIDGET_FEED_LINK.test(openLink(html, `?from=${SAM}`)), true, name);
    }
  });

  it('leaves every other page’s link as it was', () => {
    assert.equal(openLink(renderLineup(rows, venues, now).html, ''), 'thirtyanow://weekend');
    assert.equal(openLink(renderVenue(venues[0], now).html, ''), 'thirtyanow://venue/The%20Red%20Bar');
    assert.equal(openLink(renderVenuesIndex(venues, now).html, ''), 'thirtyanow://');
    assert.equal(openLink(renderStub(rows[0], { now }).html, ''), `thirtyanow://event/${rows[0].id}`);
  });
});

/**
 * Bayside (12 Oct 2026): the south foot of the US 331 bridge over
 * Choctawhatchee Bay, where The Bay and North Beach Social sit, five miles
 * up the road from Grayton. The app files their rows under a twelfth area,
 * and AREA_NAMES has to match the app's AREAS. Not a beach neighbourhood
 * and not a town: a venue page there says where the bay is rather than
 * "on 30A", the JSON-LD locality is Santa Rosa Beach alone, and an act
 * whose every show is there is "near 30A".
 */
describe('Bayside: the bay end of 331', () => {
  const now = noonOn('2026-09-08');
  const bay = (over = {}) => row({ venue: 'The Bay', area: 'Bayside', lat: 30.3873, lng: -86.174, ...over });
  const nbs = (over = {}) => row({ venue: 'North Beach Social', area: 'Bayside', lat: 30.3883, lng: -86.1747, ...over });

  it('AREA_NAMES is the fifteen names in the app’s order, Bayside and the other off-beach areas last', () => {
    assert.deepEqual(AREA_NAMES, [
      'Dune Allen', 'Gulf Place', 'Blue Mountain', 'Grayton Beach', 'WaterColor', 'Seaside',
      'Seagrove', 'WaterSound', 'Alys Beach', 'Rosemary Beach', 'Inlet Beach', 'Bayside',
      'Hogtown Bayou', 'Point Washington', 'Serenoa',
    ]);
    assert.equal(BAYSIDE, 'Bayside');
  });

  it('a venue string "Bayside" is a town; The Bay and North Beach Social there are businesses', () => {
    assert.equal(isVenueName('Bayside'), false);
    assert.equal(isVenueName('bayside ', 'Bayside'), false);
    assert.equal(isVenueName('The Bay', 'Bayside'), true);
    assert.equal(isVenueName('North Beach Social', 'Bayside'), true);
    assert.equal(isPlaceholderVenue('Bayside'), false);
  });

  it('gives the two their pages with the owner footer, and a "Bayside" venue a page with none', () => {
    const rows = [
      ...[1, 2, 3].map(() => bay()),
      ...[1, 2, 3].map(() => nbs({ title: 'Trivia Night', category: 'nightlife' })),
      ...[1, 2, 3].map(() => row({ title: 'Bayside Market', venue: 'Bayside', area: 'Bayside' })),
    ];
    const pages = venuePages(rows, now);
    // A Map, since three venues with three rows each take whatever order
    // the tie-break gives.
    assert.deepEqual(
      new Map(pages.map((p) => [p.slug, p.owner])),
      new Map([['the-bay', true], ['north-beach-social', true], ['bayside', false]]),
    );
    const by = (slug) => pages.find((p) => p.slug === slug);
    assert.match(renderVenue(by('the-bay'), now).html, /Run The Bay\?/);
    assert.match(renderVenue(by('north-beach-social'), now).html, /Run North Beach Social\?/);
    assert.doesNotMatch(renderVenue(by('bayside'), now).html, /Run Bayside\?/);
  });

  it('the venue page says where the bay is, not "on 30A"; a corridor page is unchanged', () => {
    const pages = venuePages([...[1, 2, 3].map(() => bay()), ...[1, 2, 3].map(() => row())], now);
    const theBay = renderVenue(pages.find((p) => p.slug === 'the-bay'), now).html;
    assert.match(theBay, /<meta name="description" content="3 upcoming events at The Bay \(Bayside\) on Choctawhatchee Bay, minutes from 30A — next up Live Music, /);
    assert.match(theBay, /<meta property="og:description" content="Upcoming events and live music at The Bay \(Bayside\) on Choctawhatchee Bay, minutes from 30A\. Times, prices and the live map on 30A Now\.">/);
    assert.doesNotMatch(theBay, /\(Bayside\) on 30A/);
    const redBar = renderVenue(pages.find((p) => p.slug === 'the-red-bar'), now).html;
    assert.match(redBar, /<meta name="description" content="3 upcoming events at The Red Bar \(Grayton Beach\) on 30A — next up Live Music, /);
    assert.match(redBar, /<meta property="og:description" content="Upcoming events and live music at The Red Bar \(Grayton Beach\) on 30A\. Times, prices and the live map on 30A Now\.">/);
  });

  it('the JSON-LD locality for a Bayside row is Santa Rosa Beach alone', () => {
    const ld = eventJsonLd(bay());
    assert.equal(ld.location.address.addressLocality, 'Santa Rosa Beach');
    assert.equal(ld.location.address.addressRegion, 'FL');
    assert.equal(ld.location.address.streetAddress, undefined);
    assert.deepEqual(ld.location.geo, { '@type': 'GeoCoordinates', latitude: 30.3873, longitude: -86.174 });
    // A corridor row still names its neighbourhood first.
    assert.equal(eventJsonLd(row({ venue: 'Seaside Amphitheater', area: 'Seaside' })).location.address.addressLocality, 'Seaside, Santa Rosa Beach');
  });

  it('an act whose every show is at Bayside is "near 30A"; one that plays the corridor too stays "on 30A"', () => {
    const shows = [
      bay({ title: 'Jared Herzog' }),
      bay({ title: 'Jared Herzog', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
      nbs({ title: 'Jared Herzog', starts_at: '2026-09-13T23:00:00Z', ends_at: '2026-09-14T02:00:00Z' }),
    ];
    const [act] = actPages(shows, now);
    const html = renderAct(act, now).html;
    assert.match(html, /<title>Jared Herzog near 30A — upcoming shows \| 30A Now<\/title>/);
    assert.match(html, /<meta property="og:title" content="Jared Herzog near 30A — upcoming shows">/);
    assert.match(html, /<meta name="description" content="Jared Herzog near 30A: 3 shows coming up at 2 venues — next at The Bay, /);
    assert.match(html, /<meta property="og:description" content="Every show Jared Herzog has coming up near 30A, at every bar, /);
    assert.match(html, /<p class="lead">Upcoming near 30A · 3 shows at 2 venues · updated /);
    // "This weekend on 30A" in the Also line is the lineup's name and stays.
    assert.doesNotMatch(html, /Jared Herzog on 30A|Upcoming on 30A|along 30A/);

    const mixed = [shows[0], shows[1], row({ title: 'Jared Herzog', venue: 'Crackings', starts_at: '2026-09-13T23:00:00Z', ends_at: '2026-09-14T02:00:00Z' })];
    const [both] = actPages(mixed, now);
    const page = renderAct(both, now).html;
    assert.match(page, /<title>Jared Herzog on 30A — upcoming shows \| 30A Now<\/title>/);
    assert.match(page, /<meta property="og:title" content="Jared Herzog on 30A — upcoming shows">/);
    assert.match(page, /<meta property="og:description" content="Every show Jared Herzog has coming up along 30A, /);
    assert.match(page, /<p class="lead">Upcoming on 30A · 3 shows at 2 venues · updated /);
    assert.doesNotMatch(page, /near 30A/);
  });

  it('the page between shows says the same place as the full one: the list remembers an act that only played the bay', () => {
    // renderActQuiet takes the list's entry, which held a slug and a name
    // and nothing of where the act played, so the run after a Bayside
    // act's last show rewrote the same URL as "<name> on 30A", and the
    // card under a link the band had posted changed with it.
    const shows = [
      bay({ title: 'Salt Rock Revival' }),
      nbs({ title: 'Salt Rock Revival', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' }),
    ];
    const acts = actPages(shows, now);
    assert.equal(acts.length, 1);
    assert.equal(actNear30A(acts[0].events), true);
    assert.equal(actNear30A([]), false);
    const list = publishedActs([], acts);
    assert.deepEqual(list, [{ slug: 'salt-rock-revival', name: 'Salt Rock Revival', near: true }]);
    const full = renderAct(acts[0], now).html;
    // The run after the last show: no page, the slug left on the list, the quiet page written from it.
    const later = noonOn('2026-09-20');
    assert.deepEqual(actPages(shows, later, list), []);
    assert.deepEqual(quietActs(list, []), list);
    const files = new Map(actFiles([], list, later));
    const quiet = files.get('acts/salt-rock-revival/index.html');
    assert.match(quiet, /<title>Salt Rock Revival near 30A \| 30A Now<\/title>/);
    assert.match(quiet, /<meta name="description" content="Nothing listed for Salt Rock Revival near 30A right now\. /);
    assert.match(quiet, /<p class="lead">Nothing listed for Salt Rock Revival near 30A right now\. This page fills in again when a show is posted\.<\/p>/);
    assert.doesNotMatch(quiet, /Salt Rock Revival on 30A|along 30A/);
    for (const prop of ['og:title', 'og:description', 'og:url', 'og:image']) {
      const tag = new RegExp(`<meta property="${prop}" content="[^"]*">`);
      assert.equal(tag.exec(quiet)[0], tag.exec(full)[0], prop);
    }
    // The same bytes from the file the next run reads the entry back from.
    const read = parsePublished(files.get('acts/published.json'), 'acts/published.json');
    assert.deepEqual(read, list);
    assert.equal(renderActQuiet(read[0]), quiet);
    // Only a true flag survives the file; a corridor act's entry has no
    // key, as before, so its file and its quiet page are as they were.
    assert.deepEqual(
      parsePublished(JSON.stringify([{ slug: 'a-b', name: 'A B', near: false }, { slug: 'c-d', name: 'C D', near: 'yes' }, { slug: 'e-f', name: 'E F', near: true }]), 'acts/published.json'),
      [{ slug: 'a-b', name: 'A B' }, { slug: 'c-d', name: 'C D' }, { slug: 'e-f', name: 'E F', near: true }],
    );
    const corridor = publishedActs([], actPages([row({ title: 'Dread Clampitt' }), row({ title: 'Dread Clampitt', venue: 'Crackings', starts_at: '2026-09-12T23:00:00Z', ends_at: '2026-09-13T02:00:00Z' })], now));
    assert.deepEqual(corridor, [{ slug: 'dread-clampitt', name: 'Dread Clampitt' }]);
    assert.equal('near' in corridor[0], false);
    assert.match(renderActQuiet(corridor[0]), /<meta property="og:title" content="Dread Clampitt on 30A — upcoming shows">/);
    // The flag follows the act: the week it plays the road too, the full
    // page says "on 30A" and the list with it; the bay alone again, "near".
    const mixed = actPages([...shows, row({ title: 'Salt Rock Revival', venue: 'Crackings', starts_at: '2026-09-13T23:00:00Z', ends_at: '2026-09-14T02:00:00Z' })], now, list);
    assert.match(renderAct(mixed[0], now).html, /<meta property="og:title" content="Salt Rock Revival on 30A — upcoming shows">/);
    assert.deepEqual(publishedActs(list, mixed), [{ slug: 'salt-rock-revival', name: 'Salt Rock Revival' }]);
    assert.deepEqual(publishedActs(publishedActs(list, mixed), acts), list);
    // A lost file starts the list from the pages on the site, the place
    // read back off either page's card.
    assert.deepEqual(seedPublishedActs([{ dir: 'salt-rock-revival', html: quiet }, { dir: 'dread-clampitt', html: renderActQuiet(corridor[0]) }]), [
      { slug: 'dread-clampitt', name: 'Dread Clampitt' },
      { slug: 'salt-rock-revival', name: 'Salt Rock Revival', near: true },
    ]);
    assert.deepEqual(seedPublishedActs([{ dir: 'salt-rock-revival', html: full }]), list);
  });
});

/**
 * The door sign (14 Oct 2026). The strip offer in docs/featured-shows.md
 * (app repo) ends on "I'd love a QR code by the door", and until now the
 * code was "any free QR generator's output" for a URL the owner typed by
 * hand, one venue at a time. Now every slug-shaped strip directory of a
 * place someone runs carries /sign/: the venue's name, the question, the
 * code drawn by scripts/qr.mjs (scripts/qr.test.mjs carries the reader
 * that proves each code) and a Print button. The link inside the code is
 * the one hand-made signs have carried since September, so those keep
 * counting under the same key.
 */
describe('door signs', () => {
  const now = noonOn('2026-09-08');
  const rows = [row({ title: 'Jazz Night' }), row({ title: 'Dread Clampitt' }), row({ title: 'Trivia' })];

  it('carries the venue route with the two tags that count a scan, the form docs/venue-outreach.md hands out', () => {
    // The app repo's docs/venue-outreach.md and src/utils/ownerLink.ts
    // name these two; a change here changes a printed sign's count.
    assert.equal(doorUrl('The Red Bar'), 'https://30anow.github.io/venue/The%20Red%20Bar?s=qr&ref=the-red-bar');
    assert.equal(doorUrl("AJ's Grayton Beach"), "https://30anow.github.io/venue/AJ's%20Grayton%20Beach?s=qr&ref=ajs-grayton-beach");
    // The card's spelling makes the ref: "Red Bar" and "The Red Bar" are one door.
    assert.ok(doorUrl('Red Bar').endsWith('?s=qr&ref=the-red-bar'));
    assert.equal(doorUrl('Red Bar').split('?')[1], doorUrl('The Red Bar').split('?')[1]);
  });

  it('is printable ASCII whatever the name, so the byte mode writes the link that is on the page', () => {
    for (const name of ["Bud & Alley’s", 'Café Thirty-A', 'Seaside’s Central Square', 'x</script>', 'Trailing.']) {
      assert.match(doorUrl(name), /^[\x20-\x7e]+$/, name);
    }
    assert.equal(doorUrl("Bud & Alley’s"), 'https://30anow.github.io/venue/Bud%20%26%20Alley%E2%80%99s?s=qr&ref=bud-alleys');
    assert.match(doorUrl('Café Thirty-A'), /^https:\/\/30anow\.github\.io\/venue\/Caf%C3%A9%20Thirty-A\?s=qr&ref=/);
  });

  it('lives under the strip, at /embed/<slug>/sign/', () => {
    assert.equal(signPath('the-red-bar'), '/embed/the-red-bar/sign/');
    assert.equal(signPath('ajs-grayton-beach'), '/embed/ajs-grayton-beach/sign/');
  });

  it('is a whole page: noindex, the name, the link on the code, a Print button, one script and nothing to fetch', () => {
    const venue = embedVenues(rows, now).find((v) => v.slug === 'the-red-bar');
    const html = renderSign(venue);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>Door sign — The Red Bar \| 30A Now<\/title>/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<h1>The Red Bar<\/h1>/);
    assert.match(html, /<p class="ask">What’s on here tonight\?<\/p>/);
    assert.match(html, /data-url="https:\/\/30anow\.github\.io\/venue\/The%20Red%20Bar\?s=qr&amp;ref=the-red-bar"/);
    assert.match(html, /<div class="qr" role="img" aria-label="QR code that opens The Red Bar on 30A Now"/);
    // 67 characters is a version-5 code: 37 modules, plus four of quiet zone each side.
    assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 45 45" shape-rendering="crispEdges"/);
    assert.match(html, /<button type="button" id="print">Print this sign<\/button>/);
    assert.match(html, /Door sign for The Red Bar\. Print it and put it by the door or the host stand\. A scan opens tonight’s lineup at your place, and we count how often it is scanned\./);
    assert.match(html, /<p class="how">Scan with your phone’s camera\. Free, no account\.<\/p>/);
    assert.match(html, /<p class="brand">30A Now · the live map of Scenic Highway 30A · 30anow\.github\.io<\/p>/);
    // One script, the button; no beacon, no bundle, nothing from anywhere else.
    assert.equal(html.match(/<script/g).length, 1);
    assert.match(html, /getElementById\('print'\)[\s\S]*window\.print\(\)/);
    for (const never of ['fetch(', 'src=', 'Every scan', 'every scan', 'we show', 'usage_events', '_expo', 'embed_view', '<link']) {
      assert.ok(!html.includes(never), `the sign has "${never}" in it`);
    }
    assert.equal(html.split('http').length - 1, 2); // the link on the code and the SVG namespace, nothing else
    // Print CSS: the screen-only bar goes, the page has its margin, the code its size.
    assert.match(html, /@media print\{\.noprint\{display:none\}/);
    assert.match(html, /@page\{margin:12mm\}/);
    assert.match(html, /\.qr svg\{width:min\(70vw,110mm\);height:auto/);
    assert.match(html, /<div class="noprint bar">/);
    assert.match(html, /min-height:44px/);
    assert.ok(html.length < 12_000, `sign is ${html.length} bytes`);
  });

  it('escapes the name into the title, the heading and the label, and the link on the code is the escaped link', () => {
    const html = renderSign({ name: 'x</script><script>alert(1)', area: '', events: [], slug: 'x' });
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /<h1>x&lt;\/script&gt;&lt;script&gt;alert\(1\)<\/h1>/);
    assert.match(html, /<title>Door sign — x&lt;\/script&gt;&lt;script&gt;alert\(1\) \| 30A Now<\/title>/);
    assert.equal(html.match(/<script/g).length, 1);
    const bud = renderSign({ name: "Bud & Alley's", area: '', events: [], slug: 'bud-alleys' });
    assert.match(bud, /<h1>Bud &amp; Alley's<\/h1>/);
    assert.match(bud, /aria-label="QR code that opens Bud &amp; Alley's on 30A Now"/);
    assert.match(bud, /data-url="https:\/\/30anow\.github\.io\/venue\/Bud%20%26%20Alley's\?s=qr&amp;ref=bud-alleys"/);
  });

  it('is null for a link that cannot be a code, rather than a code that would not scan, and says why', () => {
    // The slug directory takes a name of any length; encoded, a long one
    // passes the 213 characters the reader in qr.mjs knows. The run
    // warns with the reason and writes no page (share-cards.mjs, below).
    const long = `${'A'.repeat(60)} ${'B'.repeat(60)} ${'C'.repeat(60)}`;
    assert.ok(doorUrl(long).length > 213, `${doorUrl(long).length}`);
    const venue = { name: long, area: '', events: [], slug: slugify(long) };
    assert.equal(renderSign(venue), null);
    assert.match(signProblem(venue), /^QR text is \d+ characters; at most 213 fit$/);
    // Every door in the known-venue table fits with room to spare, and
    // every one of their signs is written: its code read back as its link.
    for (const { name } of KNOWN_VENUES) {
      assert.ok(doorUrl(name).length <= 213 - 80, name);
      assert.equal(signProblem({ name }), null, name);
      assert.ok(renderSign({ name, area: '', events: [], slug: slugify(name) }), name);
    }
  });

  it('is null when the encoder hands back a code that does not read back as the link, so a wrong code is never written', () => {
    // Every code is read back by qr.mjs's own reader before qrSvg draws
    // it. Make the vendored encoder flip one data module of the code it
    // builds (the prototype, put back below; nothing in vendor/ changes)
    // and the sign for that venue is null, with the reader's verdict on
    // the warning line, where the old code drew whatever it was given.
    const venue = { name: 'The Red Bar', area: '', events: [], slug: 'the-red-bar' };
    const make = QRCode.prototype.make;
    QRCode.prototype.make = function flipped() {
      make.call(this);
      const n = this.modules.length;
      this.modules[n - 10][n - 1] = !this.modules[n - 10][n - 1];
    };
    try {
      assert.equal(renderSign(venue), null);
      assert.match(signProblem(venue), /^the code for "https:\/\/30anow\.github\.io\/venue\/The%20Red%20Bar\?s=qr&ref=the-red-bar" reads back as other text$/);
    } finally {
      QRCode.prototype.make = make;
    }
    assert.equal(signProblem(venue), null);
    assert.match(renderSign(venue), /<h1>The Red Bar<\/h1>/);
  });

  it('is written for the slug and alias directories of a place someone runs: never the name-spelled one, a town or a place nobody runs', () => {
    const town = [1, 2, 3].map((n) => row({ venue: 'Grayton Beach', title: `Market ${n}` }));
    const post = [1, 2, 3].map((n) => row({ venue: 'Post Office', title: `Walk ${n}` }));
    const published = [
      { slug: 'pickles-sandbar', name: "Pickle's Sandbar" }, // handed out, quiet now
      { slug: 'red-bar', name: 'Red Bar' }, // an older slug of the same door: an alias
      { slug: 'grayton-beach', name: 'Grayton Beach' }, // a town's strip, handed out before 1 Oct
      { slug: 'post-office', name: 'Post Office' }, // a place nobody runs, the same
    ];
    const venues = embedVenues([...rows, ...town, ...post], now, published);
    const dirs = embedDirs(venues).map((d) => d.dir);
    const signs = signDirs(venues).map((d) => d.dir);
    // The strips are there; the signs are a subset.
    for (const dir of ['The Red Bar', 'grayton-beach', 'post-office', 'Post Office', 'the-red-bar', 'red-bar']) assert.ok(dirs.includes(dir), dir);
    assert.deepEqual(signs.sort(), ['old-florida-fish-house', 'pickles-sandbar', 'red-bar', 'red-fish-taco', 'stinkys-bait-shack', 'the-red-bar']);
    for (const dir of signs) assert.match(dir, STRIP_SLUG);
    // The same venue stands behind a slug and its alias, so both carry one link.
    const alias = signDirs(venues).find((d) => d.dir === 'red-bar');
    assert.equal(alias.venue.name, 'The Red Bar');
    assert.equal(renderSign(alias.venue), renderSign(signDirs(venues).find((d) => d.dir === 'the-red-bar').venue));
    // A placeholder and an empty ref get nothing.
    assert.deepEqual(signDirs([{ name: 'Venues along 30A', area: '', events: [], slug: 'venues-along-30a' }]), []);
    assert.deepEqual(signDirs([{ name: '  ', area: '', events: [], slug: 'venue' }]), []);
  });

  it('is linked from the owner footer, under the Copy button, by the slug the page hands out', () => {
    const venue = venuePages(rows, now)[0];
    const html = renderVenue(venue, now).html;
    assert.match(
      html,
      /<p><button type="button" id="copy">Copy<\/button><\/p>\n<p><a href="\/embed\/the-red-bar\/sign\/">Print a door sign<\/a> — a QR code that opens tonight’s lineup here\.<\/p>/,
    );
    assert.match(ownerFooter({ name: "Bud & Alley's", slug: 'bud-alleys' }), /href="\/embed\/bud-alleys\/sign\/"/);
    // Inside the owner block, outside <main>, so a town's page offers none and the forwarder leaves it alone.
    assert.ok(html.indexOf('</main>') < html.indexOf('Print a door sign'));
    const town = venuePages([1, 2, 3].map((n) => row({ venue: 'Grayton Beach', title: `Market ${n}` })), now)[0];
    assert.doesNotMatch(renderVenue(town, now).html, /door sign/);
    // And every page with the footer has the sign its link names.
    assert.ok(signDirs(embedVenues(rows, now)).some((d) => d.dir === venue.slug));
  });

  it('share-cards.mjs writes each sign inside its strip, warns rather than writes when there is no code, and the Action tests the code first', () => {
    const src = readFileSync(new URL('./share-cards.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const writeEmbeds = src.slice(src.indexOf('async function writeEmbeds('), src.indexOf('async function readPublished('));
    assert.ok(writeEmbeds.includes('for (const { dir, venue } of signDirs(venues)) {'));
    assert.ok(writeEmbeds.includes('const sign = renderSign(venue);'));
    // The warning names the guard that refused (signProblem), not a guess.
    assert.match(writeEmbeds, /if \(!sign\) \{\n\s+console\.warn\(`No door sign for \$\{venue\.name\}: \$\{signProblem\(venue\)\}\.`\);\n\s+continue;\n\s+\}/);
    assert.ok(writeEmbeds.includes('await mkdir(`embed/${dir}/sign`, { recursive: true });'));
    assert.ok(writeEmbeds.includes('await writeFile(`embed/${dir}/sign/index.html`, sign);'));
    // After the strips, inside embed/<dir>/, which the run has just
    // written: the one clear-out stays the one, no new top-level name, so
    // the deploys' keep lists and the Action's git add are as they were.
    assert.ok(writeEmbeds.indexOf('await writeFile(`embed/${dir}/index.html`, html.get(venue));') < writeEmbeds.indexOf('signDirs(venues)'));
    assert.equal((writeEmbeds.match(/await rm\(/g) ?? []).length, 1);
    assert.deepEqual(writeEmbeds.match(/writeFile\([`']embed\/[^`']*[`']/g), [
      'writeFile(`embed/${dir}/index.html`',
      'writeFile(`embed/${dir}/sign/index.html`',
      "writeFile('embed/published.json'",
    ]);
    const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
    assert.match(yml, /- run: node --test scripts\/site\.test\.mjs scripts\/qr\.test\.mjs/);
    assert.match(yml, /git add -A e lineup tonight venues acts towns embed sitemap\.xml robots\.txt/);
  });
});

// ---------------------------------------------------------------------------
// Town pages (15 Oct 2026)
// ---------------------------------------------------------------------------

/**
 * /towns/<slug>/: everything on in one of the twelve neighbourhoods in the
 * next seven beach days, for the visitor who searches "things to do in
 * Seaside this week". The week below is Thu 15 to Wed 21 Oct 2026, read at
 * noon on the Thursday.
 */
describe('town pages', () => {
  const now = noonOn('2026-10-15');
  // A row starting at `hour` beach time on `day`, three hours long.
  const at = (day, hour, over = {}) =>
    row({
      starts_at: new Date(beachWallToUtc(day, hour)).toISOString(),
      ends_at: new Date(beachWallToUtc(day, hour) + 3 * 3600 * 1000).toISOString(),
      ...over,
    });
  const bud = "Bud & Alley's";
  const rows = [
    at('2026-10-16', 18, { title: 'Sounds of Seaside', venue: 'Seaside Amphitheater', area: 'Seaside' }),
    at('2026-10-15', 19, { title: 'Trivia Night', venue: bud, area: 'Seaside' }),
    at('2026-10-17', 8, { title: 'Beach Yoga', category: 'fitness', venue: 'Seaside Pavilion', area: ' seaside ' }),
    at('2026-10-18', 9, { title: 'Farmers Market', venue: 'Seaside', area: 'Seaside', category: 'market' }),
    at('2026-10-19', 19, { title: 'Monday Jazz', venue: bud, area: 'Seaside' }),
    // Thursday week: the eighth day, off the page.
    at('2026-10-22', 19, { title: 'Next Thursday', venue: bud, area: 'Seaside' }),
    // Over by noon.
    at('2026-10-15', 7, { title: 'Sunrise Paddle', venue: 'Seaside', area: 'Seaside' }),
    at('2026-10-16', 21, { title: 'Dread Clampitt' }),
    at('2026-10-17', 21, { title: 'Jared Herzog' }),
    at('2026-10-18', 21, { title: 'MECO' }),
    at('2026-10-17', 19, { title: 'Bay Trivia', venue: 'The Bay', area: 'Bayside' }),
    // No area, and an area that is not one of the twelve: no page.
    at('2026-10-16', 12, { title: 'Songwriters Festival', venue: 'Venues along 30A', area: '' }),
    at('2026-10-16', 12, { title: 'Destin Fireworks', venue: 'HarborWalk', area: 'Destin' }),
  ];
  const venues = venuePages(rows, now);
  const towns = townPages(rows, now);
  const seaside = towns.find((t) => t.slug === 'seaside');
  const ldOf = (html) =>
    [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

  it('looks seven beach days ahead, counted in calendar days across a DST change', () => {
    assert.equal(TOWN_DAYS, 7);
    const w = townWindow(now);
    assert.equal(w.start, beachWallToUtc('2026-10-15', 0));
    assert.equal(w.end + 1, beachWallToUtc('2026-10-22', 0));
    // The week clocks fall back in (Sun 1 Nov 2026) is seven days and an
    // hour, and still ends on the seventh day: never six days, never eight.
    const fall = townWindow(noonOn('2026-10-29'));
    assert.equal(beachDayKey(fall.end), '2026-11-04');
    assert.equal(fall.end + 1 - fall.start, (7 * 24 + 1) * 3600 * 1000);
    // And the one clocks spring forward in, an hour short.
    const spring = townWindow(noonOn('2027-03-11'));
    assert.equal(beachDayKey(spring.end), '2027-03-17');
    assert.equal(spring.end + 1 - spring.start, (7 * 24 - 1) * 3600 * 1000);
  });

  it('one page per town with something on this week, every row filed under it, west to east', () => {
    assert.deepEqual(
      towns.map((t) => [t.name, t.slug]),
      [['Grayton Beach', 'grayton-beach'], ['Seaside', 'seaside'], ['Bayside', 'bayside']],
    );
    // Every row whose area is the town - an amphitheater, a bar, a
    // pavilion's class, a town-only row - and none that is over or past the
    // seventh day. " seaside " is Seaside.
    assert.deepEqual(seaside.events.map((e) => e.title), [
      'Trivia Night', 'Sounds of Seaside', 'Beach Yoga', 'Farmers Market', 'Monday Jazz',
    ]);
    assert.equal(townSlug('WaterColor'), 'watercolor');
    assert.equal(townSlug('Alys Beach'), 'alys-beach');
    for (const name of AREA_NAMES) assert.match(townSlug(name), STRIP_SLUG);
  });

  it('a town page: its head, the intro, the rows by beach day, its venues and the ways back', () => {
    const page = renderTown(seaside, venues, now);
    const html = withJsonLd(page);
    assert.equal(page.count, 5);
    assert.match(html, /<title>Things to do in Seaside, FL this week \| 30A Now<\/title>/);
    assert.match(
      html,
      /<meta name="description" content="4 events in Seaside on 30A this week \(Thu, Oct 15 – Wed, Oct 21\): Trivia Night, Sounds of Seaside, Farmers Market and more\. Times, venues and the live map\.">/,
    );
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/towns\/seaside\/">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/30anow.github.io\/towns\/seaside\/">/);
    assert.match(html, /<meta property="og:title" content="Things to do in Seaside, FL this week">/);
    assert.match(html, /<meta property="og:description" content="What's on in Seaside, Florida this week: live music, markets and more, updated every day\.">/);
    assert.ok(html.includes(`<meta property="og:image" content="${OG_DEFAULT}">`));
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /<h1>This week in Seaside<\/h1>\n<p class="lead">What's on in Seaside, Florida this week: live music, markets and more, updated every day\.<\/p>/);
    assert.equal(townIntro('Seaside'), "What's on in Seaside, Florida this week: live music, markets and more, updated every day.");
    assert.match(html, /<p class="lead">Thu, Oct 15 – Wed, Oct 21 · 4 events \+ 1 class · updated Thu, Oct 15, 12:00 PM beach time<\/p>/);
    // A section per beach day, the lineup's, with the class folded.
    assert.deepEqual([...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]), [
      'Thursday, Oct 15', 'Friday, Oct 16', 'Saturday, Oct 17', 'Sunday, Oct 18', 'Monday, Oct 19',
      'Venues in Seaside', 'Also',
    ]);
    assert.match(html, /<summary>1 class, clinic or court time<\/summary>/);
    // Beach time, whatever the machine's zone.
    assert.match(html, /Thu, Oct 15 · 7:00 PM – 10:00 PM/);
    // The <h1> names the town once; the rows do not say it again.
    assert.doesNotMatch(html, / · Seaside · /);
    // A row's venue links to its page; the venues with a page are listed.
    assert.match(html, /<div class="m"><a href="\/venues\/bud-alleys\/">Bud &amp; Alley's<\/a> · Thu, Oct 15/);
    assert.match(html, /<h2>Venues in Seaside<\/h2><ul class="venues"><li><a href="\/venues\/bud-alleys\/">Bud &amp; Alley's<\/a><\/li><\/ul>/);
    assert.doesNotMatch(html, /Dread Clampitt|Bay Trivia|Next Thursday|Sunrise Paddle|Songwriters Festival/);
    // The ways back, and the arrival tag on the way in.
    assert.match(html, /<a href="\/lineup\/">This weekend on 30A<\/a>/);
    assert.match(html, /<a href="\/towns\/">Every town<\/a>/);
    assert.match(html, /<a class="live" href="\/\?s=seo-town">See it on the live map<\/a>/);
    assert.ok(html.includes(`href="/e/${seaside.events[0].id}?s=seo-town"`));
    assert.match(html, /apple-itunes-app" content="app-id=6792965952, app-argument=thirtyanow:\/\/"/);
    assert.equal(ARRIVAL.town, 'seo-town');
    // An Event per row, then the trail a search result shows.
    const [events, crumbs] = ldOf(html);
    assert.equal(events.length, 5);
    assert.equal(events[0]['@type'], 'Event');
    assert.equal(events[0].startDate, '2026-10-15T19:00:00-05:00');
    assert.deepEqual(crumbs, breadcrumbJsonLd([
      { name: '30A Now', path: '/' },
      { name: 'Towns', path: '/towns/' },
      { name: 'Seaside', path: '/towns/seaside/' },
    ]));
    assert.equal(crumbs['@type'], 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.item]), [
      [1, 'https://30anow.github.io/'],
      [2, 'https://30anow.github.io/towns/'],
      [3, 'https://30anow.github.io/towns/seaside/'],
    ]);
  });

  it('lists only the venues of its own town that have a page, never the town itself', () => {
    const list = [
      { name: 'Seaside', area: 'Seaside', slug: 'seaside', events: [] },
      { name: 'Seaside Amphitheater', area: 'Seaside', slug: 'seaside-amphitheater', events: [] },
      { name: bud, area: 'Seaside', slug: 'bud-alleys', events: [] },
      { name: 'The Red Bar', area: 'Grayton Beach', slug: 'the-red-bar', events: [] },
    ];
    const html = renderTown(seaside, list, now).html;
    const block = /<h2>Venues in Seaside<\/h2>(.*?)<\/section>/s.exec(html)[1];
    assert.deepEqual([...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), [
      '/venues/bud-alleys/',
      '/venues/seaside-amphitheater/',
    ]);
    assert.doesNotMatch(renderTown({ ...seaside }, [], now).html, /Venues in Seaside/);
  });

  it('escapes every string it writes', () => {
    const evil = at('2026-10-16', 20, {
      title: '<img src=x onerror=alert(1)>',
      venue: '"><script>alert(2)</script>',
      description: '</script><script>alert(3)</script>',
      area: 'Seaside',
    });
    // A venue page's name is scraped text too, and the town lists it.
    const venue = { name: '<b onmouseover=alert(4)>Bar</b>', area: 'Seaside', slug: 'b-onmouseover-alert-4-bar-b', events: [] };
    const html = withJsonLd(renderTown(townPages([evil], now)[0], [venue], now));
    assert.doesNotMatch(html, /<b onmouseover/);
    assert.match(html, /&lt;b onmouseover=alert\(4\)&gt;Bar&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /"><script>alert\(2\)/);
    assert.doesNotMatch(html, /<\/script><script>alert\(3\)/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /\\u003cimg src=x/);
  });

  it('says where Bayside is: on Choctawhatchee Bay, minutes from 30A', () => {
    const bay = towns.find((t) => t.slug === 'bayside');
    const html = withJsonLd(renderTown(bay, venues, now));
    assert.match(html, /<title>Things to do in Bayside on Choctawhatchee Bay this week \| 30A Now<\/title>/);
    assert.match(html, /<p class="lead">What's on in Bayside, on Choctawhatchee Bay, minutes from 30A, this week: live music, markets and more, updated every day\.<\/p>/);
    assert.match(html, /<meta name="description" content="1 event in Bayside on Choctawhatchee Bay, minutes from 30A this week \(/);
    assert.match(html, /<meta property="og:description" content="What's on in Bayside, on Choctawhatchee Bay, minutes from 30A, this week/);
    assert.doesNotMatch(html, /Bayside, FL|Bayside, Florida|Bayside on 30A/);
    const quiet = renderTownQuiet({ name: 'Bayside', slug: 'bayside' });
    assert.match(quiet, /Nothing listed in Bayside, on Choctawhatchee Bay, minutes from 30A, this week\./);
    assert.doesNotMatch(quiet, /Bayside, FL|Bayside, Florida|Bayside on 30A/);
    assert.match(renderTownsIndex(towns, now).html, /<a href="\/towns\/bayside\/">Bayside<\/a> <span class="m">1 · on Choctawhatchee Bay, minutes from 30A<\/span>/);
    // And a corridor town's page says nothing about the bay.
    assert.doesNotMatch(renderTown(seaside, venues, now).html, /Choctawhatchee/);
  });

  it('a town written before keeps a noindex page in a quiet week; one never written gets none', () => {
    // What share-cards.mjs found under towns/: two towns' pages, and a
    // directory that is no town.
    const have = ['seaside', 'dune-allen', 'not-a-town'];
    assert.deepEqual(quietTowns(have, towns), [{ name: 'Dune Allen', slug: 'dune-allen' }]);
    assert.deepEqual(quietTowns([], towns), []);
    assert.deepEqual(townFiles(towns, have, venues, now).map(([path]) => path), [
      'towns/index.html',
      'towns/grayton-beach/index.html',
      'towns/seaside/index.html',
      'towns/bayside/index.html',
      'towns/dune-allen/index.html',
    ]);
    const quiet = renderTownQuiet({ name: 'Dune Allen', slug: 'dune-allen' });
    assert.equal(townFiles(towns, have, venues, now).at(-1)[1], quiet);
    assert.match(quiet, /<meta name="robots" content="noindex">/);
    assert.match(quiet, /<link rel="canonical" href="https:\/\/30anow.github.io\/towns\/dune-allen\/">/);
    assert.match(quiet, /<h1>This week in Dune Allen<\/h1>\n<p class="lead">Nothing listed in Dune Allen, Florida this week\. This page fills in again when something is posted\.<\/p>/);
    assert.match(quiet, /<a href="\/lineup\/">See what’s on along 30A this weekend<\/a> · <a href="\/towns\/">Every town<\/a>/);
    assert.doesNotMatch(quiet, /application\/ld\+json| data-end="|<li class="ev"|updated [^<]* beach time/);
    // No `now`: the same bytes every run, so the Action commits it once.
    assert.equal(renderTownQuiet.length, 1);
    // The card a share draws is the full page's, word for word.
    const card = (html) => html.match(/<meta property="og:(?:title|description|url)" content="[^"]*">/g);
    const full = renderTown(townPages([at('2026-10-16', 18, { area: 'Dune Allen', venue: "Stinky's Bait Shack" })], now)[0], [], now).html;
    assert.deepEqual(card(quiet), card(full));
    assert.doesNotMatch(full, /noindex/);
  });

  it('the index links every town page this run, west to east, and says so when there are none', () => {
    const html = renderTownsIndex(towns, now).html;
    assert.match(html, /<title>Things to do on 30A this week, town by town \| 30A Now<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/30anow.github.io\/towns\/">/);
    assert.deepEqual([...html.matchAll(/<li><a href="(\/towns\/[^"]+)">/g)].map((m) => m[1]), [
      '/towns/grayton-beach/', '/towns/seaside/', '/towns/bayside/',
    ]);
    assert.match(html, /<a class="live" href="\/\?s=seo-town-index">/);
    assert.equal(ARRIVAL.towns, 'seo-town-index');
    const empty = renderTownsIndex([], now).html;
    assert.match(empty, /Nothing listed along 30A this week yet/);
    assert.doesNotMatch(empty, /href="\/towns\/[a-z]/);
  });

  it('the lineup and tonight link each town page this run, "By town:", and none when there are none', () => {
    const by = '<p class="lead">By town: <a href="/towns/grayton-beach/">Grayton Beach</a> · <a href="/towns/seaside/">Seaside</a> · <a href="/towns/bayside/">Bayside</a></p>';
    assert.ok(renderLineup(rows, venues, now, new Map(), towns).html.includes(by));
    assert.ok(renderTonight(rows, venues, now, new Map(), towns).html.includes(by));
    // Read off the same rows when no list is passed.
    assert.ok(renderLineup(rows, venues, now).html.includes(by));
    assert.doesNotMatch(renderLineup(rows, venues, now, new Map(), []).html, /By town:/);
    assert.doesNotMatch(renderTonight(rows, venues, now, new Map(), []).html, /By town:/);
    const one = renderLineup(rows, venues, now, new Map(), [seaside]).html;
    assert.ok(one.includes('<p class="lead">By town: <a href="/towns/seaside/">Seaside</a></p>'));
  });

  it('the lineup and tonight offer the stay planner under seo-stay, which the forwarder leaves alone', () => {
    assert.equal(ARRIVAL.stay, 'seo-stay');
    assert.equal(STAY_URL, 'https://30anow.github.io/stay?s=seo-stay');
    const line = '<p class="lead">Planning a trip? <a href="https://30anow.github.io/stay?s=seo-stay">Plan your stay →</a></p>';
    const lineup = renderLineup(rows, venues, now).html;
    const tonight = renderTonight(rows, venues, now).html;
    assert.ok(lineup.includes(line));
    assert.ok(tonight.includes(line));
    // Inside <main>, after the buttons.
    assert.ok(lineup.indexOf(line) > lineup.indexOf('<div class="cta">'));
    assert.ok(lineup.indexOf(line) < lineup.indexOf('</main>'));
    // A visitor's own s= and an inviter's from= go onto the page's own
    // links, never onto this one: it counts the line, and from= on /stay
    // names the app's door (pill, weekend, link), not a member.
    const from = '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c';
    assert.deepEqual(forward(lineup, `?s=fb&from=${from}`, [STAY_URL, '/weekend?s=seo-lineup']), [
      STAY_URL,
      `/weekend?s=fb&from=${from}`,
    ]);
  });

  it('a venue page leads its "Also" with its town’s page when this run has one', () => {
    const redBar = venues.find((v) => v.slug === 'the-red-bar');
    assert.match(
      renderVenue(redBar, now, new Map(), towns).html,
      /<h2>Also<\/h2><p><a href="\/towns\/grayton-beach\/">More in Grayton Beach →<\/a> · <a href="\/lineup\/">/,
    );
    assert.doesNotMatch(renderVenue(redBar, now, new Map(), [seaside]).html, /More in/);
    assert.doesNotMatch(renderVenue(redBar, now).html, /More in/);
    const budPage = venues.find((v) => v.slug === 'bud-alleys');
    assert.match(renderVenue(budPage, now, new Map(), towns).html, /<a href="\/towns\/seaside\/">More in Seaside →<\/a>/);
  });

  it('the sitemap lists the index and each town page this run, never a quiet one', () => {
    const xml = sitemapXml(rows, venues, now, [], towns);
    for (const path of ['/towns/', '/towns/grayton-beach/', '/towns/seaside/', '/towns/bayside/']) {
      assert.ok(xml.includes(`<loc>https://30anow.github.io${path}</loc>`), path);
    }
    assert.doesNotMatch(xml, /\/towns\/dune-allen\//);
    assert.equal((xml.match(/<loc>https:\/\/30anow.github.io\/towns\//g) || []).length, 4);
  });

  it('share-cards.mjs writes towns/ from townFiles, reads what is there first, and removes nothing outside it', () => {
    const src = readFileSync(new URL('./share-cards.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const at = (s) => {
      const i = src.indexOf(s);
      assert.ok(i > -1, `share-cards.mjs has no "${s}"`);
      return i;
    };
    // One list of towns feeds every page that links one.
    assert.ok(at('const towns = townPages(events, now);') < at('renderLineup(events, venues, now, posters, towns)'));
    at('renderTonight(events, venues, now, posters, towns)');
    at('renderVenue(v, now, posters, towns)');
    at('sitemapXml(events, venues, now, acts, towns)');
    // towns/ is not among the directories wiped whole.
    assert.match(src, /for \(const dir of \['lineup', 'tonight', 'venues'\]\) \{/);
    assert.doesNotMatch(src, /rm\('towns'/);
    const writeTowns = src.slice(at('async function writeTowns('), at('async function writeActs('));
    // The directories on disk are read before the files are decided.
    assert.ok(writeTowns.indexOf("readdir('towns'") < writeTowns.indexOf('townFiles(towns, have, venues, now, posters)'));
    // The one removal is a directory under towns/ that this run does not write.
    assert.deepEqual(writeTowns.match(/await rm\([^)]*\)/g), ['await rm(`towns/${entry.name}`, { recursive: true, force: true })']);
    assert.match(writeTowns, /if \(entry\.isDirectory\(\) && !dirs\.has\(entry\.name\)\) \{/);
    assert.doesNotMatch(src, /writeFile\(['`]towns\//);
    const yml = readFileSync(new URL('../.github/workflows/share-cards.yml', import.meta.url), 'utf8');
    assert.match(yml, /git add -A [^\n]*\btowns\b/);
  });
});

/**
 * The off-beach areas of 17 Oct 2026 (Hogtown Bayou, Point Washington,
 * Serenoa): five venues between US 98 and the bay, filed the way Bayside
 * is. The app's src/data/areas.ts marks the same four off-beach.
 */
describe('the off-beach areas north of 98', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const d98 = (over = {}) =>
    row({ venue: 'Distillery 98', area: 'Serenoa', lat: 30.34952, lng: -86.0659, starts_at: '2026-10-23T23:00:00Z', ends_at: '2026-10-24T01:00:00Z', ...over });

  it('marks Bayside and the three new areas off-beach, and nothing else', () => {
    assert.deepEqual([...OFF_BEACH.keys()], ['Bayside', 'Hogtown Bayou', 'Point Washington', 'Serenoa']);
    for (const name of AREA_NAMES) assert.equal(isOffBeach(name), OFF_BEACH.has(name), name);
    assert.equal(isOffBeach('Seaside'), false);
    assert.equal(isOffBeach(undefined), false);
  });

  it('a venue string that is one of the new area names is a town, not a business', () => {
    for (const name of ['Hogtown Bayou', 'Point Washington', 'Serenoa']) {
      assert.equal(isVenueName(name), false, name);
      assert.equal(isVenueName('Distillery 98', name), true, name);
    }
  });

  it("a Serenoa venue's page says where it is, never 'on 30A'", () => {
    const page = renderVenue(venuePages([d98(), d98({ starts_at: '2026-10-24T23:00:00Z', ends_at: '2026-10-25T01:00:00Z' }), d98({ starts_at: '2026-10-30T23:00:00Z', ends_at: '2026-10-31T01:00:00Z' })], now).find((v) => v.name === 'Distillery 98'), now).html;
    assert.match(page, /\(Serenoa\) off US 98, minutes from 30A/);
    assert.doesNotMatch(page, /\(Serenoa\) on 30A/);
  });

  it('an act that plays only off-beach venues is "near 30A", across areas; one that plays the corridor too is "on 30A"', () => {
    const offOnly = [d98({ title: 'Reid Murphy Quartet' }), row({ title: 'Reid Murphy Quartet', venue: 'The Bay', area: 'Bayside', starts_at: '2026-10-25T23:00:00Z', ends_at: '2026-10-26T01:00:00Z' })];
    assert.equal(actNear30A(offOnly), true);
    assert.equal(actNear30A([...offOnly, row({ title: 'Reid Murphy Quartet', venue: 'Crackings', area: 'Grayton Beach' })]), false);
  });

  it('a Serenoa town page reads "near 30A" in its title and "off US 98" in its sentence; its quiet page too', () => {
    const quiet = renderTownQuiet({ name: 'Serenoa', slug: 'serenoa' });
    assert.match(quiet, /<title>Things to do in Serenoa near 30A this week \| 30A Now<\/title>/);
    assert.match(quiet, /Nothing listed in Serenoa, off US 98, minutes from 30A, this week\./);
    assert.doesNotMatch(quiet, /Serenoa, FL|Serenoa, Florida|Serenoa on 30A/);
    assert.equal(townSlug('Point Washington'), 'point-washington');
    assert.equal(townSlug('Hogtown Bayou'), 'hogtown-bayou');
  });
});
