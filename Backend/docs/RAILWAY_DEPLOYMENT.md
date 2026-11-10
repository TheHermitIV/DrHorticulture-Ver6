# Deploy LeafSegmenter to Railway

This runbook updates the existing production API and inference services using
`leaf-segmenter-demo`. The iPhone continues to use the existing public API URL.

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

The model file, `Backend/inference/weights/leaf-segmenter-v1.0.0.json`, is committed
and copied into the image, so no volume or upload is needed. On the inference
service, make sure `LEAF_SEGMENTER_ENABLED` is unset or `true` (the Docker image
defaults to `true`) and that `LEAF_SEGMENTER_MODEL_PATH` is unset. Set that
variable only to override the bundled model with a file on a mounted volume.

## 3. Deploy and verify

1. Run the branch's Xcode build and unit tests. Then deploy the branch, either by
   pointing the inference service's **Settings → Source** branch at it or by
   merging it into `main`, and watch the inference deployment finish. Its `/health` should return
   `{"status":"ok","model_version":"LeafSegmenter v1.0.0"}`. If inference is
   private, check it from inside the Railway environment. The public API's
   `/health` should report `db: "ok"` and `inference_mode: "remote"`.
2. Install the updated iPhone build. Leave `DRHORTICULTURE_API_BASE_URL` blank to
   use the existing production API URL. Submit a clear, centered plant photo.
   Expect **Estimated NDVI** alongside **No fertilizer recommendation** while
   confidence calibration is pending.
3. In Supabase, find the test scan's row in `analyses`. Check that
   `model_version` is `LeafSegmenter v1.0.0` and `ndvi` matches the phone up to
   rounding. Then try a dark photo and confirm that the preview warns you and,
   if the API rejects it, the app shows a retake hint.

## 4. Roll back if the smoke test fails

If inference fails to start, check its logs for a missing or unreadable model
file and make sure `LEAF_SEGMENTER_MODEL_PATH` is unset or points at a real file.
If production scans are failing, open the affected Railway service's
**Deployments** tab, select the last healthy deployment, and choose **Rollback**
from its menu. If you deployed by switching the Source branch, switch it back too,
or the next push to the branch redeploys it. Recheck both health endpoints and
run one clear scan. Roll back the API too if its deployment or settings were part
of the failure.

[Railway rollback instructions](https://docs.railway.com/deployments/deployment-actions#rollback)
