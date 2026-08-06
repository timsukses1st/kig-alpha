// Halaman publik — TIDAK butuh login. Beberapa formulir pendaftaran app
// (TikTok maupun Meta) meminta URL Terms of Service selain Privacy Policy.
// Disiapkan sekarang supaya tidak perlu bolak-balik mengisi ulang formulir.

export const metadata = {
  title: 'Terms of Service — Alpha by KIG',
  description: 'Terms governing the use of Alpha, an internal content operations tool.',
};

const EFFECTIVE_DATE = '6 August 2026';
const ENTITY = 'PT Kahfi Indo Group';
const CONTACT_EMAIL = 'kahficorpadvertising@gmail.com';

const page: React.CSSProperties = {
  maxWidth: 780,
  margin: '0 auto',
  padding: '56px 22px 96px',
  lineHeight: 1.75,
};
const h1: React.CSSProperties = { fontSize: 28, marginBottom: 6, letterSpacing: '-0.02em' };
const h2: React.CSSProperties = { fontSize: 17, margin: '34px 0 10px', color: 'var(--text)' };
const p: React.CSSProperties = { color: 'var(--text-2)', marginBottom: 12, fontSize: 14.5 };
const li: React.CSSProperties = { color: 'var(--text-2)', marginBottom: 7, fontSize: 14.5 };
const ul: React.CSSProperties = { paddingLeft: 20, marginBottom: 12 };
const meta: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--text-3)',
  fontFamily: 'var(--mono)',
  letterSpacing: '.04em',
};
const hr: React.CSSProperties = {
  border: 0,
  borderTop: '1px solid var(--border)',
  margin: '48px 0 40px',
};

export default function TermsPage() {
  return (
    <main style={page}>
      <div style={meta}>ALPHA — CONTENT LAUNCH SYSTEM</div>
      <h1 style={h1}>Terms of Service</h1>
      <div style={meta}>
        Effective {EFFECTIVE_DATE} · {ENTITY}
      </div>

      <h2 style={h2}>1. Scope</h2>
      <p style={p}>
        Alpha is an internal tool operated by {ENTITY}. Access is granted only to employees and
        contractors of {ENTITY} and its business units. There is no public sign-up, no free tier, and
        no paid subscription. These terms govern that internal use.
      </p>

      <h2 style={h2}>2. Accounts</h2>
      <ul style={ul}>
        <li style={li}>
          Accounts are created and assigned by an administrator. Users may not share credentials.
        </li>
        <li style={li}>
          Each account is scoped to specific projects; users may only view data for projects they are
          assigned to.
        </li>
        <li style={li}>Access is revoked when a user leaves the organisation.</li>
      </ul>

      <h2 style={h2}>3. Acceptable use</h2>
      <p style={p}>
        Users must not attempt to access data outside their assigned projects, extract data for use
        outside the organisation, or interfere with the operation of the service. Advertising data
        retrieved from platform APIs is confidential business information and must not be published
        or shared externally.
      </p>

      <h2 style={h2}>4. Platform data</h2>
      <p style={p}>
        Alpha reads advertising performance data from the TikTok Marketing API and the Meta Marketing
        API for accounts we own or are authorised to manage. Our handling of that data is described
        in the{' '}
        <a href="/privacy" style={{ color: 'var(--accent)' }}>
          Privacy Policy
        </a>
        . We comply with the developer terms and platform policies of each provider, and access can
        be revoked by the account administrator at any time.
      </p>

      <h2 style={h2}>5. Availability</h2>
      <p style={p}>
        Alpha is provided on an as-is basis for internal use. We do not offer an uptime guarantee.
        Data retrieved from third-party APIs may be delayed, incomplete, or restated by the platform;
        figures shown in Alpha should be treated as reporting aids, not as the authoritative billing
        record. The advertising platform&rsquo;s own billing statement always prevails.
      </p>

      <h2 style={h2}>6. Changes</h2>
      <p style={p}>
        These terms may be updated as the tool evolves. The effective date at the top reflects the
        latest version.
      </p>

      <h2 style={h2}>7. Contact</h2>
      <p style={p}>
        Questions can be sent to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <hr style={hr} />
      <div style={meta}>
        <a href="/privacy" style={{ color: 'var(--accent)' }}>
          Privacy Policy
        </a>
        {' · '}
        <a href="/" style={{ color: 'var(--accent)' }}>
          Alpha
        </a>
      </div>
    </main>
  );
}
