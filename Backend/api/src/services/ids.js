const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids in URLs are checked before they reach Postgres, which errors on a malformed uuid.
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);
