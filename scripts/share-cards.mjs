// Regenerates everything on this site that is built from the events table:
//   e/<id>.html            one page per upcoming event: what a shared link
//                          unfurls as, and where it lands
//   lineup/, tonight/,     plain HTML a crawler can read, with JSON-LD
//   venues/<slug>/,        (see site.mjs for why)
//   acts/<slug>/
//   acts/published.json    every act page written so far, so a link a band
//                          posted outlives the week it was posted in
//   towns/<slug>/          one per neighbourhood with anything on in the
//                          next seven beach days, plus the towns/ index;
//                          a town written before keeps a short noindex
//                          page in a quiet week (15 Oct 2026)
//   embed/<venue>/         the strip a partner pastes into their own site,
//                          under both its slug and its own name
//   embed/<slug>/sign/     the printable door sign for the same place,
//                          under its slug only (14 Oct 2026)
//   embed/published.json   every strip slug a venue page has handed out,
//                          so a pasted strip outlives a quiet spell
//   sitemap.xml, robots.txt
// Runs on a schedule after the event imports land (.github/workflows/
// share-cards.yml). One paged read of the events table feeds all of it, and
// nothing is deleted until that read has proved itself (refuseImplausible).
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  actFiles,
  actPages,
  ANON_KEY,
  checkedPoster,
  venueCalendarFiles,
  embedDirs,
  embedVenues,
  fmtStamp,
  FOOTER_LOG_ARGS,
  lostFooterPages,
  parsePublished,
  publishedActs,
  publishedStrips,
  quietActs,
  renderEmbed,
  renderLineup,
  renderSign,
  renderStub,
  renderTonight,
  renderVenue,
  renderVenuesIndex,
  robotsTxt,
  seedPublished,
  seedPublishedActs,
  shrinkRefusal,
  signDirs,
  signProblem,
  sitemapXml,
  SUPABASE_URL,
  townFiles,
  townPages,
  truncationRefusal,
  venuePages,
  withinAWalk,
  withJsonLd,
} from './site.mjs';

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
// Both lists are read before anything is written: one that will not parse
// stops the run here, with every page still up. The act pages need theirs
// first - an act on it keeps its page with one show ahead (actPages).
const actsBefore = await readPublishedActs();
const acts = actPages(events, now, actsBefore);
const actsPublished = publishedActs(actsBefore, acts);
const published = publishedStrips(await readPublished(), venues);
await writeStubs(events, venues, now, posters);
await writeSite(events, venues, acts, actsPublished, now, posters);
await writeEmbeds(events, now, published);

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
    // What else is on within a walk that night (withinAWalk, 18 Oct 2026).
    const nearby = withinAWalk(events, ev, now);
    await writeFile(`e/${ev.id}.html`, withJsonLd(renderStub(ev, { poster, now, venueSlugs, nearby })));
  }
  console.log(`Wrote ${events.length} share stubs.`);
}

async function writeSite(events, venues, acts, actsPublished, now, posters) {
  // Wiped first so a venue that dropped below three rows loses its page
  // instead of lingering with a stale list. acts/ is not among them since
  // 10 Oct 2026: an act page is a link a band posts and the app's Share
  // sends, so every slug that has had one keeps one (actsPublished, below).
  for (const dir of ['lineup', 'tonight', 'venues']) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
  // The town pages this run writes: the lineup and tonight link each one
  // ("By town:"), a venue page its own town's, and the sitemap lists them.
  const towns = townPages(events, now);
  const lineup = renderLineup(events, venues, now, posters, towns);
  await writeFile('lineup/index.html', withJsonLd(lineup));
  const tonight = renderTonight(events, venues, now, posters, towns);
  await writeFile('tonight/index.html', withJsonLd(tonight));
  await writeFile('venues/index.html', renderVenuesIndex(venues, now).html);
  for (const v of venues) {
    await mkdir(`venues/${v.slug}`, { recursive: true });
    await writeFile(`venues/${v.slug}/index.html`, withJsonLd(renderVenue(v, now, posters, towns)));
  }
  // The act pages link each row's venue to its page, as the lineup does.
  const venueSlugs = new Map(venues.map((v) => [v.name.toLowerCase(), v.slug]));
  await writeActs(actFiles(acts, actsPublished, now, venueSlugs, posters));
  const kept = quietActs(actsPublished, acts).length;
  const quietTownCount = await writeTowns(towns, venues, now, posters);
  await writeFile('sitemap.xml', sitemapXml(events, venues, now, acts, towns));
  await writeFile('robots.txt', robotsTxt());
  console.log(
    `Wrote lineup (${lineup.count} rows), tonight (${tonight.count} rows), ` +
      `${venues.length} venue pages, ${acts.length} act pages (${kept} more kept between shows), ` +
      `${towns.length} town pages (${quietTownCount} more kept for a quiet week), ` +
      `sitemap and robots — ${fmtStamp(now)} beach time.`,
  );
}

