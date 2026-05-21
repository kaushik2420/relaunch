import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { UserProfile, TailoredResume, CoverLetter } from '@/lib/types';

/**
 * Polished two-column resume PDF, rendered with @react-pdf/renderer.
 *
 * Pure JS — no headless browser, no external API, no per-document cost.
 * Uses only the built-in Helvetica family so there is zero font-loading
 * risk in the serverless cron.
 *
 * Layout: full-width header (name / headline / contact), then a tinted
 * left sidebar (skills, education, links) beside the main column
 * (summary, experience).
 */

const ACCENT = '#5B6CFF';
const INK = '#1F2430';
const MUTE = '#5B6477';
const SIDEBAR_BG = '#EEF0FF';

const s = StyleSheet.create({
  // NOTE: we deliberately set NO lineHeight anywhere. react-pdf treats a
  // directly-set lineHeight as a multiplier but inherits it as a computed
  // absolute — that inconsistency causes overlaps / double-spacing. Using
  // the font's natural line metrics everywhere is clean and predictable.
  page: {
    paddingVertical: 38,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: INK,
  },
  name: { fontSize: 23, fontFamily: 'Helvetica-Bold', color: INK, letterSpacing: 0.3 },
  headline: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: ACCENT, marginTop: 5 },
  contact: { fontSize: 8.5, color: MUTE, marginTop: 6 },
  divider: { borderBottomWidth: 2, borderBottomColor: ACCENT, marginTop: 10, marginBottom: 15 },

  row: { flexDirection: 'row' },
  sidebar: { width: '34%', backgroundColor: SIDEBAR_BG, borderRadius: 4, padding: 13 },
  main: { width: '66%', paddingLeft: 17 },

  heading: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: ACCENT,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    borderBottomWidth: 0.8,
    borderBottomColor: ACCENT,
    paddingBottom: 2.5,
    marginBottom: 7,
  },
  headingGap: { marginTop: 15 },

  skill: { marginBottom: 4.5 },
  eduDegree: { fontFamily: 'Helvetica-Bold' },
  eduMeta: { color: MUTE, marginBottom: 9 },
  link: { color: ACCENT, marginBottom: 4.5 },

  summary: { marginBottom: 4 },

  expItem: { marginBottom: 12 },
  expTitle: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },
  expCompany: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: ACCENT, marginTop: 2.5, marginBottom: 5 },
  expDates: { fontFamily: 'Helvetica', color: MUTE },

  bulletRow: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 10, color: ACCENT },
  bulletText: { flex: 1 },
});

