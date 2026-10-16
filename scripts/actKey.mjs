// The act behind a music row's title: a plain-JS copy of src/utils/actKey.ts
// in the app repo (actKey, actLabel, actSlug), so the site's /acts/<slug>/
// pages and the app's act page name the same act for every spelling the
// sources write. Keep the two in step: site.test.mjs reads the same fixture
// of real titles (act-titles.json here, tests/fixtures/act-titles.json
// there) and both tests pin its hash, so a rule changed in one repo fails
// until the other has it. A row keyed differently here would give a band
// two pages, or none. Rows here are the events table's (starts_at,
// ends_at); the app's are camel-cased, which is the one difference.
// Nothing is stored: the key is computed from the title.
//
// The rules, in order, over the title folded as the app's feed search folds
// it (lowercase, apostrophes and accents gone):
// - '&' and '+' are ' and ', so a bill stays one act however it is joined.
// - A leading "Sunday Funday with", "Live Music with/by", "Music by",
//   "Brunch with", "An evening with", "featuring", "feat." or "w/" goes,
//   and so does a trailing "- Main Stage", "(Main Stage)" or "Live".
// - Anything that is not a letter a to z or a digit becomes a space, and
//   "the" goes wherever it stands.
// - A trailing "band" goes when two or more words are left and none of them
//   is "and": "Will Thompson Band" is Will Thompson, "Ronni Kay and The
//   Amazing Band" keeps its band.
// No act at all (null) when the row is not music, when nothing is left, when
// the title names only a kind of thing or a kind of night ("Live Music",
// "Live DJ", "Dueling Pianos", "Open Mic", "Happy Hour", a concert series, a
// festival, a party), or when every word is one the scraper calls
// undistinctive, the venue's own, a meal or a place.
//
// A row that is not music never makes an act, but it can be one of an
// act's shows (10 Oct 2026). The importer calls a listing with no keyword
// music only from 4 PM at one of its music bars, and a blurb's "friends and
// family" files a set under family: Jason Tyler Findley's 11 AM Sunday set
// at AJ's came in as community and his Wednesday 4 PM one as music, and the
// Pickled Pickers' Sunday set at AJ's as family beside four that were
// music. With the category deciding row by row, "every show on one page"
// left those sets out, and Findley, with two shows that week and one music
// row, had no page. So the category decides only whether a title can found
// an act (actKey). Once a music row has, every row whose title names the
// same act is one of its shows (actTitleKey; actPages in site.mjs), judged
// over the rows not yet ended. The app's src/utils/actKey.ts has the same
// rule, and the fixture's week pins both.
//
// The key is also the page's address: its words are a to z and digits only,
// so /acts/<slug>/ is the key with dashes for spaces, and the app reads the
// slug back as the key. As first built (6 Oct 2026) the address was the
// slug of the name shown, which is a count of spellings and tips as shows
// end: the app and this generator could disagree on it the same afternoon,
// and a page a band had posted on Monday would have moved by Thursday,
// since share-cards.mjs wipes acts/ on every run. The key does not move
// while the band keeps its name (10 Oct 2026).

import { AREA_NAMES } from './site.mjs';

/** Titles that name the kind of thing rather than the thing (GENERIC_TITLE in the scraper). */
export const GENERIC_TITLE = /^(live music|live entertainment|music|live dj|dj|entertainment)$/;

// The same for a slot with nobody named in it. Whole titles only: "DJ Boom"
// keeps his name, and "Guest DJ" has none. A genre or a format on its own,
// "Live" or "Solo" before it or not, is no name either (15 Oct 2026):
// "Jazz", "Acoustic", "Duo", "Yacht Rock" and "Late Set" are what a bar
// calls a night it has named nobody for, and as an act every bar's jazz
// night was one act, with a page, and a follow of it was a push for all
// of them. "Matt's Jazz" and "Red Bar Jazz" are names, and keep theirs.
const NO_NAME_TITLE =
  /^(live band|dj set|live dj set|guest dj|resident dj|special guests?|(live |solo )*(jazz|blues|bluegrass|reggae|acoustic|acoustic set|duo|yacht rock|classic rock|late set|steel drums?|piano bar))$/;

