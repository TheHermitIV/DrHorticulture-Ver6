import Foundation

/// Stands in for the backend so the app runs without it.
///
/// The default scenario matches what the pipeline emits today — NDVI
/// unavailable, so the app abstains — while the other scenarios exercise the
/// remaining Results states.
struct MockAnalysisService: AnalysisService {
    enum Scenario: String, CaseIterable, Identifiable {
        case fertilize
        case doNotFertilize
        case abstain
        case failure

        var id: String { rawValue }

        var label: String {
            switch self {
            case .fertilize: return "Fertilize"
            case .doNotFertilize: return "Don't fertilize"
            case .abstain: return "Abstain"
            case .failure: return "Error"
            }
        }
    }

    var scenario: Scenario = .abstain

    func analyze(imageData: Data?) async throws -> PlantAnalysis {
        switch scenario {
        case .fertilize:
            return Self.analysis(ndvi: 0.31, confidence: 0.88, recommendation: "fertilize")
        case .doNotFertilize:
            return Self.analysis(ndvi: 0.72, confidence: 0.91, recommendation: "do_not_fertilize")
        case .abstain:
            return Self.unavailableAnalysis
        case .failure:
            throw AnalysisError.requestFailed("Mock failure")
        }
    }

    // MARK: - Canned payloads

    /// The shape the pipeline produces right now: a greenness proxy, no NDVI,
    /// no fertilization call.
    static let unavailableAnalysis = PlantAnalysis(
        image: "sample-plant.jpg",
        segmentation: Segmentation(leafPixels: 12_345, leafCoverage: 0.28, detections: 1),
        features: sampleFeatures,
        featureOrder: Array(sampleFeatures.keys).sorted(),
        greenness: Greenness(
            value: 105.7,
            metric: "exg",
            description: "average excess green (2G - R - B) over leaf pixels, 0-255 scale"
        ),
        ndvi: NDVI(
            status: ResponseStatus.unavailable,
            reason: "No sensor-trained NDVI model is available yet."
        ),
        species: sampleSpecies,
        fertilization: Fertilization(
            status: ResponseStatus.unavailable,
            reason: "A fertilization recommendation requires NDVI."
        )
    )

    /// The shape expected once the trained model and the backend's confidence
    /// score land.
    static func analysis(
        ndvi value: Double,
        confidence: Double,
        recommendation: String
    ) -> PlantAnalysis {
        PlantAnalysis(
            image: "sample-plant.jpg",
            segmentation: Segmentation(leafPixels: 12_345, leafCoverage: 0.28, detections: 1),
            features: sampleFeatures,
            featureOrder: Array(sampleFeatures.keys).sorted(),
            greenness: nil,
            ndvi: NDVI(
                status: ResponseStatus.available,
                value: value,
                model: "xgboost",
                confidence: confidence
            ),
            species: sampleSpecies,
            fertilization: Fertilization(
                status: ResponseStatus.available,
                recommendation: recommendation
            )
        )
    }

    static let sampleFeatures: [String: Double] = [
        "mean_r": 91.2,
        "mean_g": 134.5,
        "mean_b": 72.1,
        "exg": 105.7,
        "leaf_coverage": 0.28,
    ]

    static let sampleSpecies = Species(
        label: "Monstera deliciosa",
        confidence: 0.9,
        topK: [
            SpeciesCandidate(label: "Monstera deliciosa", confidence: 0.9),
            SpeciesCandidate(label: "Ficus elastica", confidence: 0.05),
        ]
    )
}
