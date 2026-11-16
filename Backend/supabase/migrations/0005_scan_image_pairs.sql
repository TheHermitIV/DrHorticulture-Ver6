-- Numbers each photo within its scan: 1 for the first photo, 2 and up for retakes. A photo and
-- the leaf mask inference computed on it form a pair that shares this number, shown as
-- "Plant N" and "Mask N". In storage they share the image id:
--   scans/{scan_id}/{image_id}.{ext}       the original photo
--   scans/{scan_id}/{image_id}.mask.png    its leaf mask (white is leaf), when one was made
-- A trigger assigns the number, so the api never computes it and an api deployed before or
-- after this migration keeps working.
begin;

alter table public.scan_images add column pair_number int;

update public.scan_images as image
set pair_number = numbered.n
from (
  select id, row_number() over (partition by scan_id order by created_at, id) as n
  from public.scan_images
) as numbered
where image.id = numbered.id;

create function public.scan_images_assign_pair_number() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pair_number is null then
    -- The api lets only one photo be added to a scan at a time (the retake claim); the unique
    -- constraint below catches anything that slips past it.
    select coalesce(max(pair_number), 0) + 1 into new.pair_number
    from public.scan_images
    where scan_id = new.scan_id;
  end if;
  return new;
end;
$$;

create trigger scan_images_assign_pair_number
before insert on public.scan_images
for each row execute function public.scan_images_assign_pair_number();

alter table public.scan_images
  alter column pair_number set not null,
  add constraint scan_images_pair_number_positive check (pair_number >= 1),
  add constraint scan_images_scan_id_pair_number_key unique (scan_id, pair_number);

commit;