// A night that is the bar's own, wherever the words stand in the title:
// "Open Mic with Jared Herzog" is the open mic he hosts, not his show. The
// importer files an open mic under music, so without this two bars' "Open
// Mic" rows are one act with a page here whose performer is Open Mic. The
// phrase, not its words: "Mic Drop" and "Happy Jack" are names. A shop's
// pop-up or trunk show is the same kind of thing: "Welded Jewelry Pop-Up with
// Spark Collection 30A" had a page here on the first day (11 Oct 2026).
const NIGHT_PHRASE = /(?:^| )(?:open mic|open mike|happy hour|jam session|pop up|popup|trunk show)(?: |$)/;

// A word that says what kind of night it is, never who is playing.
// "Funday" is the bar's Sunday with no name after it (with one, the framing
// has already gone); "TBA" is nobody yet.
const KIND_WORDS = new Set([
  'music', 'concert', 'series', 'festival', 'party', 'night', 'brunch', 'pianos',
  'karaoke', 'bingo', 'sounds', 'song', 'oktoberfest', 'trivia',
  'funday', 'showcase', 'tba', 'tbd',
]);

// The scraper's UNDISTINCTIVE set, with the neighbourhood names (AREA_NAMES
// is the app's AREAS, copied in site.mjs) and "beach". Built on first use,
// not at import: site.mjs imports this file and this file imports site.mjs,
// and whichever is loaded second has the other's bindings only once both
// have run.
let undistinctive = null;
let areaKeys = null;
function sets() {
  if (!undistinctive) {
    undistinctive = new Set([
      'a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'the', 'to', 'with',
      'live', 'music', 'night', 'show', 'party', 'event', 'free', 'tribute', 'series',
      'beach',
      ...AREA_NAMES.flatMap((a) => a.toLowerCase().split(/\s+/)),
    ]);
    areaKeys = new Set(AREA_NAMES.map((a) => a.toLowerCase()));
  }
  return { undistinctive, areaKeys };
}

const MEAL_WORDS = new Set(['brunch', 'lunch', 'dinner']);

// Where a bar puts its music: "Live Music by the Lake" says the lakeside
// stage, not a band called Lake.
const PLACE_WORDS = new Set([
  'lake', 'pool', 'lawn', 'deck', 'patio', 'porch', 'rooftop', 'pier', 'dock', 'bay',
  'stage', 'bar', 'lounge',
]);

const LEAD = /^(sunday funday with|live music (with|by)|music by|brunch with|an evening with|featuring|feat\.?|w\/)\s+/;
const TAILS = [/\s*[-–]\s*main stage$/, /\s*\(main stage\)$/, /\s+live$/];
const LEAD_SHOWN = new RegExp(LEAD.source, 'i');
const TAILS_SHOWN = TAILS.map((t) => new RegExp(t.source, 'i'));

// What is not part of a word of the key: everything but a to z and the
// digits, once the title is folded. Punctuation, a note or an emoji a
// source hangs on a title ("Jared Herzog ♫" is Jared Herzog, not a second
// act), and a letter the fold cannot bring to a to z - which keeps the key
// and the path of its page one thing (actSlug). A name with no such letter
// in it has no path, so it is no act.
const NOT_WORD = /[^a-z0-9]+/g;

