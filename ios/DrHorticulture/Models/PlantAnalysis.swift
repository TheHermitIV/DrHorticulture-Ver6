import Foundation

/// Mirrors the analysis response produced by the plantvision pipeline
/// (`src/plantvision/cli/output.py` -> `outputs/prediction.json`), which the
/// backend upload endpoint wraps.
///
/// Every field the pipeline emits conditionally is optional here, so a partial
/// or in-progress payload still decodes instead of throwing. Nothing in the app
/// assumes a field is present.
struct PlantAnalysis: Codable, Equatable {
    var image: String?
    var segmentation: Segmentation?
    var features: [String: Double]?
    var featureOrder: [String]?
    var greenness: Greenness?
    var ndvi: NDVI?
    var species: Species?
    var fertilization: Fertilization?

    enum CodingKeys: String, CodingKey {
        case image
        case segmentation
        case features
        case featureOrder = "feature_order"
        case greenness
        case ndvi
        case species
        case fertilization
    }
}

struct Segmentation: Codable, Equatable {
    var leafPixels: Int?
    var leafCoverage: Double?
    var detections: Int?

    enum CodingKeys: String, CodingKey {
        case leafPixels = "leaf_pixels"
        case leafCoverage = "leaf_coverage"
        case detections
    }
}

/// The RGB colour proxy the pipeline emits until a sensor-trained NDVI model
/// exists. Deliberately kept separate from `NDVI` so the two are never confused.
struct Greenness: Codable, Equatable {
    var value: Double?
    var metric: String?
    var description: String?
}

struct NDVI: Codable, Equatable {
    var status: String?
    var value: Double?
    var model: String?
    var reason: String?

    /// Not emitted by the pipeline or backend yet — see the note in CLAUDE.md.
    /// The app reads it now so no redesign is needed once it arrives.
    var confidence: Double?

    var isAvailable: Bool {
        status?.caseInsensitiveCompare(ResponseStatus.available) == .orderedSame
    }
}

struct Species: Codable, Equatable {
    var label: String?
    var confidence: Double?
    var topK: [SpeciesCandidate]?

    enum CodingKeys: String, CodingKey {
        case label
        case confidence
        case topK = "top_k"
    }
}

struct SpeciesCandidate: Codable, Equatable {
    var label: String?
    var confidence: Double?
}

struct Fertilization: Codable, Equatable {
    var status: String?
    var recommendation: String?
    var reason: String?

    var isAvailable: Bool {
        status?.caseInsensitiveCompare(ResponseStatus.available) == .orderedSame
    }
}

/// The status strings the pipeline writes.
enum ResponseStatus {
    static let available = "available"
    static let unavailable = "unavailable"
}
