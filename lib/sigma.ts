import { createClient } from '@supabase/supabase-js';

// Koneksi READ-ONLY ke Supabase SIGMA (hanya view alpha_tracker_feed).
// Nilai diisi lewat Environment Variable di Vercel, bukan di kode.
const url = process.env.NEXT_PUBLIC_SIGMA_URL || 'https://placeholder.supabase.co';
const anon = process.env.NEXT_PUBLIC_SIGMA_ANON_KEY || 'placeholder';

export const sigma = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface SigmaPost {
  id: string;
  project_id: string | null;
  url: string | null;
  category: string | null;
  account: string | null;
  platform: string | null;
  ig_type: string | null;
  followers: number | null;
  upload_date: string | null;
  last_scraped: string | null;
  cover_url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reposts: number | null;
  is_manual: boolean | null;
}
