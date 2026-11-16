// How long signed URLs stay valid, by who receives them.
export const SIGNED_URL_SECONDS = Object.freeze({
  inference: 5 * 60,
  client: 60 * 60,
});

export function objectPath({ scanId, imageId, ext }) {
  return `scans/${scanId}/${imageId}.${ext}`;
}

// A photo and its leaf mask are a pair named by the image id, so either one finds the other:
// scans/{scan_id}/{image_id}.jpg and scans/{scan_id}/{image_id}.mask.png.
export function maskPath({ scanId, imageId }) {
  return objectPath({ scanId, imageId, ext: 'mask.png' });
}

function expiresFor(purpose) {
  const seconds = SIGNED_URL_SECONDS[purpose];
  if (!seconds) throw new Error(`Unknown signed URL purpose: ${purpose}`);
  return seconds;
}

function storageError(action, error) {
  return new Error(`Storage ${action} failed: ${error.message}`, { cause: error });
}

// Private-bucket access through the service-role client. Clients only ever get signed URLs.
export function createStorage({ supabase, bucket }) {
  const files = () => supabase.storage.from(bucket);

  return {
    // Stores the original bytes as uploaded. upsert is off, so nothing is ever overwritten.
    async uploadOriginal({ scanId, imageId, image }) {
      const path = objectPath({ scanId, imageId, ext: image.ext });
      const { error } = await files().upload(path, image.buffer, {
        contentType: image.mime,
        upsert: false,
      });
      if (error) throw storageError('upload', error);
      return path;
    },

    // Stores the leaf mask inference computed on an image (PNG bytes), paired with it by name.
    async uploadMask({ scanId, imageId, png }) {
      const path = maskPath({ scanId, imageId });
      const { error } = await files().upload(path, png, {
        contentType: 'image/png',
        upsert: false,
      });
      if (error) throw storageError('mask upload', error);
      return path;
    },

    // purpose: 'inference' (5 min) or 'client' (1 h).
    async signedUrl(path, purpose) {
      const { data, error } = await files().createSignedUrl(path, expiresFor(purpose));
      if (error) throw storageError('signed URL', error);
      return data.signedUrl;
    },

    // Several signed URLs in one request: Map path → URL, or → null for a path that failed
    // alone (such as a missing object).
    async signedUrls(paths, purpose) {
      if (paths.length === 0) return new Map();
      const { data, error } = await files().createSignedUrls(paths, expiresFor(purpose));
      if (error) throw storageError('signed URLs', error);
      return new Map(data.map((item) => [item.path, item.error ? null : item.signedUrl]));
    },

    async remove(path) {
      const { error } = await files().remove([path]);
      if (error) throw storageError('remove', error);
    },
  };
}
