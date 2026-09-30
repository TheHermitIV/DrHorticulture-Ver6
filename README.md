# DrHorticulture Ver6

Backend for DrHorticulture Ver6: a plant photo goes in, and a fertilize / do not fertilize / abstain
recommendation with a confidence score comes out.

| Folder | What it is |
| --- | --- |
| `api/` | Public Node/Express API on Railway (upload, quality gate, decision policy, storage) |
| `inference/` | Private Python inference service with pluggable CV and ML stages (stubs for now) |
| `contracts/` | The api ↔ inference contract (JSON Schema + canonical example) |
| `supabase/` | Database migrations |
| `plantvision/` | CV pipeline prototype: leaf segmentation, greenness, species ([README](plantvision/README.md)) |
| `docs/` | [Backend spec and action plan](docs/BACKEND_SPEC.md) |

Folders are added as the action plan in the spec progresses.
