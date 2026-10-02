import Foundation
import Testing

@testable import DrHorticulture

/// Decoding is checked against payloads copied from the pipeline's real output
/// (`src/plantvision/cli/output.py`), never a live backend.
struct PlantAnalysisDecodingTests {
    private func decode(_ json: String) throws -> PlantAnalysis {
        try JSONDecoder().decode(PlantAnalysis.self, from: Data(json.utf8))
    }

    @Test func decodesCurrentPlaceholderResponse() throws {
        let analysis = try decode(Fixtures.placeholderResponse)

        #expect(analysis.image == "plant.jpg")
        #expect(analysis.segmentation?.leafPixels == 12_345)
        #expect(analysis.segmentation?.leafCoverage == 0.28)
        #expect(analysis.segmentation?.detections == 1)
        #expect(analysis.features?["exg"] == 105.7)
        #expect(analysis.featureOrder == ["mean_r", "mean_g", "mean_b", "exg"])
        #expect(analysis.greenness?.value == 105.7)
        #expect(analysis.greenness?.metric == "exg")
        #expect(analysis.ndvi?.status == "unavailable")
        #expect(analysis.ndvi?.isAvailable == false)
        #expect(analysis.ndvi?.value == nil)
        #expect(analysis.species?.label == "Digitalis purpurea")
        #expect(analysis.species?.topK?.count == 1)
        #expect(analysis.fertilization?.isAvailable == false)
        #expect(analysis.fertilization?.recommendation == nil)
    }

    @Test func decodesTrainedModelResponse() throws {
        let analysis = try decode(Fixtures.trainedModelResponse)

        #expect(analysis.ndvi?.isAvailable == true)
        #expect(analysis.ndvi?.value == 0.42)
        #expect(analysis.ndvi?.model == "xgboost")
        #expect(analysis.ndvi?.confidence == 0.87)
        // The greenness proxy is absent once a real model answers.
        #expect(analysis.greenness == nil)
        #expect(analysis.fertilization?.isAvailable == true)
        #expect(analysis.fertilization?.recommendation == "fertilize")
    }

    @Test func decodesEmptyObject() throws {
        let analysis = try decode("{}")

        #expect(analysis.image == nil)
        #expect(analysis.ndvi == nil)
        #expect(analysis.fertilization == nil)
        #expect(analysis.features == nil)
    }

    @Test func ignoresUnknownKeys() throws {
        let analysis = try decode(#"{"image":"a.jpg","brand_new_field":{"x":1}}"#)

        #expect(analysis.image == "a.jpg")
    }

    @Test func toleratesMissingNestedFields() throws {
        let analysis = try decode(#"{"ndvi":{"status":"available"},"segmentation":{}}"#)

        #expect(analysis.ndvi?.isAvailable == true)
        #expect(analysis.ndvi?.value == nil)
        #expect(analysis.segmentation?.leafPixels == nil)
    }

    @Test func treatsUnknownStatusAsUnavailable() throws {
        let analysis = try decode(#"{"ndvi":{"status":"pending","value":0.4}}"#)

        #expect(analysis.ndvi?.isAvailable == false)
    }

    @Test func statusComparisonIsCaseInsensitive() throws {
        let analysis = try decode(#"{"ndvi":{"status":"AVAILABLE","value":0.4}}"#)

        #expect(analysis.ndvi?.isAvailable == true)
    }

    @Test func rejectsMalformedFieldTypes() throws {
        // A string where a number belongs is a real decoding failure, not
        // something to silently paper over.
        #expect(throws: DecodingError.self) {
            _ = try decode(#"{"ndvi":{"status":"available","value":"not-a-number"}}"#)
        }
    }

    @Test func rejectsNonObjectPayload() throws {
        #expect(throws: DecodingError.self) {
            _ = try decode("[]")
        }
    }
}

enum Fixtures {
    /// Copied from `ARCHITECTURE.md` section 27 / `output.py` output today.
    static let placeholderResponse = """
    {
      "image": "plant.jpg",
      "segmentation": { "leaf_pixels": 12345, "leaf_coverage": 0.28, "detections": 1 },
      "features": { "mean_r": 91.2, "mean_g": 134.5, "mean_b": 72.1, "exg": 105.7 },
      "feature_order": ["mean_r", "mean_g", "mean_b", "exg"],
      "greenness": {
        "value": 105.7,
        "metric": "exg",
        "description": "average excess green (2G - R - B) over leaf pixels, 0-255 scale"
      },
      "species": {
        "label": "Digitalis purpurea",
        "confidence": 0.0944,
        "top_k": [{ "label": "Digitalis purpurea", "confidence": 0.0944 }]
      },
      "ndvi": { "status": "unavailable", "reason": "No sensor-trained NDVI model is available yet." },
      "fertilization": { "status": "unavailable", "reason": "A fertilization recommendation requires NDVI." }
    }
    """

    /// The shape expected once the trained model and a backend confidence land.
    static let trainedModelResponse = """
    {
      "image": "plant.jpg",
      "segmentation": { "leaf_pixels": 12345, "leaf_coverage": 0.28, "detections": 1 },
      "features": { "exg": 105.7 },
      "feature_order": ["exg"],
      "species": { "label": "Monstera deliciosa", "confidence": 0.9, "top_k": [] },
      "ndvi": { "status": "available", "value": 0.42, "model": "xgboost", "confidence": 0.87 },
      "fertilization": { "status": "available", "recommendation": "fertilize" }
    }
    """
}