// Escaped, as in the app's searchText.ts: in an editor they are hard to tell apart.
const APOSTROPHES = /['\u2018\u2019\u02BC`\u00B4]/g;
const MARKS = /[\u0300-\u036F]/g;

/** foldSearch in the app's src/utils/searchText.ts: lowercase, accents and apostrophes gone. */
export function foldSearch(s) {
  return String(s ?? '').normalize('NFD').replace(MARKS, '').replace(APOSTROPHES, '').toLowerCase();
}

function venueWords(venue) {
  const key = foldSearch(venue ?? '')
    .replace(/&/g, ' and ')
    .replace(NOT_WORD, ' ')
    .trim();
  if (!key || sets().areaKeys.has(key)) return new Set();
  return new Set(key.split(' '));
}

function keyWords(title, venue) {
  let s = foldSearch(title).replace(/[&+]/g, ' and ').replace(/\s+/g, ' ').trim();
  s = s.replace(LEAD, '');
  for (const t of TAILS) s = s.replace(t, '');
  const words = s
    .replace(NOT_WORD, ' ')
    .split(' ')
    .filter((w) => w && w !== 'the');
  if (words.length >= 3 && words[words.length - 1] === 'band' && !words.includes('and')) {
    words.pop();
  }
  if (words.length === 0) return null;
  const name = words.join(' ');
  if (GENERIC_TITLE.test(name) || NO_NAME_TITLE.test(name) || NIGHT_PHRASE.test(name)) return null;
  if (words.some((w) => KIND_WORDS.has(w))) return null;
  const own = venueWords(venue);
  const { undistinctive: common } = sets();
  if (words.every((w) => common.has(w) || own.has(w) || MEAL_WORDS.has(w) || PLACE_WORDS.has(w))) {
    return null;
  }
  return words;
}

/**
 * The act a title names with the row's category put aside: what actKey
 * answers for a music row, asked of any row (actTitleKey in the app). On
 * its own it says nothing of a row that is not music - "Church on the
 * Beach" has a key by these rules - so it is only ever matched against an
 * act a music row has founded (actPages in site.mjs).
 */
export function actTitleKey(e) {
  const words = keyWords(e.title ?? '', e.venue);
  return words ? words.join(' ') : null;
}

/**
 * The act a music row names, as a key its other spellings share, or null.
 * Null for every row that is not music: such a row founds no act, though
 * it may be one of an act's shows.
 */
export function actKey(e) {
  if (e.category !== 'music') return null;
  return actTitleKey(e);
}

const isMusic = (e) => e.category === 'music';

/** A title as it is shown for an act: the source's framing taken off. */
export function shownTitle(title) {
  let s = String(title ?? '').trim().replace(LEAD_SHOWN, '');
  for (const t of TAILS_SHOWN) s = s.replace(t, '');
  s = s.trim();
  return s || String(title ?? '').trim();
}

/**
 * The spelling to show for an act at `now`: the most frequent title among
 * its rows that have not ended, the soonest row's on a tie, with the
 * source's framing taken off. The app's actLabel counts the same rows, so
 * its act page, its event page's door and the page written here say one
 * name; the fixture's moments pin both. With nothing ahead the rows in
 * hand are counted. The act's rows are every row whose title names it,
 * under any category, once a music row among them does; and the rows
 * ahead count only while a music row is among those too, as the app's
 * actLabel has it. '' for a key no music row carries.
 */
export function actLabel(rows, key, now) {
  const named = rows.filter((e) => actTitleKey(e) === key);
  const mine = named.some(isMusic) ? named : [];
  const left = mine.filter((e) => Date.parse(e.ends_at) > now);
  const ahead = left.some(isMusic) ? left : [];
  const counts = new Map();
  for (const e of ahead.length > 0 ? ahead : mine) {
    const start = Date.parse(e.starts_at);
    const c = counts.get(e.title);
    if (c) {
      c.n += 1;
      if (start < c.soonest) c.soonest = start;
    } else {
      counts.set(e.title, { n: 1, soonest: start });
    }
  }
  let best = null;
  for (const [title, c] of counts) {
    if (!best || c.n > best.n || (c.n === best.n && c.soonest < best.soonest)) {
      best = { title, ...c };
    }
  }
  return best ? shownTitle(best.title) : '';
}

/**
 * The floor for an act page: two shows not yet ended. One show is the
 * event's own page. ACT_PAGE_MIN in the app, whose Share button waits for
 * the same number, so the link it sends is a page written here.
 */
export const ACT_PAGE_MIN = 2;

/**
 * A path segment from text: folded, every run of anything but a letter a
 * to z or a digit a dash. An act's page is /acts/<actSlug(key)>/ - the key
 * with dashes for its spaces, since a key has nothing else in it - and
 * never the slug of the name shown, which changes with the spellings on
 * the calendar. The app's actSlug, so the share link it builds and the
 * page written here agree. '' for text with no letter or digit in it.
 */
export function actSlug(text) {
  return foldSearch(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
