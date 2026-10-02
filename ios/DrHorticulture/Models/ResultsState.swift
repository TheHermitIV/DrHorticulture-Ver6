import Foundation

/// What the Results screen shows. Derived purely from a decoded `PlantAnalysis`,
/// so the three states are testable without building a view.
enum ResultsState: Equatable {
    /// A fertilize / don't-fertilize call, backed by a reading.
    case recommendation(Recommendation, ndvi: Double, confidence: Double)
    /// A usable reading, but no recommendation from the backend yet.
    case reading(ndvi: Double, confidence: Double)
    /// Not confident enough to report anything — ask for another photo.
    case abstention(reason: String)
}

enum Recommendation: Equatable {
    case fertilize
    case doNotFertilize

    /// The backend's recommendation vocabulary isn't fixed yet, so an
    /// unrecognised string falls back to showing the reading alone rather than
    /// guessing at a call.
    init?(responseValue: String?) {
        guard let value = responseValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            !value.isEmpty
        else { return nil }

        if Self.fertilizeValues.contains(value) {
            self = .fertilize
        } else if Self.doNotFertilizeValues.contains(value) {
            self = .doNotFertilize
        } else {
            return nil
        }
    }

    private static let fertilizeValues: Set<String> = [
        "fertilize", "fertilise", "yes", "true", "recommended",
    ]

    private static let doNotFertilizeValues: Set<String> = [
        "do_not_fertilize", "do not fertilize", "dont_fertilize",
        "don't fertilize", "no", "false", "not_recommended", "not recommended",
    ]
}

enum AbstentionThreshold {
    /// A reading is shown only when confidence is strictly above this value —
    /// exactly at the threshold abstains.
    static let minimumConfidence = 0.5

    static func isConfident(_ confidence: Double?) -> Bool {
        guard let confidence, confidence.isFinite else { return false }
        return confidence > minimumConfidence && confidence <= 1.0
    }
}

enum AbstentionReason {
    static let lowConfidence =
        "Couldn't get a reliable reading, try again."
    static let noReading =
        "Couldn't get a reliable reading, try again."
}

extension ResultsState {
    /// Maps a response onto one of the three Results states.
    init(analysis: PlantAnalysis) {
        guard let ndvi = analysis.ndvi,
              ndvi.isAvailable,
              let value = ndvi.value,
              value.isFinite
        else {
            self = .abstention(reason: analysis.ndvi?.reason ?? AbstentionReason.noReading)
            return
        }

        guard AbstentionThreshold.isConfident(ndvi.confidence),
              let confidence = ndvi.confidence
        else {
            self = .abstention(reason: AbstentionReason.lowConfidence)
            return
        }

        if let fertilization = analysis.fertilization,
           fertilization.isAvailable,
           let recommendation = Recommendation(responseValue: fertilization.recommendation) {
            self = .recommendation(recommendation, ndvi: value, confidence: confidence)
        } else {
            self = .reading(ndvi: value, confidence: confidence)
        }
    }
}
