// ============================================================================
// ALPHA — Admin User Management API
// Meniru pola SIGMA (users.js): verifikasi pemanggil via /auth/v1/user (kebal
// ES256), lalu pakai service_role untuk createUser/deleteUser/updateUserById.
// Service_role HANYA di server (env Sensitive), tidak pernah ke browser.
//
// ENV (Vercel kig-beta):
//   NEXT_PUBLIC_SUPABASE_URL (atau SUPABASE_URL)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY (atau SUPABASE_ANON_KEY)
//   SUPABASE_SERVICE_ROLE_KEY  <- SENSITIVE, server-only
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ROLES, TEAM_VALUES, VERTICAL_VALUES } from '@/lib/types';

// ----------------------------------------------------------------------------
// Daftar pilihan diambil LANGSUNG dari lib/types.ts, tidak disalin ke sini.
//
// Nilai yang diisi tapi tidak dikenal tetap DITOLAK, bukan diam-diam dijadikan
// null — dulu user tampak berhasil dibuat padahal tim/vertical-nya kosong.
//
// Tapi daftarnya dulu disalin ke file ini. Waktu 13 tim baru ditambahkan
// (19 Agustus), salinan itu tidak ikut diperbarui, jadi membuat user bertim HRD
// ditolak dengan pesan 'Team "hrd" tidak dikenal' — padahal tim itu sah di
// database maupun di dropdown-nya sendiri.
//
// Selama daftarnya disalin, cepat atau lambat pasti berbeda lagi. Sekarang
// satu-satunya tempat menambah tim adalah TEAM_LABEL di lib/types.ts
// (plus enum `app_team` di database) — server ikut sendiri.
// ----------------------------------------------------------------------------
const VALID_ROLES: string[] = ROLES;
const VALID_TEAMS: string[] = TEAM_VALUES;
// 'ALL' = lintas unit. Dipakai oleh can_see_all() di database.
const VALID_VERTICALS: string[] = VERTICAL_VALUES;

/**
 * Kosong / tidak diisi → null (sah, artinya "belum diatur").
 * Diisi tapi tidak dikenal → lempar error, jangan diam-diam dijadikan null.
 */
function pilihan(nilai: unknown, sah: string[], label: string): string | null {
  const v = typeof nilai === 'string' ? nilai.trim() : '';
  if (!v) return null;
  if (!sah.includes(v)) {
    throw new Error(`${label} "${v}" tidak dikenal. Pilihan yang sah: ${sah.join(', ')}.`);
  }
  return v;
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function POST(req: Request) {
  if (!SERVICE) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set di Vercel.' }, { status: 500 });
  if (!ANON || !SUPABASE_URL) return NextResponse.json({ error: 'URL/ANON key belum di-set.' }, { status: 500 });

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // ---- 1) Kenali pemanggil (metode ala scrape.js) ----
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'Tidak ada sesi login.' }, { status: 401 });

  let caller: { id: string; email: string } | null = null;
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (who.ok) {
      const u = await who.json();
      if (u && u.id) caller = { id: u.id, email: u.email };
    }
  } catch { /* invalid */ }
  if (!caller) return NextResponse.json({ error: 'Sesi tidak valid, login ulang.' }, { status: 401 });

  // ---- 2) Pastikan superadmin ----
  const { data: profile } = await admin.from('profiles').select('role').eq('id', caller.id).single();
  if (!profile || profile.role !== 'superadmin') {
    return NextResponse.json({ error: 'Hanya superadmin yang boleh mengelola user.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  try {
    // ---- CREATE ----
    if (action === 'create') {
      const email = (body.email || '').trim();
      const password = body.password || '';
      const full_name = (body.full_name || '').trim() || null;
      // role sengaja tetap jatuh ke 'tim' kalau kosong — itu default paling
      // sempit, jadi kelalaian menyempitkan akses, bukan melebarkan.
      const role = VALID_ROLES.includes(body.role) ? body.role : 'tim';
      let team: string | null;
      let vertical: string | null;
      try {
        team = pilihan(body.team, VALID_TEAMS, 'Team');
        vertical = pilihan(body.vertical, VALID_VERTICALS, 'Vertical');
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }

      if (!email || !password) return NextResponse.json({ error: 'Email & password wajib diisi.' }, { status: 400 });
      if (password.length < 6) return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 });

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

      const { error: upErr } = await admin.from('profiles').upsert({
        id: created.user.id, email: created.user.email, role, full_name, team, vertical, is_active: true,
      });
      if (upErr) return NextResponse.json({ error: 'Akun dibuat, tapi gagal set peran: ' + upErr.message }, { status: 500 });

      return NextResponse.json({ success: true, user: { id: created.user.id, email: created.user.email } });
    }

    // ---- DELETE ----
    if (action === 'delete') {
      const user_id = body.user_id;
      if (!user_id) return NextResponse.json({ error: 'user_id wajib.' }, { status: 400 });
      if (user_id === caller.id) return NextResponse.json({ error: 'Tidak bisa menghapus akun sendiri.' }, { status: 400 });
      const { error: dErr } = await admin.auth.admin.deleteUser(user_id);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    // ---- GANTI EMAIL ----
    // Sebelum ini satu-satunya cara mengganti email adalah membuat user baru,
    // yang menyisakan akun lama sebagai kembaran: dua baris di Kelola Akses,
    // dua-duanya bisa login, dan PIC/log lama tetap menempel di yang lama.
    //
    // email_confirm: true dipakai supaya alamat barunya langsung sah — kalau
    // tidak, Supabase mengirim tautan konfirmasi dan orangnya terkunci di luar
    // sampai tautan itu diklik.
    if (action === 'update_email') {
      const user_id = body.user_id;
      const email = (body.email || '').trim().toLowerCase();
      if (!user_id || !email) return NextResponse.json({ error: 'user_id & email wajib.' }, { status: 400 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Format email tidak sah.' }, { status: 400 });
      }

      const { error: eErr } = await admin.auth.admin.updateUserById(user_id, {
        email, email_confirm: true,
      });
      if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

      // profiles.email cuma salinan untuk ditampilkan — kalau tidak ikut
      // diperbarui, tabel Kelola Akses masih memperlihatkan alamat lama
      // padahal loginnya sudah pindah.
      const { error: pErr } = await admin.from('profiles').update({ email }).eq('id', user_id);
      if (pErr) {
        return NextResponse.json(
          { error: 'Email login sudah diganti, tapi gagal memperbarui tabel profil: ' + pErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, email });
    }

    // ---- RESET PASSWORD ----
    if (action === 'reset_password') {
      const user_id = body.user_id;
      const password = body.password || '';
      if (!user_id || !password) return NextResponse.json({ error: 'user_id & password wajib.' }, { status: 400 });
      if (password.length < 6) return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 });
      const { error: rErr } = await admin.auth.admin.updateUserById(user_id, { password });
      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
