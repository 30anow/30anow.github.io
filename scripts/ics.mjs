// Calendar feeds a reader subscribes to (18 Oct 2026): one per venue strip
// (embed/<slug>/calendar.ics) and one per act page (acts/<slug>/calendar.ics).
// Subscribed once in Apple Calendar, Outlook or Google Calendar, a bar's or
// a band's 30A shows sit in the reader's own calendar and keep themselves
// current: the calendar fetches the file again on its own, so a show that
// is added appears and one that is cancelled goes. Every entry links back to
// its share page here.
//
// The format half is a copy of src/utils/ics.ts in the app repo (the
// single-event "Add to Calendar" file): the two repos cannot import each
// other, so keep the two in step. The same UID per event as that file, so a
// show downloaded once and then met again in a subscription is one event
// to the calendar that holds both. Times are instants in UTC (the Z form):
// the beach-time rule is about words a person reads, and this file carries
// none.

/** A TEXT value: backslash, semicolon, comma and line breaks escaped. */
export function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** An instant as a UTC DATE-TIME: 20261017T000000Z. */
export function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** UTF-8 octets of one code point. */
function octets(ch) {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * One content line folded at 75 octets, each continuation starting with a
 * space, never inside a character.
 */
export function foldIcsLine(line) {
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = octets(ch);
    const room = parts.length === 0 ? 75 : 74;
    if (size + n > room) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * How often a subscriber's calendar should fetch the file again. The site
 * is rewritten after every import and a few times a night; six hours keeps
 * a calendar within a day of a cancellation without asking more of it than
 * the runs give. Apple reads REFRESH-INTERVAL, Outlook X-PUBLISHED-TTL;
 * Google keeps its own clock whatever the file says.
 */
export const CALENDAR_REFRESH = 'PT6H';

/** The arrival tag on every entry's link, as the pages tag theirs (ARRIVAL in site.mjs). */
export const CALENDAR_TAG = 'cal';

/**
 * The whole feed: `name` and `description` are the calendar's own, and each
 * of `events` is { id, title, startsAt, endsAt, location, notes, url }. No
 * events is a valid feed, a quiet week's, and the file stays where a
 * subscriber put it. CRLF line ends, as the format asks.
 */
export function calendarIcs({ name, description, events }, now) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//30A Now//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-CALDESC:${icsText(description)}`,
    'X-WR-TIMEZONE:America/Chicago',
    `REFRESH-INTERVAL;VALUE=DURATION:${CALENDAR_REFRESH}`,
    `X-PUBLISHED-TTL:${CALENDAR_REFRESH}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@30anow.github.io`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(Date.parse(e.startsAt))}`,
      `DTEND:${icsStamp(Date.parse(e.endsAt))}`,
      `SUMMARY:${icsText(e.title)}`,
      `LOCATION:${icsText(e.location)}`,
      `DESCRIPTION:${icsText(e.notes)}`,
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * The two ways to subscribe to a feed at `path` on the site: webcal:// is
 * what Apple Calendar and Outlook take (an iPhone offers "Subscribe" on a
 * tap), and Google Calendar takes the same address through its own page.
 */
export function calendarLinks(path, site = 'https://30anow.github.io') {
  const webcal = `${site.replace(/^https?:/, 'webcal:')}${path}`;
  return {
    https: `${site}${path}`,
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  };
}
