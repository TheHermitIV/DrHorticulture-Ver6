-- Activate after the API and inference services support masked lighting metrics.
begin;

lock table public.decision_config in share row exclusive mode;

with previous as (
  update public.decision_config
  set active = false
  where active
    and (quality ->> 'lighting_scope' is distinct from 'leaf'
      or quality ->> 'min_short_side_px' is distinct from '512')
  returning ndvi_threshold, confidence_min, mask_min, quality, version
)
insert into public.decision_config
  (version, ndvi_threshold, confidence_min, mask_min, quality, active, notes)
select
  (select max(version) + 1 from public.decision_config),
  ndvi_threshold,
  confidence_min,
  mask_min,
  quality || '{"min_short_side_px":512,"lighting_scope":"leaf"}'::jsonb,
  true,
  'Leaf lighting and 512 px demo minimum, based on configuration ' || version
from previous;

commit;
