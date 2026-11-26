# Component credits and data permissions

This record identifies direct components and selected bundled dependencies.
Keep each installed package's LICENSE and NOTICE files. This is not a complete
transitive-dependency audit or a certification that every image is cleared.

## Team work

Team A wrote the SwiftUI application, API, website, mask editor, ZIP export
helper, PlantVision runtime, model training and evaluation code, and reviewed
mask annotations, with AI assistance disclosed in the README. The repository
LICENSE is MIT. Team authorship does not transfer rights in source photos.

## Runtime components

| Component and source | License | Use |
| --- | --- | --- |
| [Express](https://github.com/expressjs/express), [Multer](https://github.com/expressjs/multer) | MIT | HTTP routes and image uploads |
| [Supabase JS](https://github.com/supabase/supabase-js) | MIT | Database and private storage access |
| [exifr](https://github.com/MikeKovarik/exifr) | MIT | Photo metadata parsing |
| [Pino](https://github.com/pinojs/pino), [pino-http](https://github.com/pinojs/pino-http) | MIT | Structured request logging |
| [Zod](https://github.com/colinhacks/zod) | MIT | Configuration and inference validation |
| [sharp](https://github.com/lovell/sharp) | Apache-2.0 | Image processing and quality checks |
| [Prebuilt sharp-libvips Linux bundle](https://github.com/lovell/sharp-libvips/blob/main/npm/linux-x64/package.json) | LGPL-3.0-or-later | Bundled image processing dependencies; preserve separate notices |
| [Flask](https://github.com/pallets/flask) | BSD-3-Clause | Inference HTTP service |
| [Gunicorn](https://github.com/benoitc/gunicorn) | MIT | Inference application server |
| [NumPy](https://github.com/numpy/numpy) | BSD-3-Clause with distribution notices | Numerical inference |
| [Pillow](https://github.com/python-pillow/Pillow) | MIT-CMU | Image decode, orientation and mask export |
| [OpenCV](https://opencv.org/license/) | Apache-2.0 | Color transforms and mask processing |
| [PyYAML](https://github.com/yaml/pyyaml) | MIT | PlantVision configuration |
| [Node.js](https://github.com/nodejs/node/blob/main/LICENSE) | MIT with bundled third-party notices | API and website runtime |
| [Python](https://docs.python.org/3/license.html) | PSF license with included notices | Inference and training runtime |
| Apple SDK frameworks, SF Symbols and system fonts | Applicable Apple SDK and asset terms | iOS interface and built-in symbols |

## Training and development

[scikit-learn](https://github.com/scikit-learn/scikit-learn), pandas and
threadpoolctl use BSD-3-Clause. They support fitting and evaluating segmentation,
NDVI and provisional confidence. NumPy's distributions and the scientific stack
also carry notices for dependencies such as SciPy and numerical libraries.
pytest, Vitest, Supertest, ESLint, @eslint/js, globals and Prettier use MIT and
support tests, linting and formatting. Refer to the version manifests and retain
their bundled notices rather than assuming one license covers the full stack.

Ultralytics / MobileSAM appeared in earlier local annotation experiments.
They are not the selected LeafSegmenter runtime. Confirm their exact code and
weight licenses separately before reviving or demonstrating that path.
OpenPlants / ViT is optional research code, not active species detection.
CropAndWeedAndLeaf and other public segmentation downloads were examined during
research; they are not the selected v1.3.0 segmenter's public-supplement candidate.

## Services and development assistance

- [Supabase](https://supabase.com/terms): hosted database and storage terms.
- [Railway](https://railway.com/legal/terms): hosting terms.
- GitHub and GitHub Actions: hosting/automation terms; each Action has its own license.
- Apple Xcode, App Store Connect and TestFlight: applicable development/distribution terms.
- OpenAI Codex / ChatGPT and Anthropic Claude / Claude Code: development assistance
  under their respective service terms; see README for the team's disclosure.

## Data and image permissions

Lab / Daniel supplied Montgomery, Round 1 and newer paired GreenSeeker data.
Andres and Reynaldo supplied additional photos and mask annotations. Some
Reynaldo filenames identify outside sources including Unsplash, Pexels and
commercial plant pages. Confirm rights per image before public display.
App-icon authorship is not yet confirmed. Do not treat an image's presence in a
teammate export as a license or publish private raw data with this revision.

Product Owner permission and final public-example clearance remain open in
[the Showcase checklist](Backend/docs/SHOWCASE_CLEARANCE.md). When a photo or
outside visual appears in the slides, give its source on that slide or in a
clearly referenced credits slide and retain any required attribution.
