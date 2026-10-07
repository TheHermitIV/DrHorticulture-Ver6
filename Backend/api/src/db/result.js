// Unwraps a supabase-js { data, error } result. Errors become plain Errors, so clients get a
// generic 500 while the cause is logged.
export function unwrap(action, { data, error }) {
  if (error) throw new Error(`Database ${action} failed: ${error.message}`, { cause: error });
  return data;
}

// Map key → the first row for each value of row[key]; with rows newest first, the latest.
export function latestBy(rows, key) {
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row[key])) latest.set(row[key], row);
  }
  return latest;
}