function ResumeDocument({
  profile,
  tailored,
}: {
  profile: UserProfile;
  tailored: TailoredResume;
}) {
  const name = (profile.fullName || 'Your Name').trim();
  const headline = (profile.headline || '').trim();
  const skills = tailored.highlightedSkills?.length
    ? tailored.highlightedSkills
    : profile.skills ?? [];
  const education = profile.education ?? [];
  const links = linkItems(profile);
  const experience = tailored.experienceBullets ?? [];

  return (
    <Document title={`${name} — Resume`} author={name}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View>
          <Text style={s.name}>{name}</Text>
          {headline ? <Text style={s.headline}>{headline}</Text> : null}
          <Text style={s.contact}>{contactLine(profile)}</Text>
        </View>
        <View style={s.divider} />

        <View style={s.row}>
          {/* Sidebar */}
          <View style={s.sidebar}>
            {skills.length > 0 && (
              <View>
                <Text style={s.heading}>Core Skills</Text>
                {skills.map((sk, i) => (
                  <Text key={i} style={s.skill}>• {sk}</Text>
                ))}
              </View>
            )}

            {education.length > 0 && (
              <View style={s.headingGap}>
                <Text style={s.heading}>Education</Text>
                {education.map((e, i) => (
                  <View key={i}>
                    <Text style={s.eduDegree}>{e.degree || 'Degree'}</Text>
                    <Text style={s.eduMeta}>
                      {[e.school, e.year].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {links.length > 0 && (
              <View style={s.headingGap}>
                <Text style={s.heading}>Links</Text>
                {links.map((l, i) => (
                  <Text key={i} style={s.link}>{l}</Text>
                ))}
              </View>
            )}
          </View>

          {/* Main column */}
          <View style={s.main}>
            {tailored.summary?.trim() ? (
              <View>
                <Text style={s.heading}>Summary</Text>
                <Text style={s.summary}>{tailored.summary.trim()}</Text>
              </View>
            ) : null}

            {experience.length > 0 && (
              <View style={tailored.summary?.trim() ? s.headingGap : undefined}>
                <Text style={s.heading}>Experience</Text>
                {experience.map((e, i) => {
                  const dates = datesFor(profile, e.company);
                  return (
                    <View key={i} style={s.expItem} wrap={false}>
                      <Text style={s.expTitle}>{e.title || 'Role'}</Text>
                      <Text style={s.expCompany}>
                        {e.company || ''}
                        {dates ? <Text style={s.expDates}>{`  ·  ${dates}`}</Text> : null}
                      </Text>
                      {(e.bullets ?? []).map((b, j) => (
                        <View key={j} style={s.bulletRow}>
                          <Text style={s.bulletDot}>•</Text>
                          <Text style={s.bulletText}>{b}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
}

/** Render the tailored resume to a PDF buffer. */
export async function renderResumePdf(
  profile: UserProfile,
  tailored: TailoredResume,
): Promise<Buffer> {
  return renderToBuffer(<ResumeDocument profile={profile} tailored={tailored} />);
}

// ---------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------

const cl = StyleSheet.create({
  page: {
    paddingVertical: 54,
    paddingHorizontal: 56,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    color: INK,
  },
  name: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: INK, letterSpacing: 0.3 },
  contact: { fontSize: 8.5, color: MUTE, marginTop: 5 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: ACCENT, marginTop: 11, marginBottom: 22 },
  date: { fontSize: 9.5, color: MUTE, marginBottom: 16 },
  subject: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: ACCENT, marginBottom: 18 },
  greeting: { marginBottom: 12 },
  para: { marginBottom: 11 },
  closing: { marginTop: 6 },
  signName: { fontFamily: 'Helvetica-Bold', marginTop: 2 },
});

function CoverLetterDocument({
  profile,
  letter,
  company,
  role,
}: {
  profile: UserProfile;
  letter: CoverLetter;
  company: string;
  role: string;
}) {
  const name = (profile.fullName || 'Your Name').trim();
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Document title={`${name} — Cover Letter`} author={name}>
      <Page size="A4" style={cl.page}>
        <Text style={cl.name}>{name}</Text>
        <Text style={cl.contact}>{contactLine(profile)}</Text>
        <View style={cl.divider} />

        <Text style={cl.date}>{today}</Text>
        <Text style={cl.subject}>
          Re: Application for {role}
          {company ? ` at ${company}` : ''}
        </Text>

        <Text style={cl.greeting}>{letter.greeting}</Text>
        {letter.paragraphs.map((p, i) => (
          <Text key={i} style={cl.para}>{p}</Text>
        ))}

        <Text style={cl.closing}>{letter.closing}</Text>
        <Text style={cl.signName}>{name}</Text>
      </Page>
    </Document>
  );
}

/** Render the tailored cover letter to a PDF buffer. */
export async function renderCoverLetterPdf(
  profile: UserProfile,
  letter: CoverLetter,
  company: string,
  role: string,
): Promise<Buffer> {
  return renderToBuffer(
    <CoverLetterDocument profile={profile} letter={letter} company={company} role={role} />,
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function contactLine(profile: UserProfile): string {
  const l = profile.links ?? {};
  return [l.email, l.phone, profile.location].filter(Boolean).join('   ·   ');
}

function linkItems(profile: UserProfile): string[] {
  const l = profile.links ?? {};
  return [l.linkedin, l.github, l.portfolio]
    .filter((x): x is string => !!x)
    .map((u) => u.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
}

/** Best-effort: pull "from – to" dates from the original profile by company name. */
function datesFor(profile: UserProfile, company: string): string {
  const match = (profile.experience ?? []).find(
    (x) => x.company?.trim().toLowerCase() === company?.trim().toLowerCase(),
  );
  if (!match) return '';
  const from = match.from?.trim() ?? '';
  const to = match.to?.trim() ?? '';
  if (from && to) return `${from} – ${to}`;
  return from || to || '';
}
