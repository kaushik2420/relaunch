/**
 * Shared canonical types. Provider implementations map their raw
 * responses onto these shapes so the rest of the app stays clean.
 */

export interface UserProfile {
  fullName: string;
  headline?: string;
  seniority: 'junior' | 'mid' | 'senior' | 'staff' | 'principal';
  yearsExperience: number;
  location?: string;
  skills: string[];
  experience: {
    company: string;
    title: string;
    from: string;
    to: string;
    bullets: string[];
  }[];
  education?: {
    school: string;
    degree: string;
    year?: string;
  }[];
  links?: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    email?: string;
    phone?: string;
  };
}

export interface UserPreferences {
  locations: string[];
  workModes: ('remote' | 'hybrid' | 'onsite' | 'any')[];
  targetCtc?: string;
  phone?: string;
  noticePeriod?: string;
  notes?: string;
  emailFrequency: 'daily' | '2days' | 'weekly' | 'realtime' | 'paused';
  emailTime: string; // HH:MM
  timezone: string;
}

export interface JobPosting {
  id: string;               // namespaced: 'adzuna:123' / 'gh:razorpay:456'
  source: 'adzuna' | 'jooble' | 'greenhouse' | 'lever' | 'jsearch' | string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedAt: string;         // ISO
  salary?: { min: number; max: number; currency: string; cadence: 'monthly' | 'yearly' };
  workMode: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  keywords?: string[];
}

export interface TailoredResume {
  summary: string;
  highlightedSkills: string[];
  experienceBullets: { company: string; title: string; bullets: string[] }[];
  rationale: string;
  removedSections: string[];
}

export interface Referrer {
  name: string;
  role: string;
  linkedinUrl?: string;
  sharedContext?: string; // "worked at TechFlow 2021-23"
}

export interface TailoredJobMatch {
  job: JobPosting;
  matchPercent: number;
  reasons: string[];
  tailored: TailoredResume;
  tailoredResumeUrl?: string;   // URL to PDF in user's Drive
  referrers: Referrer[];
  inmailDraft?: { subject: string; body: string };
  expectedCtc?: string;
}
