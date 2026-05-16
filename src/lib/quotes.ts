/**
 * Curated, attributed quotes for the dashboard "note for you" + auth-side
 * panel. Everything in this file is a real quote from a real, verifiable
 * published source.
 *
 * RULES for adding new quotes:
 *   1. Must be a real quote from a real, verifiable source.
 *   2. Must align with the empathy principles in docs/EMPATHY.md —
 *      acknowledges difficulty, offers perspective, never hustle-bro.
 *   3. Include attribution + source (book / speech / interview).
 *   4. No fake user testimonials. Ever.
 */

export interface Quote {
  text: string;
  attribution: string;
  /** Optional context — e.g. the speech/book it's from */
  source?: string;
}

export const QUOTES: Quote[] = [
  {
    text: 'I can be changed by what happens to me. But I refuse to be reduced by it.',
    attribution: 'Maya Angelou',
    source: 'Letter to My Daughter',
  },
  {
    text: 'You may not control all the events that happen to you, but you can decide not to be reduced by them.',
    attribution: 'Maya Angelou',
  },
  {
    text: "Sometimes life hits you in the head with a brick. Don't lose faith.",
    attribution: 'Steve Jobs',
    source: 'Stanford commencement, 2005',
  },
  {
    text: 'Rock bottom became the solid foundation on which I rebuilt my life.',
    attribution: 'J.K. Rowling',
    source: 'Harvard commencement, 2008',
  },
  {
    text: 'Option A is not available. So let\'s just kick the shit out of Option B.',
    attribution: 'Sheryl Sandberg',
    source: 'Option B, after her husband\'s death',
  },
  {
    text: "Everything can be taken from a man but one thing: the last of the human freedoms — to choose one's attitude in any given set of circumstances.",
    attribution: 'Viktor Frankl',
    source: "Man's Search for Meaning",
  },
  {
    text: "Be patient toward all that is unsolved in your heart, and try to love the questions themselves.",
    attribution: 'Rainer Maria Rilke',
    source: 'Letters to a Young Poet',
  },
  {
    text: "You don't have a right to the cards you believe you should have been dealt. You have an obligation to play the hell out of the ones you're holding.",
    attribution: 'Cheryl Strayed',
    source: 'Tiny Beautiful Things',
  },
  {
    text: 'Almost everything will work again if you unplug it for a few minutes, including you.',
    attribution: 'Anne Lamott',
  },
  {
    text: 'We don\'t have to do all of it alone. We were never meant to.',
    attribution: 'Brené Brown',
    source: 'Braving the Wilderness',
  },
  {
    text: 'Owning our story can be hard but not nearly as difficult as spending our lives running from it.',
    attribution: 'Brené Brown',
    source: 'The Gifts of Imperfection',
  },
  {
    text: 'Do what you can, with what you have, where you are.',
    attribution: 'Theodore Roosevelt',
  },
  {
    text: 'Not everything that is faced can be changed, but nothing can be changed until it is faced.',
    attribution: 'James Baldwin',
    source: 'As Much Truth As One Can Bear, 1962',
  },
  {
    text: 'Facebook turned me down. It was a great opportunity to connect with some fantastic people. Looking forward to life\'s next adventure.',
    attribution: 'Brian Acton',
    source: 'Twitter, 2009 — he co-founded WhatsApp the next year',
  },
  {
    text: 'When I was a boy and I would see scary things in the news, my mother would say to me, "Look for the helpers. You will always find people who are helping."',
    attribution: 'Fred Rogers',
  },
  {
    text: 'Hope begins in the dark, the stubborn hope that if you just show up and try to do the right thing, the dawn will come.',
    attribution: 'Anne Lamott',
    source: 'Bird by Bird',
  },
  {
    text: 'Caring for myself is not self-indulgence, it is self-preservation.',
    attribution: 'Audre Lorde',
    source: 'A Burst of Light, 1988',
  },
  {
    text: 'Vulnerability is not winning or losing; it\'s having the courage to show up when you can\'t control the outcome.',
    attribution: 'Brené Brown',
    source: 'Rising Strong',
  },
  {
    text: 'The cure for pain is in the pain.',
    attribution: 'Rumi',
  },
  {
    text: 'I have learned, in whatsoever state I am, therewith to be content.',
    attribution: 'Philippians 4:11 / quoted in countless memoirs',
  },
  {
    text: 'Just because you are struggling does not mean you are failing. Every great success requires some kind of struggle to get there.',
    attribution: 'Michelle Obama',
    source: 'Becoming',
  },
  {
    text: 'You can\'t use up creativity. The more you use, the more you have.',
    attribution: 'Maya Angelou',
  },
];

/**
 * Deterministic "quote of the day" — same for everyone on a given date,
 * cycles through the array based on day-of-year so the rotation is
 * predictable and won't repeat for ~3 weeks.
 */
export function getTodayQuote(): Quote {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 0));
  const now = new Date();
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86_400_000);
  const idx = dayOfYear % QUOTES.length;
  return QUOTES[idx]!;
}

/**
 * Pick N distinct quotes deterministically for a given seed — used by
 * the auth-side panel so two people viewing on the same day see the same
 * pair, but the pair rotates across days.
 */
export function pickQuotes(count: number, seedOffset = 0): Quote[] {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 0));
  const now = new Date();
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86_400_000);
  const picks: Quote[] = [];
  for (let i = 0; i < Math.min(count, QUOTES.length); i++) {
    const idx = (dayOfYear + seedOffset + i * 7) % QUOTES.length;
    picks.push(QUOTES[idx]!);
  }
  return picks;
}
