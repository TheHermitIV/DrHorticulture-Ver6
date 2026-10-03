import { describe, expect, it } from 'vitest';

import { createStorage, objectPath } from '../src/services/storage.js';

// Records calls to supabase.storage.from(bucket).<method>(...) and returns canned results.
function fakeSupabase(results = {}) {
  const calls = [];
  const recorder =
    (bucket, method) =>
    async (...args) => {
      calls.push({ bucket, method, args });
      return results[method] ?? { data: {}, error: null };
    };
  const from = (bucket) => ({
    upload: recorder(bucket, 'upload'),
    createSignedUrl: recorder(bucket, 'createSignedUrl'),
    remove: recorder(bucket, 'remove'),
  });
  return { calls, storage: { from } };
}

const image = { buffer: Buffer.from('jpeg-bytes'), mime: 'image/jpeg', ext: 'jpg' };
const ids = { scanId: 'scan-1', imageId: 'image-1' };

describe('objectPath', () => {
  it('builds scans/{scan_id}/{image_id}.{ext}', () => {
    expect(objectPath({ scanId: 'a', imageId: 'b', ext: 'png' })).toBe('scans/a/b.png');
  });
});

describe('createStorage', () => {
  it('uploads the original bytes to the bucket without overwriting', async () => {
    const supabase = fakeSupabase();
    const storage = createStorage({ supabase, bucket: 'scan-images' });
    const path = await storage.uploadOriginal({ ...ids, image });
    expect(path).toBe('scans/scan-1/image-1.jpg');
    expect(supabase.calls).toEqual([
      {
        bucket: 'scan-images',
        method: 'upload',
        args: [path, image.buffer, { contentType: 'image/jpeg', upsert: false }],
      },
    ]);
  });

  it.each([
    ['inference', 300],
    ['client', 3600],
  ])('signs %s URLs for %i seconds', async (purpose, seconds) => {
    const supabase = fakeSupabase({
      createSignedUrl: { data: { signedUrl: 'https://signed.example/x' }, error: null },
    });
    const storage = createStorage({ supabase, bucket: 'scan-images' });
    expect(await storage.signedUrl('scans/a/b.jpg', purpose)).toBe('https://signed.example/x');
    expect(supabase.calls[0]).toMatchObject({
      method: 'createSignedUrl',
      args: ['scans/a/b.jpg', seconds],
    });
  });

  it('refuses an unknown signed URL purpose', async () => {
    const storage = createStorage({ supabase: fakeSupabase(), bucket: 'scan-images' });
    await expect(storage.signedUrl('scans/a/b.jpg', 'forever')).rejects.toThrow('purpose');
  });

  it('removes one object', async () => {
    const supabase = fakeSupabase();
    await createStorage({ supabase, bucket: 'scan-images' }).remove('scans/a/b.jpg');
    expect(supabase.calls[0]).toMatchObject({ method: 'remove', args: [['scans/a/b.jpg']] });
  });

  it.each([
    ['upload', (storage) => storage.uploadOriginal({ ...ids, image })],
    ['createSignedUrl', (storage) => storage.signedUrl('p', 'client')],
    ['remove', (storage) => storage.remove('p')],
  ])('throws when %s fails', async (method, call) => {
    const supabase = fakeSupabase({
      [method]: { data: null, error: { message: 'The resource already exists' } },
    });
    const storage = createStorage({ supabase, bucket: 'scan-images' });
    await expect(call(storage)).rejects.toThrow('The resource already exists');
  });
});
