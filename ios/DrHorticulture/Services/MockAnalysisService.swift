import Foundation

/// Stands in for the backend so the app runs without it. Every payload matches
/// the scan object in `docs/BACKEND_SPEC.md`.
struct MockAnalysisService: AnalysisService {
    enum Scenario: String, CaseIterable, Identifiable {
        case fertilize
        case doNotFertilize
        case abstain
        case rejected
        case failure

        var id: String { rawValue }

        var label: String {
            switch self {
            case .fertilize: return "Fertilize"
            case .doNotFertilize: return "Don't fertilize"
            case .abstain: return "Abstain"
            case .rejected: return "Rejected"
            case .failure: return "Error"
            }
        }
    }

    var scenario: Scenario = .fertilize

    func analyze(imageData: Data, species: String) async throws -> Scan {
        switch scenario {
        case .fertilize:
            return Self.completed(
                species: species, recommendation: "fertilize", ndvi: 0.41, confidence: 0.82
            )
        case .doNotFertilize:
            return Self.completed(
                species: species, recommendation: "do_not_fertilize", ndvi: 0.72, confidence: 0.9
            )
        case .abstain:
            return Self.abstained(species: species)
        case .rejected:
            throw AnalysisError.imageRejected(
                APIErrorBody(
                    code: "IMAGE_REJECTED",
                    message: "Photo is too dark.",
                    details: APIErrorDetails(
                        reasons: ["too_dark"],
                        hints: ["Move to bright, indirect light."]
                    ),
                    scanId: Self.scanId,
                    requestId: Self.requestId
                )
            )
        case .failure:
            throw AnalysisError.api(
                APIErrorBody(
                    code: "INFERENCE_UNAVAILABLE",
                    message: "The analysis service didn't respond.",
                    requestId: Self.requestId
                )
            )
        }
    }

    // MARK: - Canned payloads

    static func completed(
        species: String,
        recommendation: String,
        ndvi: Double,
        confidence: Double
    ) -> Scan {
        Scan(
            scanId: scanId,
            species: species,
            status: ScanStatus.completed.rawValue,
            image: sampleImage,
            result: AnalysisResult(
                recommendation: recommendation,
                ndvi: ndvi,
                confidence: confidence,
                abstainReason: nil,
                modelVersion: "stub-0.1",
                configVersion: 1
            ),
            createdAt: "2026-10-01T15:04:05Z"
        )
    }

    /// The model declined to call it — distinct from a system failure, because
    /// abstention rate is an evaluation metric.
    static func abstained(species: String) -> Scan {
        Scan(
            scanId: scanId,
            species: species,
            status: ScanStatus.abstained.rawValue,
            image: sampleImage,
            result: AnalysisResult(
                recommendation: "abstain",
                ndvi: 0.33,
                confidence: 0.21,
                abstainReason: "low_confidence",
                modelVersion: "stub-0.1",
                configVersion: 1
            ),
            createdAt: "2026-10-01T15:04:05Z"
        )
    }

    static let scanId = "00000000-0000-4000-8000-000000000001"
    static let requestId = "00000000-0000-4000-8000-0000000000ff"

    static let sampleImage = ScanImage(
        id: "00000000-0000-4000-8000-000000000002",
        url: "https://example.invalid/signed/sample.jpg",
        quality: ImageQuality(passed: true, metrics: ["blur": 142.0, "exposure": 0.48])
    )
}
