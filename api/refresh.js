// ============================================================================
// VERCEL CRON: Auto-Refresh Metrics (pagi/sore/malam/manual)
// ============================================================================
// VERSI 1.5 - FIX INSTAGRAM VIEWS. Prioritas field dibalik ke urutan yang benar:
//             videoPlayCount -> playCount -> videoViewCount. Sebelumnya
//             videoViewCount didahulukan, padahal terbukti TIDAK akurat untuk IG
//             (diverifikasi empiris via make.com). Disamakan dengan scrape.js.
// VERSI 1.4 - TAMBAH THREADS. Pemisah platform diperbaiki jadi 3 jalur tegas
//             (tiktok / instagram / threads). Threads di-refresh PER AKUN
//             (mode username), dicocokkan ke stored post via post_code.
// VERSI 1.3 - FIX SHORT LINK (vt/vm.tiktok.com di-resolve ke URL lengkap dulu,
//             baru dicocokkan via video ID). Mengatasi angka tidak update.
// CATATAN: slot diterima sebagai label penanda saja (pagi/sore/malam/manual).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// Helper: extract TikTok Video ID dari URL
// Menangani: /video/, /v/, /photo/ (slideshow), dan ID numerik telanjang.
function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/\/(?:video|v|photo)\/(\d{10,25})/);
  if (m) return m[1];
  const m2 = url.match(/(\d{15,25})(?:[/?#]|$)/);
  return m2 ? m2[1] : null;
}

// Helper: ambil URL cover/thumbnail dari item Apify (nama field bisa beda-beda).
function pickCover(item) {
  if (!item) return null;
  // Coba beberapa kemungkinan lokasi cover yang dipakai TikTok scraper Apify
  const candidates = [
    item.videoMeta && item.videoMeta.coverUrl,
    item.videoMeta && item.videoMeta.originalCoverUrl,
    item.covers && (Array.isArray(item.covers) ? item.covers[0] : item.covers),
    item.coverUrl,
    item.cover,
    item.dynamicCover,
    item.originCover
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.startsWith('http')) return c;
  }
  return null;
}

// Helper: extract Instagram shortCode dari URL (/p/CODE/, /reel/CODE/, /tv/CODE/)
function extractIgShortcode(url) {
  if (!url) return null;
  const m = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Helper: ambil cover Instagram (displayUrl = thumbnail post)
function pickIgCover(item) {
  if (!item) return null;
  if (item.displayUrl && typeof item.displayUrl === 'string' && item.displayUrl.startsWith('http')) return item.displayUrl;
  if (Array.isArray(item.images) && item.images[0] && item.images[0].startsWith('http')) return item.images[0];
  return null;
}

// Helper: ambil views Instagram dengan urutan prioritas yang BENAR.
// videoPlayCount = jumlah pemutaran (akurat, terverifikasi via make.com).
// videoViewCount TIDAK akurat untuk IG dan sering null untuk post setelah 8 Juli.
// Urutan ini sengaja disamakan dengan scrape.js supaya cron dan refresh manual
// tidak pernah menghasilkan angka yang berbeda untuk post yang sama.
function pickIgViews(item) {
  if (!item) return 0;
  const candidates = [item.videoPlayCount, item.playCount, item.videoViewCount];
  for (const v of candidates) {
    if (typeof v === 'number' && v >= 0) return v;
  }
  return 0; // foto/carousel tidak punya views
}

// Helper: extract username Threads dari URL profil/post
// Menangani: https://www.threads.com/@username  &  .../@username/post/CODE
function extractThreadsUsername(url) {
  if (!url) return null;
  const m = String(url).match(/threads\.(?:com|net)\/@?([^/?#]+)/i);
  return m ? m[1].replace(/^@/, '') : null;
}

// Helper: extract post_code Threads dari URL (.../post/CODE)
function extractThreadsCode(url) {
  if (!url) return null;
  const m = String(url).match(/threads\.(?:com|net)\/@?[^/]+\/post\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Helper: "buka" link pendek (vt.tiktok.com / vm.tiktok.com) jadi URL lengkap.
// Link pendek tidak memuat nomor ID video, jadi harus diikuti redirect-nya dulu.
async function resolveUrl(url) {
  if (!url) return url;
  // Kalau sudah ada ID-nya, tidak perlu di-resolve.
  if (extractVideoId(url)) return url;
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetricsBot/1.0)' }
    });
    return r.url || url; // r.url = URL final setelah semua redirect
  } catch (e) {
    return url; // kalau gagal resolve, kembalikan apa adanya
  }
}

export const maxDuration = 60;

export default async function handler(req, res) {
  const startTime = Date.now();
  const slot = (req.query.slot || 'malam').toLowerCase();

  // ---------- AUTHENTICATION ----------
  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    return res.status(500).json({ error: 'CRON_SECRET belum di-set' });
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ---------- ENV CHECK ----------
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // PENTING: tidak ada fallback URL. Fallback lama menunjuk ke project Supabase
  // yang BUKAN SIGMA — kalau env hilang, cron akan menulis ke database yang salah
  // tanpa error apa pun. Lebih aman gagal terang-terangan.
  if (!APIFY_TOKEN || !SUPABASE_KEY || !SUPABASE_URL) {
    return res.status(500).json({
      error: 'Missing env vars',
      detail: {
        APIFY_TOKEN: !!APIFY_TOKEN,
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_KEY
      }
    });
  }

  if (!['pagi', 'sore', 'malam', 'manual', 'auto'].includes(slot)) {
    return res.status(400).json({ error: 'Invalid slot' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });

  // ---------- ANTI-BONCOS: kumpulkan project yang DIARSIP, lalu skip post-nya ----------
  // Project arsip tidak boleh ikut di-scrape cron (kalau ikut = tetap makan credit Apify).
  let archivedProjectIds = [];
  try {
    const { data: arch } = await sb
      .from('projects')
      .select('id')
      .eq('archived', true);
    archivedProjectIds = (arch || []).map(p => p.id);
  } catch (e) {
    // kolom 'archived' belum ada / query gagal -> anggap tidak ada arsip (aman, jalan seperti biasa)
    archivedProjectIds = [];
  }

  // ---------- FETCH POSTS (hanya yang "basi": belum di-refresh dalam 20 jam terakhir) ----------
  // Diurut dari paling lama belum di-update, dibatasi per panggilan agar tidak timeout.
  // Saat semua sudah ter-update hari ini, query balik 0 post -> cron berhenti sendiri.
  const REFRESH_LIMIT = parseInt(req.query.limit, 10) || 10;
  const staleCutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  let postsQuery = sb
    .from('posts')
    .select('id, project_id, url, platform')
    .or(`last_scraped.is.null,last_scraped.lt.${staleCutoff}`)
    .order('last_scraped', { ascending: true, nullsFirst: true })
    .limit(REFRESH_LIMIT);

  // Kalau ada project arsip, kecualikan post-nya dari refresh (hemat credit)
  if (archivedProjectIds.length > 0) {
    postsQuery = postsQuery.not('project_id', 'in', `(${archivedProjectIds.join(',')})`);
  }

  const { data: allPosts, error: fetchError } = await postsQuery;

  if (fetchError) {
    return res.status(500).json({ error: 'Gagal fetch posts', detail: fetchError.message });
  }

  if (!allPosts || allPosts.length === 0) {
    await logCron(sb, slot, 0, 0, 0, Date.now() - startTime, 'No posts');
    return res.status(200).json({ success: true, message: 'No posts', slot });
  }

  // Pisahkan per platform: 3 jalur tegas (default lama tanpa platform = tiktok).
  const platformOf = (p) => (p.platform || 'tiktok').toLowerCase();
  const tiktokPosts = allPosts.filter(p => platformOf(p) === 'tiktok');
  const igPosts = allPosts.filter(p => platformOf(p) === 'instagram');
  const threadsPosts = allPosts.filter(p => platformOf(p) === 'threads');

  console.log(`[cron:${slot}] Refreshing ${allPosts.length} posts (tiktok=${tiktokPosts.length}, instagram=${igPosts.length}, threads=${threadsPosts.length})...`);

  // ---------- BATCH SCRAPE ----------
  const BATCH_SIZE = 20;
  let totalSuccess = 0;
  let totalFailed = 0;
  const errors = [];

  for (let i = 0; i < tiktokPosts.length; i += BATCH_SIZE) {
    const batch = tiktokPosts.slice(i, i + BATCH_SIZE);

    // STEP 1: Resolve semua URL (link pendek -> URL lengkap) & ambil video ID.
    const resolved = await Promise.all(
      batch.map(async (p) => {
        const canonicalUrl = await resolveUrl(p.url);
        const vid = extractVideoId(canonicalUrl);
        return { ...p, canonicalUrl, vid };
      })
    );

    const urls = resolved.map(p => p.canonicalUrl);

    try {
      const apifyResp = await fetch(
        `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postURLs: urls,
            resultsPerPage: urls.length,
            shouldDownloadVideos: false,
            shouldDownloadCovers: false,
            shouldDownloadSubtitles: false,
            shouldDownloadSlideshowImages: false
          })
        }
      );

      if (!apifyResp.ok) {
        const errText = await apifyResp.text();
        errors.push(`Batch ${i / BATCH_SIZE + 1}: Apify ${apifyResp.status} ${errText.substring(0, 80)}`);
        totalFailed += batch.length;
        continue;
      }

      const items = await apifyResp.json();

      // BUILD LOOKUP BY VIDEO ID
      const itemsByVideoId = new Map();
      items.forEach(item => {
        const candidates = [
          item.id,
          extractVideoId(item.webVideoUrl),
          extractVideoId(item.shareUrl),
          extractVideoId(item.url)
        ].filter(Boolean);
        candidates.forEach(vid => {
          itemsByVideoId.set(String(vid), item);
        });
      });

      // MATCH POST KE ITEM (selalu via video ID — sekarang link pendek pun punya ID)
      for (let j = 0; j < resolved.length; j++) {
        const post = resolved[j];
        const postVideoId = post.vid;
        let found = null;

        if (postVideoId && itemsByVideoId.has(String(postVideoId))) {
          found = itemsByVideoId.get(String(postVideoId));
        }

        if (!found) {
          totalFailed++;
          const shortUrl = post.url.length > 50 ? post.url.substring(0, 47) + '...' : post.url;
          errors.push(
            `Post ${post.id.substring(0, 8)} vid=${postVideoId || 'NONE'} (${shortUrl}): no match — apify balik ${items.length} item`
          );
          continue;
        }

        const metrics = {
          views: found.playCount ?? 0,
          likes: found.diggCount ?? 0,
          comments: found.commentCount ?? 0,
          saves: found.collectCount ?? 0,
          shares: found.shareCount ?? 0
        };
        const coverUrl = pickCover(found);

        console.log(
          `[cron:${slot}] ${post.id.substring(0, 8)} via id | views=${metrics.views} likes=${metrics.likes} cmt=${metrics.comments} save=${metrics.saves} shr=${metrics.shares}`
        );

        const updatePayload = {
          ...metrics,
          last_scraped: new Date().toISOString()
        };
        if (coverUrl) updatePayload.cover_url = coverUrl;

        const { error: updateErr } = await sb
          .from('posts')
          .update(updatePayload)
          .eq('id', post.id);

        if (updateErr) {
          totalFailed++;
          errors.push(`Post ${post.id.substring(0, 8)}: update failed`);
          continue;
        }

        const { error: snapErr } = await sb
          .from('posts_snapshots')
          .insert({
            post_id: post.id,
            project_id: post.project_id,
            slot: slot,
            ...metrics
          });

        if (snapErr) {
          totalFailed++;
          errors.push(`Post ${post.id.substring(0, 8)}: snapshot failed`);
          continue;
        }

        totalSuccess++;
      }
    } catch (batchErr) {
      totalFailed += batch.length;
      errors.push(`Batch ${i / BATCH_SIZE + 1}: ${batchErr.message}`);
    }
  }

  // ======================= INSTAGRAM =======================
  // Jalur terpisah: actor & field berbeda dari TikTok. Cocokkan via shortCode.
  for (let i = 0; i < igPosts.length; i += BATCH_SIZE) {
    const batch = igPosts.slice(i, i + BATCH_SIZE);
    const urls = batch.map(p => p.url);

    try {
      const igResp = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            directUrls: urls,
            resultsType: 'posts',
            resultsLimit: urls.length,
            addParentData: false
          })
        }
      );

      if (!igResp.ok) {
        const errText = await igResp.text();
        errors.push(`IG Batch ${i / BATCH_SIZE + 1}: Apify ${igResp.status} ${errText.substring(0, 80)}`);
        totalFailed += batch.length;
        continue;
      }

      const items = await igResp.json();

      // Lookup by shortCode
      const itemsByCode = new Map();
      items.forEach(item => {
        const code = item.shortCode || extractIgShortcode(item.url);
        if (code) itemsByCode.set(String(code), item);
      });

      for (let j = 0; j < batch.length; j++) {
        const post = batch[j];
        const code = extractIgShortcode(post.url);
        let found = (code && itemsByCode.has(String(code))) ? itemsByCode.get(String(code)) : null;

        if (!found) {
          totalFailed++;
          const shortUrl = post.url.length > 50 ? post.url.substring(0, 47) + '...' : post.url;
          errors.push(`IG Post ${post.id.substring(0, 8)} code=${code || 'NONE'} (${shortUrl}): no match — apify balik ${items.length} item`);
          continue;
        }

        // Pemetaan field Instagram. likesCount bisa -1 (like disembunyikan) -> jadikan 0.
        const igLikes = (typeof found.likesCount === 'number' && found.likesCount >= 0) ? found.likesCount : 0;
        const igViews = pickIgViews(found); // videoPlayCount didahulukan (lihat helper)
        const metrics = {
          views: igViews,
          likes: igLikes,
          comments: found.commentsCount ?? 0,
          saves: 0,   // IG tidak sediakan publik
          shares: 0   // IG tidak sediakan publik
        };
        const coverUrl = pickIgCover(found);

        console.log(`[cron:${slot}] IG ${post.id.substring(0, 8)} type=${found.type} | views=${metrics.views} (play=${found.videoPlayCount ?? '-'} view=${found.videoViewCount ?? '-'}) likes=${metrics.likes} cmt=${metrics.comments}`);

        const updatePayload = {
          ...metrics,
          last_scraped: new Date().toISOString()
        };
        if (coverUrl) updatePayload.cover_url = coverUrl;
        if (found.type) updatePayload.ig_type = found.type;
        if (found.timestamp) updatePayload.upload_date = found.timestamp;

        const { error: updateErr } = await sb.from('posts').update(updatePayload).eq('id', post.id);
        if (updateErr) {
          totalFailed++;
          errors.push(`IG Post ${post.id.substring(0, 8)}: update failed`);
          continue;
        }

        const { error: snapErr } = await sb.from('posts_snapshots').insert({
          post_id: post.id, project_id: post.project_id, slot: slot, ...metrics
        });
        if (snapErr) {
          totalFailed++;
          errors.push(`IG Post ${post.id.substring(0, 8)}: snapshot failed`);
          continue;
        }

        totalSuccess++;
      }
    } catch (batchErr) {
      totalFailed += batch.length;
      errors.push(`IG Batch ${i / BATCH_SIZE + 1}: ${batchErr.message}`);
    }
  }

  // ======================= THREADS =======================
  // Model beda: scrape PER AKUN (mode username), bukan per-URL. Satu scrape per
  // akun menutup banyak post sekaligus. Cocokkan stored post -> item via post_code.
  // Catatan: post yang lebih lama dari THREADS_REFRESH_MAX post terbaru tidak ikut
  // ter-refresh (angka tetap di nilai terakhir). Naikkan angka ini bila perlu jangkauan
  // lebih jauh — konsekuensinya biaya scrape per akun naik proporsional.
  const THREADS_REFRESH_MAX = 25;

  // Kelompokkan post Threads per username (1 scrape per akun = hemat)
  const threadsByUser = new Map();
  for (const p of threadsPosts) {
    const uname = extractThreadsUsername(p.url);
    if (!uname) {
      totalFailed++;
      errors.push(`TH Post ${p.id.substring(0, 8)}: username tak terbaca dari url`);
      continue;
    }
    const key = uname.toLowerCase();
    if (!threadsByUser.has(key)) threadsByUser.set(key, []);
    threadsByUser.get(key).push(p);
  }

  for (const [uname, postsOfUser] of threadsByUser.entries()) {
    try {
      const thResp = await fetch(
        `https://api.apify.com/v2/acts/futurizerush~meta-threads-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'user', usernames: [uname], max_posts: THREADS_REFRESH_MAX })
        }
      );

      if (!thResp.ok) {
        const errText = await thResp.text();
        errors.push(`TH @${uname}: Apify ${thResp.status} ${errText.substring(0, 80)}`);
        totalFailed += postsOfUser.length;
        continue;
      }

      const items = await thResp.json();

      // Lookup by post_code
      const itemsByCode = new Map();
      items.forEach(item => {
        const code = item.post_code || extractThreadsCode(item.post_url);
        if (code) itemsByCode.set(String(code), item);
      });

      for (const post of postsOfUser) {
        const code = extractThreadsCode(post.url);
        const found = (code && itemsByCode.has(String(code))) ? itemsByCode.get(String(code)) : null;

        if (!found) {
          totalFailed++;
          const shortUrl = post.url.length > 50 ? post.url.substring(0, 47) + '...' : post.url;
          errors.push(`TH Post ${post.id.substring(0, 8)} code=${code || 'NONE'} (${shortUrl}): no match — apify balik ${items.length} item`);
          continue;
        }

        // Pemetaan field Threads (samakan ke skema metrics existing).
        const metrics = {
          views: found.view_count ?? 0,
          likes: found.like_count ?? 0,
          comments: found.reply_count ?? 0,   // reply -> comments
          saves: 0,                            // Threads tidak punya saves
          shares: found.share_count ?? 0,      // share asli (kirim keluar)
          reposts: found.repost_count ?? 0     // repost (amplifikasi publik) - kolom sendiri
        };

        console.log(`[cron:${slot}] TH ${post.id.substring(0, 8)} @${uname} | views=${metrics.views} likes=${metrics.likes} cmt=${metrics.comments} shr=${metrics.shares}`);

        const updatePayload = {
          ...metrics,
          last_scraped: new Date().toISOString()
        };
        // Threads tidak menyediakan cover_url -> tidak diubah.

        const { error: updateErr } = await sb.from('posts').update(updatePayload).eq('id', post.id);
        if (updateErr) {
          totalFailed++;
          errors.push(`TH Post ${post.id.substring(0, 8)}: update failed`);
          continue;
        }

        const { error: snapErr } = await sb.from('posts_snapshots').insert({
          post_id: post.id, project_id: post.project_id, slot: slot, ...metrics
        });
        if (snapErr) {
          totalFailed++;
          errors.push(`TH Post ${post.id.substring(0, 8)}: snapshot failed`);
          continue;
        }

        totalSuccess++;
      }
    } catch (userErr) {
      totalFailed += postsOfUser.length;
      errors.push(`TH @${uname}: ${userErr.message}`);
    }
  }

  const duration = Date.now() - startTime;
  const notes = errors.length > 0
    ? errors.slice(0, 5).join(' | ') + (errors.length > 5 ? ` (+${errors.length - 5} more)` : '')
    : null;

  await logCron(sb, slot, allPosts.length, totalSuccess, totalFailed, duration, notes);

  return res.status(200).json({
    success: true,
    slot,
    total: allPosts.length,
    successCount: totalSuccess,
    failedCount: totalFailed,
    durationMs: duration,
    errors: errors.slice(0, 10)
  });
}

async function logCron(sb, slot, total, success, failed, duration, notes) {
  try {
    await sb.from('cron_logs').insert({
      slot, total_posts: total, success, failed, duration_ms: duration, notes
    });
  } catch (e) {
    console.error('[cron] Log failed:', e.message);
  }
}
