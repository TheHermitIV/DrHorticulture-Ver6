-- Private bucket for scan photos: objects at scans/{scan_id}/{image_id}.{ext}.
-- No storage policies, so only the service-role key (the api) can read or write;
-- clients only ever receive signed URLs.
insert into storage.buckets (id, name, public)
values ('scan-images', 'scan-images', false)
on conflict (id) do nothing;
