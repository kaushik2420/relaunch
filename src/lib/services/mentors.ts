import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Mentor directory service. All writes go through the service-role
 * admin client (called from server actions / admin routes only).
 * Reads for the user-facing /mentors page are also service-role since
 * mentor profiles are public within the app.
 */

export interface Mentor {
  id: string;
  name: string;
  headline: string;
  bio: string | null;
  avatarUrl: string | null;
  calendarUrl: string;
  linkedinUrl: string | null;
  expertise: string[];
  isActive: boolean;
  displayOrder: number;
  sessionLengthMinutes: number | null;
  sessionPriceNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawMentor {
  id: string;
  name: string;
  headline: string;
  bio: string | null;
  avatar_url: string | null;
  calendar_url: string;
  linkedin_url: string | null;
  expertise: string[] | null;
  is_active: boolean;
  display_order: number;
  session_length_minutes: number | null;
  session_price_note: string | null;
  created_at: string;
  updated_at: string;
}

function toMentor(r: RawMentor): Mentor {
  return {
    id: r.id,
    name: r.name,
    headline: r.headline,
    bio: r.bio,
    avatarUrl: r.avatar_url,
    calendarUrl: r.calendar_url,
    linkedinUrl: r.linkedin_url,
    expertise: r.expertise ?? [],
    isActive: r.is_active,
    displayOrder: r.display_order,
    sessionLengthMinutes: r.session_length_minutes,
    sessionPriceNote: r.session_price_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** User-facing: list only active mentors, sorted by display_order asc
 *  then newest first as tiebreak. */
export async function listActiveMentors(): Promise<Mentor[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('mentors')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[mentors] listActiveMentors failed', error);
    return [];
  }
  return (data ?? []).map((r) => toMentor(r as RawMentor));
}

/** Admin: list everything, including deactivated. */
export async function listAllMentors(): Promise<Mentor[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('mentors')
    .select('*')
    .order('is_active', { ascending: false })
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[mentors] listAllMentors failed', error);
    return [];
  }
  return (data ?? []).map((r) => toMentor(r as RawMentor));
}

export async function getMentor(id: string): Promise<Mentor | null> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('mentors')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data ? toMentor(data as RawMentor) : null;
}

export interface MentorInput {
  id?: string; // present = update, absent = insert
  name: string;
  headline: string;
  bio?: string | null;
  avatarUrl?: string | null;
  calendarUrl: string;
  linkedinUrl?: string | null;
  expertise: string[];
  isActive: boolean;
  displayOrder: number;
  sessionLengthMinutes?: number | null;
  sessionPriceNote?: string | null;
}

export async function upsertMentor(input: MentorInput): Promise<string> {
  const admin = supabaseAdmin();
  const row = {
    name: input.name.trim(),
    headline: input.headline.trim(),
    bio: input.bio?.trim() || null,
    avatar_url: input.avatarUrl?.trim() || null,
    calendar_url: input.calendarUrl.trim(),
    linkedin_url: input.linkedinUrl?.trim() || null,
    expertise: input.expertise,
    is_active: input.isActive,
    display_order: input.displayOrder,
    session_length_minutes: input.sessionLengthMinutes ?? null,
    session_price_note: input.sessionPriceNote?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await admin
      .from('mentors')
      .update(row)
      .eq('id', input.id)
      .select('id')
      .single();
    if (error) throw new Error(`Update mentor failed: ${error.message}`);
    return data.id as string;
  }
  const { data, error } = await admin
    .from('mentors')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`Insert mentor failed: ${error.message}`);
  return data.id as string;
}

export async function setMentorActive(id: string, isActive: boolean): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin
    .from('mentors')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`setMentorActive failed: ${error.message}`);
}

export async function logMentorClick(input: {
  mentorId: string;
  userId?: string | null;
  fromPage?: string | null;
}): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin.from('mentor_link_clicks').insert({
    mentor_id: input.mentorId,
    user_id: input.userId ?? null,
    from_page: input.fromPage ?? null,
  });
  if (error) {
    // Non-fatal — log-and-swallow. Click-log is best-effort telemetry.
    console.warn('[mentors] logMentorClick failed', error.message);
  }
}

/** Admin: click totals per mentor over the last N days. */
export async function mentorClickCounts(
  days = 30,
): Promise<Record<string, number>> {
  const admin = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await admin
    .from('mentor_link_clicks')
    .select('mentor_id')
    .gte('clicked_at', since);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = r.mentor_id as string;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * Canonical expertise tag list. Admin UI can free-form add anything,
 * but suggesting from a stable set keeps the filter UI on /mentors
 * predictable. Grouped by intent so the picker can chunk them.
 */
export const EXPERTISE_TAGS = {
  Domain: [
    'Product Management',
    'Engineering Leadership',
    'Design',
    'Data & Analytics',
    'Marketing',
    'Sales & GTM',
    'Operations',
    'People & HR',
    'Finance',
    'Founder / Startup',
  ],
  'Career Support': [
    'Layoff Recovery',
    'Career Pivot',
    'Interview Prep',
    'Salary Negotiation',
    'Resume & LinkedIn',
    'Leadership Coaching',
    'Confidence & Mindset',
    'Networking',
  ],
} as const;

/** Flat list of all suggested tags across all groups. */
export const ALL_EXPERTISE_TAGS: string[] = Object.values(EXPERTISE_TAGS).flatMap(
  (v) => v as unknown as string[],
);
