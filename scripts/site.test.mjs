// node --test scripts/site.test.mjs — no dependencies, runs in the Action
// before the generator so a broken page never reaches the site. Every
// assertion holds in any machine timezone; that is the point of beach time.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addBeachDays,
  ARRIVAL,
  beachDayKey,
  beachIso,
  beachWallToUtc,
  embedDirs,
  embedNameDir,
  embedRef,
  embedVenues,
  embedWeek,
  eventJsonLd,
  groupByDay,
  inWindow,
  knownVenue,
  priceNumber,
  PUBLISHED_EMBEDS,
  renderEmbed,
  renderLineup,
  renderStub,
  renderTonight,
  renderVenue,
  renderVenuesIndex,
  robotsTxt,
  rowHtml,
  safeUrl,
  shrinkRefusal,
  sitemapXml,
  slugify,
  tonightWindow,
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
    assert.match(html, /app-argument=thirtyanow:\/\/feed"/);
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
 * the script left behind.
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
      querySelectorAll: (sel) => (sel.includes('a[href^="/"]') ? links : []),
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
    assert.equal((xml.match(/<url>/g) || []).length, 4 + 1 + 3);
    assert.match(xml, /<lastmod>2026-09-08T17:00:00.000Z<\/lastmod>/);
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
