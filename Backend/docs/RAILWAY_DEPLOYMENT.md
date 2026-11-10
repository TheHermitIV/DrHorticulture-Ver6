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

## 2. Install the private model file

1. Attach a persistent volume to the **inference** service at `/models`, or use
   its existing private volume. Apply the mount while the current inference
   version can still start. Railway's file upload requires a running deployment.
2. Receive `leaf-segmenter-v1.0.0.json` through the team's private channel.
   Link the Railway CLI to the production project, select the inference service,
   and verify the target with `railway status`. From the directory containing the file, run:

   ```sh
   railway service files upload ./leaf-segmenter-v1.0.0.json /models/leaf-segmenter-v1.0.0.json
   railway service files list /models
   ```

3. On the inference service, set `LEAF_SEGMENTER_MODEL_PATH` to
   `/models/leaf-segmenter-v1.0.0.json`. If you used an existing mount at a different
   path, use that path in both the upload and the variable. Ensure
   `LEAF_SEGMENTER_ENABLED` is either unset or `true`. The Docker image defaults
   to `true`.

[Railway volumes](https://docs.railway.com/volumes) · [Railway file commands](https://docs.railway.com/cli/service#manage-files)

## 3. Deploy and verify

1. Run the branch's Xcode build and unit tests. Once the model file and settings
   are in place, merge the reviewed branch into `main` and watch the inference
   deployment finish. Its `/health` should return
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
file and confirm the mount and path. If production scans are failing, open the
affected Railway service's **Deployments** tab, select the last healthy
deployment, and choose **Rollback** from its menu. Recheck both health endpoints
and run one clear scan. Roll back the API too if its deployment or settings
were part of the failure. Keep the model file on the volume for the next attempt.

[Railway rollback instructions](https://docs.railway.com/deployments/deployment-actions#rollback)