/**
 * Everything under towns/ (townFiles in site.mjs says which). Not wiped
 * like venues/: a town's directory is the record that its page was
 * written (quietTowns), so each one found here is read first and then
 * overwritten, full or quiet, and never removed - a run that dies halfway
 * leaves every town page answering. The one thing cleared is a directory
 * this run does not write, which only a name no longer in AREA_NAMES can
 * be. Nothing outside towns/ is touched. towns/ is on the app repo's
 * deploy keep lists (deploy-web.yml, deploy-web.ps1) beside acts/; a
 * deploy without it would take every town page, and with them the record.
 * Answers how many quiet pages it wrote, for the log line.
 */
async function writeTowns(towns, venues, now, posters) {
  await mkdir('towns', { recursive: true });
  const have = [];
  for (const entry of await readdir('towns', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const page = await readFile(`towns/${entry.name}/index.html`, 'utf8').catch(() => '');
    if (page) have.push(entry.name);
  }
  const files = townFiles(towns, have, venues, now, posters);
  const dirs = new Set(files.map(([path]) => path.split('/')[1]).filter((d) => d !== 'index.html'));
  for (const entry of await readdir('towns', { withFileTypes: true })) {
    if (entry.isDirectory() && !dirs.has(entry.name)) {
      await rm(`towns/${entry.name}`, { recursive: true, force: true });
    }
  }
  for (const [path, contents] of files) {
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, contents);
  }
  return dirs.size - towns.length;
}

/**
 * Everything under acts/: the index, a page per act, a short page for
 * every slug on the list with nothing ahead, and the list itself
 * (actFiles in site.mjs says which). Only the directories are cleared, as
 * for the strips, so acts/published.json is never off the disk between
 * the clear-out and the write: a run that dies in between leaves the list
 * where it was. acts/ is on the app repo's deploy keep list
 * (deploy-web.yml, deploy-web.ps1) like lineup/, tonight/ and venues/; a
 * name missing there is wiped by the next client deploy, and here that
 * would take the list with the pages.
 */
async function writeActs(files) {
  await mkdir('acts', { recursive: true });
  for (const entry of await readdir('acts', { withFileTypes: true })) {
    if (entry.isDirectory()) await rm(`acts/${entry.name}`, { recursive: true, force: true });
  }
  for (const [path, contents] of files) {
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, contents);
  }
}

/**
 * The act pages written so far. No file yet is the first run: the list
 * starts from whatever act pages are on the site, which is none unless
 * the file was lost (seedPublishedActs). A file that is there but will
 * not parse throws, before anything has been written.
 */
