create type scan_status as enum ('uploaded','rejected','processing','completed','abstained','failed');
create type recommendation as enum ('fertilize','do_not_fertilize','abstain');

create table scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,  -- nullable until auth is decided
  species     text not null,
  source      text not null default 'app' check (source in ('app','lab')),
  status      scan_status not null default 'uploaded',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table scan_images (
  id                 uuid primary key default gen_random_uuid(),
  scan_id            uuid not null references scans(id) on delete cascade,
  storage_path       text not null unique,          -- scans/{scan_id}/{image_id}.jpg
  mime_type          text not null,
  width              int,
  height             int,
  exif               jsonb not null default '{}',   -- device, iso, exposure; never GPS
  quality_passed     boolean,
  quality_metrics    jsonb not null default '{}',
  rejection_reasons  text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create table decision_config (
  version         int primary key,
  ndvi_threshold  numeric not null,   -- ndvi below this → fertilize
  confidence_min  numeric not null,   -- model confidence below this → abstain
  mask_min        numeric not null,   -- mask confidence below this → abstain
  quality         jsonb not null,     -- Tier A gate thresholds
  active          boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);
create unique index decision_config_one_active on decision_config (active) where active;

create table analyses (
  id               uuid primary key default gen_random_uuid(),
  scan_id          uuid not null references scans(id) on delete cascade,
  image_id         uuid not null references scan_images(id) on delete cascade,
  model_version    text,
  config_version   int not null references decision_config(version),
  mask_confidence  numeric,
  leaf_fraction    numeric,
  features         jsonb not null default '{}',
  ndvi             numeric,
  confidence       numeric,
  recommendation   recommendation,    -- null when the run failed
  abstain_reason   text,
  raw_response     jsonb,             -- full inference response, for audits
  error            text,              -- set only when status = failed
  latency_ms       int,
  created_at       timestamptz not null default now()
);

create table ground_truth (
  id                uuid primary key default gen_random_uuid(),
  image_id          uuid not null references scan_images(id) on delete cascade,
  greenseeker_ndvi  numeric,
  spad              numeric,
  distance_cm       numeric,
  lighting          text,
  measured_at       timestamptz,
  measured_by       text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index on scans (user_id, created_at desc);
create index on scan_images (scan_id);
create index on analyses (scan_id, created_at desc);
create index on ground_truth (image_id);

-- RLS on with no policies: only the service-role key (the api) can read or write
alter table scans enable row level security;
alter table scan_images enable row level security;
alter table decision_config enable row level security;
alter table analyses enable row level security;
alter table ground_truth enable row level security;

-- PLACEHOLDER thresholds until the Product Owner decides
insert into decision_config (version, ndvi_threshold, confidence_min, mask_min, quality, active, notes)
values (1, 0.50, 0.70, 0.80,
  '{"min_short_side_px":1024,"luminance_min":60,"luminance_max":200,"clipped_max_pct":5,"blur_min":100}',
  true, 'PLACEHOLDER values - recalibrate with lab photos and PO input');
