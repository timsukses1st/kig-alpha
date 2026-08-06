// Halaman publik — TIDAK butuh login. Dibutuhkan saat mendaftarkan app di
// TikTok for Business Developer Portal & Meta for Developers; formulir mereka
// mewajibkan URL Privacy Policy yang bisa dibuka tanpa autentikasi.
//
// Sengaja tanpa 'use client' dan tanpa import komponen lain supaya halaman ini
// tetap bisa dibuka meski Supabase/auth sedang bermasalah — kalau reviewer
// membuka URL ini dan yang muncul layar login, pengajuan app bisa ditolak.

export const metadata = {
  title: 'Privacy Policy — Alpha by KIG',
  description:
    'How Alpha collects, uses, stores, and protects advertising data obtained from the TikTok Marketing API and the Meta Marketing API.',
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
const h2: React.CSSProperties = {
  fontSize: 17,
  margin: '34px 0 10px',
  letterSpacing: '-0.01em',
  color: 'var(--text)',
};
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
const card: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 14,
};

export default function PrivacyPolicyPage() {
  return (
    <main style={page}>
      <div style={meta}>ALPHA — CONTENT LAUNCH SYSTEM</div>
      <h1 style={h1}>Privacy Policy</h1>
      <div style={meta}>
        Effective {EFFECTIVE_DATE} · {ENTITY}
      </div>

      {/* ================= ENGLISH ================= */}

      <h2 style={h2}>1. Who we are</h2>
      <p style={p}>
        Alpha is an internal content operations tool built and operated by {ENTITY} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). It is used exclusively by our own employees and contractors to plan,
        publish, and report on marketing content. Alpha is not offered to the public, has no public
        sign-up, and is not sold or licensed to third parties.
      </p>

      <h2 style={h2}>2. What data Alpha accesses</h2>
      <p style={p}>
        Alpha connects to advertising platforms through their official APIs in order to read
        performance data for advertising accounts that we own or are authorised to manage.
        Specifically:
      </p>
      <div style={card}>
        <p style={{ ...p, marginBottom: 8, color: 'var(--text)', fontWeight: 700 }}>
          TikTok Marketing API
        </p>
        <ul style={ul}>
          <li style={li}>Advertiser account identifier and account name</li>
          <li style={li}>Campaign, ad group, and ad identifiers, names, objectives, and status</li>
          <li style={li}>Budget and schedule settings</li>
          <li style={li}>
            Aggregated performance metrics: spend, impressions, clicks, video views, reach,
            conversions, and derived rates such as CPM, CPC, and CTR
          </li>
        </ul>
        <p style={{ ...p, marginBottom: 8, color: 'var(--text)', fontWeight: 700 }}>
          Meta Marketing API
        </p>
        <ul style={{ ...ul, marginBottom: 0 }}>
          <li style={li}>Ad account identifier and account name</li>
          <li style={li}>Campaign, ad set, and ad identifiers, names, objectives, and status</li>
          <li style={li}>Budget and schedule settings</li>
          <li style={li}>
            Aggregated performance metrics: spend, impressions, clicks, reach, frequency, results,
            and derived rates such as CPM, CPC, and CTR
          </li>
        </ul>
      </div>
      <p style={p}>
        <strong style={{ color: 'var(--text)' }}>
          Alpha does not collect, request, or store personal data about individual platform users.
        </strong>{' '}
        We do not access follower lists, private messages, contact details, custom audiences, or any
        personally identifiable information. All advertising metrics we read are aggregated figures
        reported at the campaign, ad group, or ad level.
      </p>

      <h2 style={h2}>3. Why we access it</h2>
      <p style={p}>
        For internal reporting only. The data is displayed inside Alpha next to the corresponding
        content brief so our teams can see what a piece of content cost and how it performed,
        without exporting spreadsheets from each platform by hand. We do not use this data for
        advertising, profiling, resale, or any automated decision-making about individuals.
      </p>

      <h2 style={h2}>4. How the connection is authorised</h2>
      <p style={p}>
        Access is granted by an administrator of our own Business Center / Business Portfolio
        through the platform&rsquo;s standard authorisation flow. Access credentials are stored as
        encrypted server-side environment variables. They are never embedded in the browser, never
        exposed to end users, and never transmitted to any third party. All calls to platform APIs
        are made from our server, not from the user&rsquo;s device.
      </p>

      <h2 style={h2}>5. Where data is stored and how it is protected</h2>
      <ul style={ul}>
        <li style={li}>
          Data is stored in a managed PostgreSQL database (Supabase) and served through an
          application hosted on Vercel.
        </li>
        <li style={li}>All data is encrypted in transit using TLS and encrypted at rest.</li>
        <li style={li}>
          Database access is restricted by Row Level Security policies and explicit table-level
          grants. Anonymous access to advertising tables is revoked.
        </li>
        <li style={li}>
          Only authenticated employees whose account is assigned to the relevant project can view
          the data.
        </li>
      </ul>

      <h2 style={h2}>6. Sharing</h2>
      <p style={p}>
        We do not sell, rent, or share advertising data obtained through these APIs with any third
        party. The only processors involved are our infrastructure providers (Supabase and Vercel),
        which host the application and database on our behalf under their own security commitments.
      </p>

      <h2 style={h2}>7. Retention and deletion</h2>
      <p style={p}>
        Advertising performance data is retained for as long as it is useful for internal reporting
        and financial reconciliation. When authorisation is revoked, we stop retrieving new data
        immediately and delete the previously retrieved data associated with that account within 30
        days of a written request.
      </p>

      <h2 style={h2}>8. Revoking access</h2>
      <p style={p}>
        An administrator can disconnect Alpha at any time from the platform&rsquo;s own settings —
        TikTok Business Center or Meta Business Settings — without contacting us. Revocation takes
        effect immediately on the platform side.
      </p>

      <h2 style={h2}>9. Children</h2>
      <p style={p}>
        Alpha is an internal business tool. It is not directed at children and is not accessible to
        anyone outside our organisation.
      </p>

      <h2 style={h2}>10. Changes to this policy</h2>
      <p style={p}>
        If the scope of data we access changes, we will update this page and change the effective
        date shown at the top.
      </p>

      <h2 style={h2}>11. Contact</h2>
      <p style={p}>
        Questions about this policy or requests for deletion can be sent to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <hr style={hr} />

      {/* ================= BAHASA INDONESIA ================= */}

      <div style={meta}>VERSI BAHASA INDONESIA</div>
      <h1 style={{ ...h1, fontSize: 24, marginTop: 6 }}>Kebijakan Privasi</h1>
      <div style={meta}>
        Berlaku {EFFECTIVE_DATE} · {ENTITY}
      </div>

      <h2 style={h2}>1. Tentang kami</h2>
      <p style={p}>
        Alpha adalah alat kerja internal milik {ENTITY}, dipakai hanya oleh karyawan dan mitra kerja
        kami untuk merencanakan, menayangkan, dan melaporkan konten pemasaran. Alpha tidak dibuka
        untuk umum, tidak memiliki pendaftaran publik, dan tidak dijual maupun dilisensikan ke pihak
        lain.
      </p>

      <h2 style={h2}>2. Data yang diakses</h2>
      <p style={p}>
        Alpha terhubung ke platform periklanan melalui API resmi mereka untuk membaca data kinerja
        akun iklan yang kami miliki atau kelola secara sah: identitas dan nama akun iklan; nama,
        ID, tujuan, dan status campaign / ad group / iklan; pengaturan anggaran dan jadwal; serta
        angka kinerja agregat seperti biaya, tayangan, klik, jangkauan, penonton video, hasil, dan
        turunannya (CPM, CPC, CTR).
      </p>
      <p style={p}>
        <strong style={{ color: 'var(--text)' }}>
          Alpha tidak mengumpulkan atau menyimpan data pribadi pengguna platform.
        </strong>{' '}
        Kami tidak mengakses daftar pengikut, pesan pribadi, data kontak, custom audience, maupun
        informasi yang dapat mengidentifikasi seseorang. Seluruh angka yang kami baca bersifat
        agregat.
      </p>

      <h2 style={h2}>3. Tujuan penggunaan</h2>
      <p style={p}>
        Semata-mata untuk pelaporan internal. Data ditampilkan di dalam Alpha berdampingan dengan
        brief konten terkait, supaya tim bisa melihat biaya dan hasil sebuah konten tanpa mengekspor
        laporan satu per satu dari tiap platform. Data ini tidak dipakai untuk beriklan, membuat
        profil orang, dijual kembali, atau pengambilan keputusan otomatis atas individu.
      </p>

      <h2 style={h2}>4. Cara akses diberikan</h2>
      <p style={p}>
        Akses diberikan oleh admin Business Center / Business Portfolio milik kami sendiri melalui
        alur otorisasi resmi platform. Kredensial disimpan sebagai environment variable terenkripsi
        di sisi server, tidak pernah ditanam di browser, tidak pernah terlihat oleh pengguna, dan
        tidak pernah dikirim ke pihak ketiga.
      </p>

      <h2 style={h2}>5. Penyimpanan dan pengamanan</h2>
      <p style={p}>
        Data disimpan di basis data PostgreSQL terkelola (Supabase) dan disajikan lewat aplikasi
        yang di-hosting di Vercel. Seluruh data dienkripsi saat transit (TLS) maupun saat disimpan.
        Akses basis data dibatasi Row Level Security dan pemberian hak per tabel; akses anonim ke
        tabel iklan dicabut. Hanya karyawan terautentikasi yang ditugaskan pada project terkait yang
        dapat melihat datanya.
      </p>

      <h2 style={h2}>6. Pembagian data</h2>
      <p style={p}>
        Kami tidak menjual, menyewakan, atau membagikan data iklan hasil API ini kepada pihak
        ketiga. Satu-satunya pihak yang terlibat adalah penyedia infrastruktur kami (Supabase dan
        Vercel) yang menjalankan aplikasi dan basis data atas nama kami.
      </p>

      <h2 style={h2}>7. Retensi dan penghapusan</h2>
      <p style={p}>
        Data kinerja iklan disimpan selama masih dibutuhkan untuk pelaporan internal dan rekonsiliasi
        keuangan. Jika otorisasi dicabut, kami berhenti menarik data baru saat itu juga dan menghapus
        data terkait akun tersebut paling lambat 30 hari setelah permintaan tertulis.
      </p>

      <h2 style={h2}>8. Mencabut akses</h2>
      <p style={p}>
        Admin dapat memutus sambungan Alpha kapan saja langsung dari pengaturan platform — TikTok
        Business Center atau Meta Business Settings — tanpa perlu menghubungi kami. Pencabutan
        berlaku seketika di sisi platform.
      </p>

      <h2 style={h2}>9. Anak-anak</h2>
      <p style={p}>
        Alpha adalah alat kerja internal, tidak ditujukan untuk anak-anak, dan tidak dapat diakses
        oleh siapa pun di luar organisasi kami.
      </p>

      <h2 style={h2}>10. Perubahan kebijakan</h2>
      <p style={p}>
        Jika cakupan data yang kami akses berubah, halaman ini diperbarui beserta tanggal berlakunya.
      </p>

      <h2 style={h2}>11. Kontak</h2>
      <p style={p}>
        Pertanyaan atau permintaan penghapusan data dapat dikirim ke{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <hr style={hr} />
      <div style={meta}>
        <a href="/terms" style={{ color: 'var(--accent)' }}>
          Terms of Service
        </a>
        {' · '}
        <a href="/" style={{ color: 'var(--accent)' }}>
          Alpha
        </a>
      </div>
    </main>
  );
}
