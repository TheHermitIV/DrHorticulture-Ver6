import Foundation

/// What the Results screen shows. Derived purely from a decoded `Scan`, so the
/// three states are testable without building a view.
enum ResultsState: Equatable {
    /// The backend's call, with the reading behind it.
    case recommendation(Recommendation, ndvi: Double, confidence: Double)
    /// A usable reading the backend did not turn into a call.
    case reading(ndvi: Double, confidence: Double)
    /// No reliable answer — ask for another photo.
    case abstention(reason: String, hints: [String] = [])
}

/// The backend's `recommendation` enum. `abstain` is deliberately not a case
/// here: it maps to `ResultsState.abstention`.
enum Recommendation: String, Equatable {
    case fertilize
    case doNotFertilize = "do_not_fertilize"

    init?(responseValue: String?) {
        guard let raw = responseValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            !raw.isEmpty
        else { return nil }
        self.init(rawValue: raw)
    }
}

/// Copy for the `abstain_reason` values the decision policy emits
/// (`api/src/services/decision.js`).
enum AbstentionReason {
    static let generic = "Couldn't get a reliable reading, try again."

    static func copy(for reason: String?) -> String {
        switch reason?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "low_confidence":
            return "The reading wasn't confident enough to make a call."
        case "low_mask_confidence":
            return "The plant couldn't be found clearly in the photo."
        case let other? where !other.isEmpty:
            return other
        default:
            return generic
        }
    }

    /// Copy for a scan the quality gate or the system rejected.
    static func copy(for status: ScanStatus?) -> String {
        switch status {
        case .rejected:
            return "That photo didn't pass the quality check."
        case .failed:
            return "The analysis didn't finish. Try again."
        case .processing, .uploaded:
            return "The analysis is still running."
        default:
            return generic
        }
    }
}

extension ResultsState {
    /// Maps a scan onto one of the three Results states.
    ///
    /// The backend owns the decision: it has already applied the active
    /// `decision_config` thresholds, so the app reads `recommendation` rather
    /// than comparing `confidence` against a local threshold.
    init(scan: Scan) {
        guard let result = scan.result else {
            self = .abstention(
                reason: AbstentionReason.copy(for: scan.scanStatus),
                hints: []
            )
            return
        }

        let raw = result.recommendation?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if raw == "abstain" {
            self = .abstention(reason: AbstentionReason.copy(for: result.abstainReason))
            return
        }

        guard let ndvi = result.ndvi, ndvi.isFinite,
              let confidence = result.confidence, confidence.isFinite
        else {
            self = .abstention(reason: AbstentionReason.copy(for: result.abstainReason))
            return
        }

        if let recommendation = Recommendation(responseValue: result.recommendation) {
            self = .recommendation(recommendation, ndvi: ndvi, confidence: confidence)
        } else {
            // A recommendation we don't recognise is never guessed at; the
            // reading alone is still honest.
            self = .reading(ndvi: ndvi, confidence: confidence)
        }
    }

    /// Maps a rejected upload, whose reasons and hints come back in the error
    /// body rather than in a scan.
    init(rejection: APIErrorBody) {
        self = .abstention(
            reason: rejection.message ?? "That photo didn't pass the quality check.",
            hints: rejection.details?.hints ?? []
        )
    }
}
