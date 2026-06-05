/**
 * Curated role-family catalog with everything each provider needs to do
 * a smart per-role search:
 *   - id: canonical, URL-safe key stored in users.role_family
 *   - label: what the user sees in the dropdown
 *   - group: how they're grouped in the picker (Engineering, Product, etc.)
 *   - adzunaCategory: Adzuna's category slug for this role family
 *   - greenhouseSignals: title keywords that flag a job as relevant
 *     even when the user's exact query doesn't match
 *
 * The same id is the source of truth for the SQL column — no DB enum to
 * keep in sync. We dropped the role_family CHECK constraint in migration
 * 0003 so adding new roles here just works.
 */

export type RoleFamily = {
  id: string;
  label: string;
  group:
    | 'Engineering'
    | 'Product'
    | 'Design'
    | 'Data & AI'
    | 'Marketing'
    | 'Operations'
    | 'Sales & Customer'
    | 'People & Finance'
    | 'Other';
  /** Adzuna category slug, or null if no good match */
  adzunaCategory: string | null;
  /** Lowercase signal words for Greenhouse title matching */
  greenhouseSignals: string[];
};

export const ROLE_FAMILIES: RoleFamily[] = [
  // ----------- Engineering -----------
  { id: 'engineering',  label: 'Software Engineering (general)', group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['engineer', 'developer', 'swe', 'software'] },
  { id: 'backend',      label: 'Backend Engineering',             group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['backend', 'back-end', 'server', 'api', 'microservices'] },
  { id: 'frontend',     label: 'Frontend Engineering',            group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['frontend', 'front-end', 'react', 'vue', 'angular', 'web engineer'] },
  { id: 'fullstack',    label: 'Fullstack Engineering',           group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['fullstack', 'full-stack', 'full stack'] },
  { id: 'mobile',       label: 'Mobile Engineering (iOS/Android)', group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['ios', 'android', 'mobile engineer', 'swift', 'kotlin', 'react native', 'flutter'] },
  { id: 'devops',       label: 'DevOps / SRE / Platform',         group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['devops', 'sre', 'site reliability', 'platform engineer', 'infrastructure', 'kubernetes'] },
  { id: 'security',     label: 'Security Engineering',            group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['security engineer', 'infosec', 'appsec', 'application security', 'cybersecurity'] },
  { id: 'qa',           label: 'QA / Test Engineering',           group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['qa', 'quality', 'sdet', 'test engineer', 'automation engineer'] },
  { id: 'embedded',     label: 'Embedded / Firmware',             group: 'Engineering', adzunaCategory: 'engineering-jobs', greenhouseSignals: ['embedded', 'firmware', 'hardware engineer'] },
  { id: 'engineering-manager', label: 'Engineering Manager',      group: 'Engineering', adzunaCategory: 'it-jobs', greenhouseSignals: ['engineering manager', 'eng manager', 'em,', 'em '] },

  // ----------- Product -----------
  { id: 'product',           label: 'Product Management (general)', group: 'Product', adzunaCategory: 'it-jobs', greenhouseSignals: ['product manager', 'pm,', 'pm '] },
  { id: 'growth-pm',         label: 'Growth Product Manager',       group: 'Product', adzunaCategory: 'it-jobs', greenhouseSignals: ['growth pm', 'growth product manager', 'growth product'] },
  { id: 'technical-pm',      label: 'Technical Product Manager',    group: 'Product', adzunaCategory: 'it-jobs', greenhouseSignals: ['technical pm', 'technical product manager', 'tpm'] },
  { id: 'product-marketing', label: 'Product Marketing',            group: 'Product', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['product marketing', 'pmm'] },

  // ----------- Design -----------
  { id: 'product-design',  label: 'Product Design (UX/UI)',  group: 'Design', adzunaCategory: 'creative-design-jobs', greenhouseSignals: ['product designer', 'ux designer', 'ui designer', 'senior designer'] },
  { id: 'visual-design',   label: 'Visual / Brand Design',   group: 'Design', adzunaCategory: 'creative-design-jobs', greenhouseSignals: ['visual designer', 'graphic designer', 'brand designer', 'creative designer'] },
  { id: 'ux-research',     label: 'UX Research',             group: 'Design', adzunaCategory: 'creative-design-jobs', greenhouseSignals: ['ux researcher', 'user researcher', 'design research'] },
  { id: 'content-design',  label: 'Content Design / UX Writing', group: 'Design', adzunaCategory: 'creative-design-jobs', greenhouseSignals: ['content designer', 'ux writer', 'content design'] },

  // ----------- Data & AI -----------
  { id: 'data-scientist',  label: 'Data Science',                 group: 'Data & AI', adzunaCategory: 'it-jobs', greenhouseSignals: ['data scientist', 'applied scientist'] },
  { id: 'data-engineer',   label: 'Data Engineering',             group: 'Data & AI', adzunaCategory: 'it-jobs', greenhouseSignals: ['data engineer', 'etl', 'data pipeline', 'analytics engineer'] },
  { id: 'data-analyst',    label: 'Data Analyst / BI',            group: 'Data & AI', adzunaCategory: 'it-jobs', greenhouseSignals: ['data analyst', 'business intelligence', 'bi analyst', 'business analyst'] },
  { id: 'ml-engineer',     label: 'Machine Learning Engineer',    group: 'Data & AI', adzunaCategory: 'it-jobs', greenhouseSignals: ['machine learning engineer', 'ml engineer', 'mlops', 'ai engineer'] },
  { id: 'ml-research',     label: 'ML / AI Research Scientist',   group: 'Data & AI', adzunaCategory: 'it-jobs', greenhouseSignals: ['research scientist', 'ai researcher', 'machine learning scientist'] },

  // ----------- Marketing -----------
  { id: 'marketing',             label: 'Marketing (general)',          group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['marketing manager', 'marketing lead'] },
  { id: 'growth-marketing',      label: 'Growth Marketing',             group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['growth marketing', 'demand gen', 'lifecycle marketing'] },
  { id: 'content-marketing',     label: 'Content Marketing / Writing',  group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['content marketing', 'content writer', 'copywriter', 'content strategist'] },
  { id: 'brand-marketing',       label: 'Brand / Social Marketing',     group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['brand marketing', 'social media', 'community manager'] },
  { id: 'performance-marketing', label: 'Performance / Paid Marketing', group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['performance marketing', 'paid acquisition', 'paid media', 'sem'] },
  { id: 'seo',                   label: 'SEO',                          group: 'Marketing', adzunaCategory: 'pr-advertising-marketing-jobs', greenhouseSignals: ['seo specialist', 'seo manager', 'search engine optimization'] },

  // ----------- Operations -----------
  { id: 'business-ops',     label: 'Business / Strategy Operations', group: 'Operations', adzunaCategory: null, greenhouseSignals: ['business operations', 'biz ops', 'strategy ops'] },
  { id: 'program-manager',  label: 'Program Manager (technical)',    group: 'Operations', adzunaCategory: 'it-jobs', greenhouseSignals: ['program manager', 'technical program manager', 'tpm'] },
  { id: 'project-manager',  label: 'Project Manager / Scrum Master', group: 'Operations', adzunaCategory: null, greenhouseSignals: ['project manager', 'scrum master', 'agile coach'] },
  { id: 'chief-of-staff',   label: 'Chief of Staff',                 group: 'Operations', adzunaCategory: null, greenhouseSignals: ['chief of staff'] },

  // ----------- Sales & Customer -----------
  { id: 'sales',              label: 'Sales / Account Executive',  group: 'Sales & Customer', adzunaCategory: 'sales-jobs', greenhouseSignals: ['account executive', 'enterprise sales', 'ae,', 'ae '] },
  { id: 'sdr',                label: 'SDR / BDR',                  group: 'Sales & Customer', adzunaCategory: 'sales-jobs', greenhouseSignals: ['sdr', 'bdr', 'sales development', 'business development representative'] },
  { id: 'solutions-engineer', label: 'Solutions / Sales Engineer', group: 'Sales & Customer', adzunaCategory: 'it-jobs', greenhouseSignals: ['solutions engineer', 'sales engineer', 'pre-sales'] },
  { id: 'partnerships',       label: 'Partnerships / BD',          group: 'Sales & Customer', adzunaCategory: 'sales-jobs', greenhouseSignals: ['partnerships', 'business development', 'strategic partnerships'] },
  { id: 'customer-success',   label: 'Customer Success',           group: 'Sales & Customer', adzunaCategory: null, greenhouseSignals: ['customer success', 'cs manager', 'csm'] },
  { id: 'customer-support',   label: 'Support / Support Engineering', group: 'Sales & Customer', adzunaCategory: 'it-jobs', greenhouseSignals: ['customer support', 'support engineer', 'technical support'] },

  // ----------- People & Finance -----------
  { id: 'recruiting',  label: 'Recruiting / Talent',     group: 'People & Finance', adzunaCategory: 'hr-jobs',                  greenhouseSignals: ['recruiter', 'talent acquisition', 'sourcer'] },
  { id: 'people-ops',  label: 'People Ops / HR',         group: 'People & Finance', adzunaCategory: 'hr-jobs',                  greenhouseSignals: ['people operations', 'human resources', 'hrbp'] },
  { id: 'finance',     label: 'Finance / Accounting',    group: 'People & Finance', adzunaCategory: 'accounting-finance-jobs',  greenhouseSignals: ['finance', 'accounting', 'fp&a', 'controller'] },
  { id: 'legal',       label: 'Legal / Compliance',      group: 'People & Finance', adzunaCategory: null,                       greenhouseSignals: ['legal counsel', 'general counsel', 'compliance', 'legal manager'] },

  // ----------- Other -----------
  { id: 'other', label: 'Something else', group: 'Other', adzunaCategory: null, greenhouseSignals: [] },
];

