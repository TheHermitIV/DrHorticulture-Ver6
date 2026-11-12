# Deploy LeafSegmenter to Railway

Ernesto can review and integrate `leaf-segmenter-demo` to update the existing
Railway services. The iPhone continues to use the existing public API URL.
LeafSegmenter v1.1.0 uses the same leaf mask model and a retrained NDVI estimator.

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
   Expect **Estimated NDVI** alongside **No fertilizer recommendation** while
   confidence calibration is pending.
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

## 5. Roll back if the smoke test fails

If inference fails to start, check its logs for a missing or unreadable model
file and make sure `LEAF_SEGMENTER_MODEL_PATH` is unset or points at a real file.
If production scans are failing, open the affected Railway service's
**Deployments** tab, select the last healthy deployment, and choose **Rollback**
from its menu. Recheck both health endpoints and
run one clear scan. Roll back the API too if its deployment or settings were part
of the failure.

[Railway rollback instructions](https://docs.railway.com/deployments/deployment-actions#rollback)
