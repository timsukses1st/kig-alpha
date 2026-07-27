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

const VALID_ROLES = ['superadmin', 'manager', 'tim'];
const VALID_TEAMS = ['delta', 'creative', 'distribution', 'ads', 'pm'];
const VALID_VERTICALS = ['KC', 'GME', 'KIG'];

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
      const role = VALID_ROLES.includes(body.role) ? body.role : 'tim';
      const team = VALID_TEAMS.includes(body.team) ? body.team : null;
      const vertical = VALID_VERTICALS.includes(body.vertical) ? body.vertical : null;

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
