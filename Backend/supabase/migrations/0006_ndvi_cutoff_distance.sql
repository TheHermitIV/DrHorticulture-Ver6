-- Stores the demo decision margin in NDVI units alongside the existing confidence field.
alter table public.analyses
  add column if not exists ndvi_cutoff_distance numeric,
  add column if not exists demo_calibration jsonb;
