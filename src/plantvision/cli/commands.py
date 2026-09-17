import argparse
import json
import sys

from plantvision import (
    PlantVisionError,
    SegmentationError,
    __version__,
)
from plantvision.cli.output import build_result, save_outputs
from plantvision.config.loader import load_config
from plantvision.features.extractor import FeatureExtractor
from plantvision.input.image_loader import load_image
from plantvision.ndvi.predictor import NDVIPredictor
from plantvision.segmentation.predictor import SegmentationPredictor
from plantvision.utils.logging import configure_logging, get_logger
from plantvision.utils.paths import default_output_dir


def run_pipeline(
    image_path,
    config,
    segmentation_model=None,
    output_dir=None,
    save_mask=False,
    save_overlay=False,
):
    logger = get_logger("pipeline")
    image = load_image(image_path)

    if segmentation_model is None:
        segmentation_result = SegmentationPredictor.from_config(config).segment(image)
    else:
        if not hasattr(segmentation_model, "predict"):
            raise TypeError("segmentation_model must expose a predict(image) method.")
        segmentation_result = segmentation_model.predict(image)
        if segmentation_result.combined_mask.shape != image.array.shape[:2]:
            raise SegmentationError(
                f"Mask shape {segmentation_result.combined_mask.shape} does not "
                f"match image {image.array.shape[:2]}."
            )
        if int(segmentation_result.combined_mask.sum()) == 0:
            raise SegmentationError("Segmentation returned no usable leaf pixels.")

    features_include = config.section("features").get("include") or None
    features = FeatureExtractor(feature_keys=features_include).extract(
        image.array, segmentation_result.combined_mask
    )

    prediction = NDVIPredictor.from_config(config).predict(features)

    result = build_result(image_path, segmentation_result, features, prediction)
    artifacts = save_outputs(
        result,
        output_dir or default_output_dir(),
        segmentation_result=segmentation_result,
        image=image.array,
        save_mask=save_mask,
        save_overlay=save_overlay,
    )
    logger.info("Predicted NDVI %s (%s)", prediction.value, prediction.type)
    return {"result": result, "artifacts": artifacts}


def build_parser():
    parser = argparse.ArgumentParser(
        prog="plantvision",
        description="Segment the leaf region of an RGB plant image, extract RGB "
        "features, and produce an NDVI estimate.",
    )
    parser.add_argument("image", help="Path to the input RGB plant image")
    parser.add_argument("--config-dir", default=None, help="Directory containing the YAML configs")
    parser.add_argument("--seg-model", default=None, help="Override the segmentation model weights path")
    parser.add_argument("--ndvi-model", default=None, help="Override the NDVI model weights path")
    parser.add_argument(
        "--ndvi-mode",
        choices=["proxy", "model", "auto"],
        default=None,
        help="Override the NDVI prediction mode",
    )
    parser.add_argument("--save-mask", action="store_true", help="Write outputs/mask.png")
    parser.add_argument("--save-overlay", action="store_true", help="Write outputs/overlay.png")
    parser.add_argument("--json", action="store_true", help="Print the full result as JSON")
    parser.add_argument("--output-dir", default=None, help="Directory for output artifacts")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    parser.add_argument("--version", action="version", version=f"plantvision {__version__}")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    configure_logging(args.log_level)
    logger = get_logger("cli")
    try:
        overrides = {}
        if args.seg_model:
            overrides.setdefault("segmentation", {})["model_path"] = args.seg_model
        if args.ndvi_model:
            overrides.setdefault("ndvi", {})["model_path"] = args.ndvi_model
        if args.ndvi_mode:
            overrides.setdefault("ndvi", {})["mode"] = args.ndvi_mode
        config = load_config(config_dir=args.config_dir, overrides=overrides)

        outcome = run_pipeline(
            args.image,
            config,
            output_dir=args.output_dir,
            save_mask=args.save_mask,
            save_overlay=args.save_overlay,
        )
        result = outcome["result"]

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            ndvi = result["ndvi"]
            print(f"image: {result['image']}")
            print(f"leaf coverage: {result['segmentation']['leaf_coverage']:.4f}")
            print(f"ndvi estimate: {ndvi['value']:.4f} ({ndvi['type']})")
            for name, path in outcome["artifacts"].items():
                print(f"saved {name}: {path}")
        return 0
    except PlantVisionError as exc:
        logger.error("%s", exc)
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        logger.exception("Unexpected error")
        print(f"unexpected error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())