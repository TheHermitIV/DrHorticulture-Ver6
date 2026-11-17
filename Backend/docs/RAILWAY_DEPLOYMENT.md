# Deploy LeafSegmenter to Railway

Ernesto can review and integrate `leaf-segmenter-demo` to update the existing
Railway services. The iPhone continues to use the existing public API URL.
LeafSegmenter v1.1.0 uses the same leaf mask model and a retrained NDVI estimator.

For an existing installation with leaf lighting and stored masks already working,
start at [Update Railway for provisional calibration](#7-update-railway-for-provisional-calibration).

## 1. Prepare the services before merging

Open the existing Railway project and select **production**. Keep the current API
service, Supabase project, and private image bucket. Check that the services are
configured as follows.

| Service | Setting | Value |
| --- | --- | --- |
| API | Root Directory | `/Backend/api` |
| API | Variables | `INFERENCE_MODE=remote` and `INFERENCE_URL` set to the inference service's base URL |
| Inference | Root Directory | `/` |
| Inference | Config File | `/Backend/inference/railway.json` |
| Inference | Healthcheck Path | `/health` |
| Both | `INFERENCE_API_KEY` | Same existing secret on both services |

Use the existing inference URL if it works. The API appends `/v1/analyze`.
Record the last healthy deployment for each service so you can select it quickly
if you need to roll back.

## 2. Check the model settings

The model file, `Backend/inference/weights/leaf-segmenter-v1.1.0.json`, ships in the repo
and is copied into the image, so no volume or upload is needed. On the inference
service, make sure `LEAF_SEGMENTER_ENABLED` is unset or `true` (the Docker image
defaults to `true`) and that `LEAF_SEGMENTER_MODEL_PATH` is unset. Set that
variable only to override the bundled model with a file on a mounted volume.

## 3. Deploy and verify

1. Integrate the branch through the team's review and merge workflow. Deploy
   **inference first**, then deploy the **API** from the integrated revision.
   The inference `/health` should return
   `{"status":"ok","model_version":"LeafSegmenter v1.1.0"}`. If inference is
   private, check it from inside the Railway environment. The public API's
   `/health` should report `db: "ok"` and `inference_mode: "remote"`.
2. Apply the quality configuration in the next section before testing the
   521 × 600 demo photo or comparing lighting across backgrounds.
3. Run `npm run test-page` from `Backend/api` and open `http://localhost:3000`.
   By default, uploads create scans in the deployed database. Use `-- --api <api-url>`
   to target a test API. The website is a local preview and the mask creator runs
   in the browser. Submit a clear, centered plant photo.
   Before enabling the experimental demo rules, expect **Estimated NDVI**
   alongside **No fertilizer recommendation** for LeafSegmenter v1.1.0.
4. In Supabase, find the test scan's row in `analyses`. Check that
   `model_version` is `LeafSegmenter v1.1.0` and `ndvi` matches the phone up to
   rounding. Confirm that **Scan Details** opens the scan and shows the model
   version and quality checks. Smoke-test the same flow on the iPhone if it will
   be used in the demo.

## 4. Enable leaf lighting and the lower resolution minimum

After both services have the masked lighting code, apply
`Backend/supabase/migrations/0004_leaf_lighting_demo_config.sql` to the target
Supabase database. It activates a new version of the existing settings with
`lighting_scope = 'leaf'` and a 512 px minimum on the short side. The API caches
the active configuration for up to 60 seconds. Verify the active row in Supabase.

```sql
select version, quality ->> 'lighting_scope' as lighting_scope,
       quality ->> 'min_short_side_px' as min_short_side_px
from public.decision_config
where active;
```

Expect one row with `leaf` and `512`. Use these smoke tests after the cache refresh.

| Test photo | Expected behavior |
| --- | --- |
| Same evenly lit plant against white and black backgrounds | Lighting is evaluated on the detected leaves. Scan Details shows leaf brightness and clipping when inference supplies them. |
| Leaves genuinely too bright or dark, with a usable mask | The scan is rejected for lighting. Scan Details shows the reason and retake tip. |
| No usable leaf mask | The scan is rejected with a plant-detection retake tip. |
| 521 × 600 demo photo | Passes the resolution check. Blur, plant detection, and lighting still apply. |
| Photo with a short side below 512 px | Rejected for resolution before inference. |

The API checks resolution and blur before inference. It records whole-photo
lighting and uses it as a fallback if an older inference response finds a plant
but omits leaf lighting metrics. The model still withholds fertilizer advice
while its confidence scores are uncalibrated.

To reverse the quality settings, deactivate the new version and reactivate the
previous version in one transaction. Keep both rows so existing analyses retain
their configuration history.

## 5. Store leaf masks with their photos

Apply `Backend/supabase/migrations/0005_scan_image_pairs.sql` to the target Supabase
database. It numbers every photo within its scan (`scan_images.pair_number`: 1, then
2 and up for retakes) and adds a trigger that numbers new photos, so it can be applied
before or after the services are deployed. Deploy inference and the API from the same
revision. The services can go out in either order, but masks are only stored once both are live.

From then on, inference sends the leaf mask with each scan where it finds a plant. The
API saves it beside the photo, paired by the image id:

| File | Contents |
| --- | --- |
| `scans/{scan_id}/{image_id}.jpg` | The original photo ("Plant N") |
| `scans/{scan_id}/{image_id}.mask.png` | Its leaf mask, white where the model saw leaves ("Mask N") |

Smoke test: submit a clear plant photo from the test page and open **Scan Details**.
Expect **Plant 1** and **Mask 1** side by side, and the photo darkened outside the leaves
while **Darken everything outside the mask** is checked. Scans from before this change
show the photo with "No leaf mask was stored for this photo."

## 6. Roll back if the smoke test fails

If inference fails to start, check its logs for a missing or unreadable model
file and make sure `LEAF_SEGMENTER_MODEL_PATH` is unset or points at a real file.
If production scans are failing, open the affected Railway service's
**Deployments** tab, select the last healthy deployment, and choose **Rollback**
from its menu. Recheck both health endpoints and
run one clear scan. Roll back the API too if its deployment or settings were part
of the failure.

[Railway rollback instructions](https://docs.railway.com/deployments/deployment-actions#rollback)

## 7. Update Railway for provisional calibration

1. In the target Supabase project, record the active `decision_config.version`
   and apply [`0006_ndvi_cutoff_distance.sql`](../supabase/migrations/0006_ndvi_cutoff_distance.sql).
   Apply it **before merging** if the API autodeploys from the target branch.
   The updated API selects `ndvi_cutoff_distance` and `demo_calibration` on scan reads.
2. Merge or deploy the calibration revision. In Railway **Deployments**, confirm
   that both **inference** and **API** are running the intended Git commit. With
   manual deployments, start with inference. Inference `/health` still says
   `LeafSegmenter v1.1.0`, so use the deployed commit and a fresh scan to verify
   the update. Confirm the API `/health` reports a working database and remote
   inference, then scan a clear photo and check that Scan Details shows a leaf mask score.
3. Enable the experimental rules in the database used by the demo API with the
   SQL below. The rules are opt-in and apply to new scans on v1.1.0. If the demo
   uses the production API and database, activating this row also affects other
   new v1.1.0 scans on that API. Allow up to 60 seconds for the config cache to refresh.

```sql
begin;
lock table public.decision_config in share row exclusive mode;
with previous as (
  update public.decision_config set active = false
  where active
    and (ndvi_threshold is distinct from 0.50
      or not (quality @> '{"demo_mask_min":0.97,"demo_ndvi_buffer":0.11}'))
  returning version, confidence_min, mask_min, quality
)
insert into public.decision_config
  (version, ndvi_threshold, confidence_min, mask_min, quality, active, notes)
select (select max(version) + 1 from public.decision_config),
       0.50, confidence_min, mask_min,
       quality || '{"demo_mask_min":0.97,"demo_ndvi_buffer":0.11}'::jsonb,
       true, 'Experimental demo rules based on configuration ' || version
from previous;
commit;
```

Verify one active row with cutoff `0.50`, mask minimum `0.97`, and NDVI buffer `0.11`.

```sql
select version, ndvi_threshold, quality ->> 'demo_mask_min' as demo_mask_min,
       quality ->> 'demo_ndvi_buffer' as demo_ndvi_buffer
from public.decision_config
where active;
```

Pull the same revision locally and run `npm run test-page` from `Backend/api`.
Submit fresh scans and open **Scan Details**. Earlier scans retain their original results.

| Smoke test | Expected result |
| --- | --- |
| `good-case-greenseeker-0.80.jpg` | Mask score about 0.990, NDVI about 0.806, range about 0.696–0.916, and **Demo recommendation · Do not fertilize**. |
| `bad-case-greenseeker-0.81.jpg`, with leaf lighting and the 512 px minimum enabled | Mask score about 0.905 and **No fertilizer recommendation** if photo quality passes. |
| Strong mask with NDVI from 0.39 through 0.61 inclusive | **No fertilizer recommendation** because the NDVI range touches or crosses 0.50. This boundary is covered by API tests. |

The website reports the sample count behind the mask band and the provisional NDVI
range. These outputs are for demonstration. See the [training handoff](ML_TRAINING_HANDOFF.md#confidence-experiments)
for the benchmark and its limits.

To disable demo recommendations, deactivate the demo row and reactivate the
recorded previous configuration in one transaction. Keep the migration columns
in place so the current API can continue reading scans. If a service deployment
also needs to be reverted, roll it back using section 6.
