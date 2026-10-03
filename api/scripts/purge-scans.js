// Deletes every scan: the scans rows (scan_images, analyses, and ground_truth go with them by
// cascade) and every photo under scans/ in the storage bucket. For clearing test data; there is
// no undo.
//
//   npm run scans:purge             # dry run: counts what would be deleted
//   npm run scans:purge -- --yes    # deletes it
//
// Uses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_BUCKET from api/.env, so it acts on
// whichever project those point at. decision_config is never touched.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

const PAGE = 100;
const ROOT = 'scans';

// Every object path under scans/ (scans/{scan_id}/{image_id}.{ext}). Folders list as entries
// with no id.
export async function listPhotos(files) {
  const paths = [];
  async function walk(prefix) {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await files.list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`Listing ${prefix} failed: ${error.message}`);
      for (const entry of data) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) paths.push(path);
        else await walk(path);
      }
      if (data.length < PAGE) return;
    }
  }
  await walk(ROOT);
  return paths;
}

// Removes the rows first: if storage then fails, the leftover photos belong to no scan and a
// second run deletes them.
export async function purge({ supabase, bucket, dryRun }) {
  const files = supabase.storage.from(bucket);
  const { count, error: countError } = await supabase
    .from('scans')
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`Counting scans failed: ${countError.message}`);
  const photos = await listPhotos(files);
  if (dryRun) return { scans: count, photos: photos.length };

  const { error } = await supabase.from('scans').delete().not('id', 'is', null);
  if (error) throw new Error(`Deleting scans failed: ${error.message}`);
  for (let i = 0; i < photos.length; i += PAGE) {
    const { error: removeError } = await files.remove(photos.slice(i, i + PAGE));
    if (removeError) throw new Error(`Deleting photos failed: ${removeError.message}`);
  }
  return { scans: count, photos: photos.length };
}

async function main() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in api/.env.');
    process.exit(1);
  }
  const bucket = process.env.SUPABASE_BUCKET || 'scan-images';
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const dryRun = !values.yes;
  const { scans, photos } = await purge({ supabase, bucket, dryRun });
  const target = `${new URL(url).host}, bucket ${bucket}`;
  if (dryRun) {
    console.log(`Would delete ${scans} scans and ${photos} photos from ${target}.`);
    console.log('Run again with --yes to delete them.');
  } else {
    console.log(`Deleted ${scans} scans and ${photos} photos from ${target}.`);
  }
}

// Run only from the command line, not when tests import this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
