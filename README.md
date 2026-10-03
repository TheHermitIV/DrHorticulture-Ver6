# DrHorticulture Ver6

DrHorticulture Ver6: a plant photo goes in, and a fertilize / do not fertilize / abstain
recommendation with a confidence score comes out.

| Folder | What it is |
| --- | --- |
| `Front-End/` | iOS app (SwiftUI, Xcode project); built and uploaded to TestFlight by `.github/workflows/ios.yml` |
| `Backend/` | Everything server-side (below) |
| `Assets/` | Shared images, such as the app icon master |

Inside `Backend/`:

| Folder | What it is |
| --- | --- |
| `api/` | Public Node/Express API on Railway (upload, quality gate, decision policy, storage) |
| `inference/` | Python inference service with pluggable CV and ML stages (PlantVision CV; ML is a stub for now) |
| `contracts/` | The api ↔ inference contract (JSON Schema + canonical example) |
| `supabase/` | Database migrations |
| `plantvision/` | CV pipeline prototype: leaf segmentation, greenness, species ([README](Backend/plantvision/README.md)) |
| `docs/` | [Backend spec and action plan](Backend/docs/BACKEND_SPEC.md) |
