/**
 * Curated course catalog. We deliberately keep this small (handpicked
 * by-trusted-sources) rather than letting the LLM invent course URLs —
 * Claude is good at identifying skill gaps but will hallucinate course
 * names and links if asked for them directly.
 *
 * To add a skill: lowercase the key, add 1-3 course entries.
 * Keys should match the canonical skill names Claude returns in its
 * gap analysis (we lowercase + fuzzy-match on the receiving side).
 */

export interface Course {
  title: string;
  provider: string;
  duration: string; // human-readable, e.g. "6 hrs", "4 weeks"
  cost: string; // "Free" | "₹600" | "$49" etc.
  url: string;
}

export const COURSE_CATALOG: Record<string, Course[]> = {
  // ---------- Analytics & data ----------
  'mixpanel': [
    { title: 'Mixpanel Bootcamp', provider: 'Mixpanel Academy', duration: '~4 hrs', cost: 'Free', url: 'https://mixpanel.com/academy' },
    { title: 'Product Analytics with Amplitude', provider: 'Coursera', duration: '8 hrs', cost: 'Free (audit)', url: 'https://www.coursera.org/learn/product-analytics' },
  ],
  'sql': [
    { title: 'SQL for Data Analysis', provider: 'Mode Analytics', duration: '6 hrs', cost: 'Free', url: 'https://mode.com/sql-tutorial' },
    { title: 'SQL Bootcamp', provider: 'Udemy', duration: '~9 hrs', cost: '₹500', url: 'https://www.udemy.com/topic/sql/' },
  ],
  'product analytics': [
    { title: 'Product Analytics', provider: 'Reforge', duration: '4 weeks', cost: '$995', url: 'https://www.reforge.com/programs/analytics-for-product-managers' },
    { title: 'Analytics for PMs', provider: 'Pendo Mind', duration: 'Free', cost: 'Free', url: 'https://pendo.io/resources/' },
  ],
  'experimentation': [
    { title: 'Trustworthy A/B Tests', provider: 'Reforge', duration: '4 weeks', cost: '$995', url: 'https://www.reforge.com/programs/experimentation' },
    { title: 'A/B Testing for Beginners', provider: 'Udacity', duration: '~12 hrs', cost: 'Free', url: 'https://www.udacity.com/course/ab-testing--ud257' },
  ],
  'a/b testing': [
    { title: 'A/B Testing for Beginners', provider: 'Udacity', duration: '~12 hrs', cost: 'Free', url: 'https://www.udacity.com/course/ab-testing--ud257' },
  ],

  // ---------- AI / LLM ----------
  'generative ai': [
    { title: 'Generative AI for Everyone', provider: 'Andrew Ng · Coursera', duration: '6 hrs', cost: 'Free (audit)', url: 'https://www.coursera.org/learn/generative-ai-for-everyone' },
    { title: 'Building LLM Apps', provider: 'DeepLearning.AI', duration: '5 hrs', cost: 'Free', url: 'https://www.deeplearning.ai/short-courses/' },
  ],
  'llm': [
    { title: 'Building LLM Apps', provider: 'DeepLearning.AI', duration: '5 hrs', cost: 'Free', url: 'https://www.deeplearning.ai/short-courses/' },
    { title: 'LLM Engineering', provider: 'Anthropic Academy', duration: '4 hrs', cost: 'Free', url: 'https://www.anthropic.com/learn' },
  ],
  'prompt engineering': [
    { title: 'ChatGPT Prompt Engineering', provider: 'DeepLearning.AI', duration: '1.5 hrs', cost: 'Free', url: 'https://www.deeplearning.ai/short-courses/chatgpt-prompt-engineering-for-developers/' },
  ],
  'ai product management': [
    { title: 'AI Product Management', provider: 'Reforge', duration: '4 weeks', cost: '$995', url: 'https://www.reforge.com/programs/ai-product-management' },
    { title: 'AI for Product Managers', provider: 'Coursera', duration: '12 hrs', cost: 'Free (audit)', url: 'https://www.coursera.org/specializations/ai-for-product-managers' },
  ],

  // ---------- Engineering ----------
  'kubernetes': [
    { title: 'Kubernetes for Developers', provider: 'Linux Foundation', duration: '6 weeks', cost: '$299 (audit free)', url: 'https://training.linuxfoundation.org/training/kubernetes-for-developers/' },
    { title: 'KodeKloud Kubernetes', provider: 'KodeKloud', duration: '20 hrs', cost: 'Free tier', url: 'https://kodekloud.com/courses/kubernetes-for-the-absolute-beginners-hands-on/' },
  ],
  'system design': [
    { title: 'Designing Data-Intensive Apps', provider: 'Martin Kleppmann · book', duration: '3 weeks', cost: '₹600 (book)', url: 'https://dataintensive.net/' },
    { title: 'System Design Interview', provider: 'ByteByteGo', duration: 'Self-paced', cost: '$30/yr', url: 'https://bytebytego.com/' },
  ],
  'aws': [
    { title: 'AWS Cloud Practitioner', provider: 'AWS Skill Builder', duration: '~10 hrs', cost: 'Free', url: 'https://skillbuilder.aws/' },
  ],
  'docker': [
    { title: 'Docker for Beginners', provider: 'KodeKloud', duration: '5 hrs', cost: 'Free', url: 'https://kodekloud.com/courses/docker-for-the-absolute-beginner-hands-on-docker/' },
  ],
  'graphql': [
    { title: 'How to GraphQL', provider: 'Prisma', duration: '4 hrs', cost: 'Free', url: 'https://www.howtographql.com/' },
  ],
  'react': [
    { title: 'React Official Tutorial', provider: 'react.dev', duration: '~6 hrs', cost: 'Free', url: 'https://react.dev/learn' },
  ],
  'typescript': [
    { title: 'TypeScript Handbook', provider: 'typescriptlang.org', duration: '~4 hrs', cost: 'Free', url: 'https://www.typescriptlang.org/docs/handbook/intro.html' },
  ],

  // ---------- Domain ----------
  'credit risk': [
    { title: 'Credit Risk Modeling', provider: 'Coursera (DDI)', duration: '~12 hrs', cost: 'Free (audit)', url: 'https://www.coursera.org/learn/credit-risk-modeling' },
  ],
  'payments': [
    { title: 'How Payments Work', provider: 'Stripe Docs', duration: '~3 hrs read', cost: 'Free', url: 'https://stripe.com/docs/payments' },
  ],
  'fintech': [
    { title: 'Fintech Foundations', provider: 'Wharton (Coursera)', duration: '15 hrs', cost: 'Free (audit)', url: 'https://www.coursera.org/learn/wharton-fintech' },
  ],

  // ---------- Soft skills ----------
  'stakeholder management': [
    { title: 'Managing Up', provider: 'Reforge', duration: '4 weeks', cost: '$995', url: 'https://www.reforge.com/' },
  ],
  'storytelling': [
    { title: 'The Pyramid Principle', provider: 'Book by Barbara Minto', duration: '1 week read', cost: '₹800', url: 'https://en.wikipedia.org/wiki/Pyramid_principle' },
  ],
};

/**
 * Look up courses for a skill, tolerant of casing and minor wording.
 * Returns at most `max` results. Empty array if no curated entry exists —
 * caller can fall back to a generic Coursera search link.
 */
export function lookupCourses(skill: string, max = 3): Course[] {
  const lower = skill.toLowerCase().trim();

  // Exact key match
  if (COURSE_CATALOG[lower]) return COURSE_CATALOG[lower].slice(0, max);

  // Substring fuzzy: e.g. "Mixpanel / Amplitude" hits "mixpanel"
  for (const key of Object.keys(COURSE_CATALOG)) {
    if (lower.includes(key) || key.includes(lower)) {
      return COURSE_CATALOG[key]!.slice(0, max);
    }
  }
  return [];
}

export function genericSearchUrl(skill: string): string {
  const q = encodeURIComponent(skill);
  return `https://www.coursera.org/search?query=${q}`;
}