/** Set of all valid role family ids — used by server actions to validate input. */
export const ROLE_FAMILY_IDS: Set<string> = new Set(ROLE_FAMILIES.map((r) => r.id));

/** Lookup by id. Returns undefined for unknown ids. */
export function findRoleFamily(id: string | null | undefined): RoleFamily | undefined {
  if (!id) return undefined;
  return ROLE_FAMILIES.find((r) => r.id === id);
}

/**
 * Does the user's job-search query string already hint at this role family?
 * Used to decide whether to keep the résumé-derived query or override it
 * with the family's preferred keyword (e.g. when the résumé still says
 * "Solution Engineer" but the user has picked Partnerships).
 */
export function queryMatchesFamily(query: string, rf: RoleFamily): boolean {
  const q = query.toLowerCase();
  return rf.greenhouseSignals.some((sig) => q.includes(sig.toLowerCase()));
}

/**
 * A clean keyword phrase for searching jobs in this role family. Drops the
 * "/ alt name" and "(general)" suffix from the label so we send providers
 * something like "Partnerships" rather than "Partnerships / BD".
 */
export function familyQuery(rf: RoleFamily): string {
  return rf.label
    .replace(/\s*\([^)]*\)\s*$/, '')
    .split(' / ')[0]!
    .trim();
}

/** Group families for the dropdown's <optgroup>s. Preserves the canonical order. */
export function roleFamiliesByGroup(): { group: string; items: RoleFamily[] }[] {
  const order: RoleFamily['group'][] = [
    'Engineering',
    'Product',
    'Design',
    'Data & AI',
    'Marketing',
    'Operations',
    'Sales & Customer',
    'People & Finance',
    'Other',
  ];
  return order.map((g) => ({
    group: g,
    items: ROLE_FAMILIES.filter((r) => r.group === g),
  }));
}
