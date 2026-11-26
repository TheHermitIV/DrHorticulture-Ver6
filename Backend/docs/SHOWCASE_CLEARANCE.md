# Showcase clearance and rehearsal

Updated 25 November 2026. Code and local-model checks do not establish public
permission or production deployment. Keep incomplete items unchecked.

## Completed in this revision

- [x] README AI disclosure names OpenAI Codex / ChatGPT and Claude / Claude Code.
- [x] Component and license credits are recorded in `THIRD_PARTY_NOTICES.md`.
- [x] Website labels the estimate experimental and shows the model returned by
  the actual scan, including old saved scans. It does not guess the server version.
- [x] UI uses text for advice, rejection reasons and mask meaning. It requires
  no audio to understand the upload and result workflow.

## Must be verified before public display

- [ ] Obtain written Product Owner permission for the exact photos, readings,
  screen recordings, screenshots and model artifacts that will be shown.
- [ ] Confirm app-icon authorship and permission. Confirm individual permissions
  for any teammate photos from Unsplash, Pexels or commercial plant sites.
- [x] Updated pitch deck includes the visible AI acknowledgment, component
  credits, current statistics and the development-result limitations.
- [ ] Use the updated deck in the actual rehearsal and confirm final captions
  or text descriptions for any video.
- [ ] Confirm both Railway services run the same intended release. The last
  live smoke test on 25 November returned LeafSegmenter v1.1.0, not v1.3.0.
- [ ] Remove any stale `LEAF_SEGMENTER_MODEL_PATH` override; verify inference
  `/health` says v1.3.0. Check database demo settings in the deployment runbook.
- [ ] Rehearse the exact demo images on the deployed API and the actual iPhone
  build if the phone will be shown. Open saved details and demonstrate a retake.
- [ ] Check final images and recording for faces, locations, identifying labels,
  notifications, secrets and unrelated browser content. Numbered plant markers
  are research identifiers and still require the lab's display permission.
- [ ] Inspect the actual staged diff for keys and tokens before publishing and
  inspect slides and recording separately. A source scan is not a blanket audit.
- [ ] Test at presentation size with labels visible without color. Provide a
  text description or captions for any spoken screen recording or video.
- [ ] Capture screenshots or a short backup video from the final deployed build,
  label recorded footage, and keep the demonstrated model version visible.

## Written permission request

Send through the team's approved channel. This file is a draft, not permission:

> Please confirm in writing which DrHorticulture plant photos, GreenSeeker
> readings, screenshots, recordings, and derived model artifacts Team A may show
> at the public Capstone Showcase on 4 December 2026, and which may be shared in
> the public repository or presentation afterward. Please identify restrictions
> on plant labels, locations, people, attribution, or redistribution. The demo
> presents RGB-based NDVI estimates and experimental fertilizer guidance.

Do not check this item until the Product Owner responds. Keep the reply with the
project records; do not publish private correspondence without permission.

## Demo sequence

1. Explain that RGB photos estimate a GreenSeeker reading and cannot measure NIR.
2. Use the clear held-out photo. Read the actual model version, NDVI, confidence
   and interval. Recommendations may be withheld if deployment/settings differ.
3. Show the difficult photo and why mask uncertainty prevents advice.
4. Show the low-resolution rejection and its retake instruction.
5. State that the confidence is provisional and NDVI alone does not establish
   fertilizer need. Do not lower thresholds to manufacture a recommendation.

The fixed image folder and its run manifest are kept outside Git because photo
rights are not yet confirmed. Use the generated `Read me.txt` for expected
local v1.3.0 results. The held-out plants are existing development test examples,
not fresh blind validation.