async function readPublishedActs() {
  try {
    return parsePublished(await readFile('acts/published.json', 'utf8'), 'acts/published.json');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const dirs = [];
  for (const entry of await readdir('acts', { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const html = await readFile(`acts/${entry.name}/index.html`, 'utf8').catch(() => '');
    dirs.push({ dir: entry.name, html });
  }
  const seeded = seedPublishedActs(dirs);
  console.log(`No acts/published.json yet: starting it from the ${seeded.length} act pages on the site.`);
  return seeded;
}

/**
 * The partner strips, under both spellings: /embed/<slug>/ and
 * /embed/<venue name>/, because docs/featured-shows.md handed partners the
 * name-encoded URL and GitHub Pages redirects the no-slash form to it.
 *
 * Only the directories this script wrote are cleared. embed/[venue].html is
 * the expo export's own artifact — a literal-bracket file the web deploy
 * writes — and deleting it here would start a fight between two workflows
 * over the same path on every run. It is also the fallback for a venue with
 * no generated strip: Pages serves 404.html, the SPA boots and renders it.
 *
 * `published` is every slug a venue page has handed out (publishedStrips);
 * each keeps a strip whether or not its venue has anything on, and the list
 * goes back to embed/published.json for the next run. A file, not a
 * directory, so the clear-out below passes it by.
 *
 * The door sign (14 Oct 2026) goes inside the strip's own directory,
 * embed/<slug>/sign/index.html, for the slug and alias directories of a
 * place someone runs (signDirs): no new top-level name, so the deploys'
 * keep lists and the Action's git add are as they were, and a strip once
 * handed out keeps its sign with its page. Every code is read back by
 * qr.mjs's own reader before it is drawn, and a link that cannot be a
 * code (renderSign answers null: not printable ASCII, too long for the
 * reader, or a code that did not read back as the link) gets a line in
 * the run's log saying which (signProblem) and no page, never a code
 * that would not scan.
 */
async function writeEmbeds(events, now, published) {
  const venues = embedVenues(events, now, published);
  for (const entry of await readdir('embed', { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await rm(`embed/${entry.name}`, { recursive: true, force: true });
  }
  const pages = embedDirs(venues);
  const html = new Map(venues.map((v) => [v, renderEmbed(v, now)]));
  for (const { dir, venue } of pages) {
    await mkdir(`embed/${dir}`, { recursive: true });
    await writeFile(`embed/${dir}/index.html`, html.get(venue));
  }
  let signs = 0;
  for (const { dir, venue } of signDirs(venues)) {
    const sign = renderSign(venue);
    if (!sign) {
      console.warn(`No door sign for ${venue.name}: ${signProblem(venue)}.`);
      continue;
    }
    await mkdir(`embed/${dir}/sign`, { recursive: true });
    await writeFile(`embed/${dir}/sign/index.html`, sign);
    signs += 1;
  }
  // Each strip's calendar feed in its own directory (18 Oct 2026): the
  // address a venue page's "In your calendar" links, kept as long as the
  // strip is.
  const feeds = venueCalendarFiles(venues, now);
  for (const [path, ics] of feeds) {
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, ics);
  }
  await writeFile('embed/published.json', `${JSON.stringify(published, null, 2)}\n`);
  console.log(
    `Wrote ${pages.length} embed strips for ${venues.length} venues (${published.length} handed out), ${signs} door signs and ${feeds.length} calendar feeds.`,
  );
}

/**
 * The strips handed out so far. Until the list exists, the strips on the
 * site and the venue pages in git history stand in for it (seedPublished);
 * a list that is there but will not parse throws, before anything has been
 * written.
 */
async function readPublished() {
  try {
    return parsePublished(await readFile('embed/published.json', 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const dirs = [];
  for (const entry of await readdir('embed', { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const html = await readFile(`embed/${entry.name}/index.html`, 'utf8').catch(() => '');
    dirs.push({ dir: entry.name, html });
  }
  const lost = await lostPagesFromHistory(dirs.map((d) => d.dir));
  const seeded = seedPublished(dirs, lost);
  console.log(
    `No embed/published.json yet: starting it from ${seeded.length} strips ` +
      `(${lost.length} of them gone from the site, read out of git history).`,
  );
  return seeded;
}

/**
 * Every venue page since the owner footer shipped whose strip is no longer
 * on the site, as it last stood: [{ dir, html }]. The old generator deleted
 * a strip the run after its venue's last row ended, and it ran until this
 * one replaced it, so the strips on the site are not all the slugs handed
 * out. The checkout is one commit deep; share-cards.yml fetches the rest
 * for this run. Without it this warns and gives none, and the seed is the
 * strips on the site plus GONE_BEFORE_THE_LIST (site.mjs), as of 1 Oct 2026.
 */
async function lostPagesFromHistory(have) {
  const run = promisify(execFile);
  const git = async (...args) => (await run('git', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  try {
    const pages = [];
    for (const { slug, at } of lostFooterPages(await git(...FOOTER_LOG_ARGS), have)) {
      pages.push({ dir: slug, html: await git('show', `${at}:venues/${slug}/index.html`) });
    }
    return pages;
  } catch (err) {
    console.warn(
      `::warning::Could not read the venue pages out of git history (${String(err.message).split('\n')[0]}). ` +
        'The list starts from the strips on the site and Crackings; any other slug whose strip has already gone is not on it.',
    );
    return [];
  }
}
