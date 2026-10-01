// Unwraps a supabase-js { data, error } result. Errors become plain Errors, so clients get a
// generic 500 while the cause is logged.
export function unwrap(action, { data, error }) {
  if (error) throw new Error(`Database ${action} failed: ${error.message}`, { cause: error });
  return data;
}
