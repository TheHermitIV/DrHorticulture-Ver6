import Foundation
import Testing

@testable import DrHorticulture

struct ResultsStateTests {
    private func scan(
        status: String? = "completed",
        recommendation: String? = "fertilize",
        ndvi: Double? = 0.41,
        confidence: Double? = 0.82,
        abstainReason: String? = nil,
        hasResult: Bool = true
    ) -> Scan {
        Scan(
            scanId: "a",
            species: "geranium",
            status: status,
            result: hasResult
                ? AnalysisResult(
                    recommendation: recommendation,
                    ndvi: ndvi,
                    confidence: confidence,
                    abstainReason: abstainReason,
                    modelVersion: "stub-0.1",
                    configVersion: 1
                )
                : nil
        )
    }

    // MARK: - Recommendation

    @Test func fertilizeRecommendation() {
        #expect(ResultsState(scan: scan()) ==
            .recommendation(.fertilize, ndvi: 0.41, confidence: 0.82))
    }

    @Test func doNotFertilizeRecommendation() {
        #expect(ResultsState(scan: scan(recommendation: "do_not_fertilize")) ==
            .recommendation(.doNotFertilize, ndvi: 0.41, confidence: 0.82))
    }

    @Test(arguments: ["FERTILIZE", "  fertilize  ", "Fertilize"])
    func recommendationCasingAndPaddingTolerated(value: String) {
        #expect(ResultsState(scan: scan(recommendation: value)) ==
            .recommendation(.fertilize, ndvi: 0.41, confidence: 0.82))
    }

    /// The backend applies decision_config, so a low confidence paired with a
    /// real recommendation is still shown — the app must not second-guess it.
    @Test func lowConfidenceWithARecommendationIsStillShown() {
        #expect(ResultsState(scan: scan(confidence: 0.05)) ==
            .recommendation(.fertilize, ndvi: 0.41, confidence: 0.05))
    }

    // MARK: - Abstention from the backend's own decision

    @Test func abstainRecommendationAbstains() {
        #expect(ResultsState(scan: scan(recommendation: "abstain", abstainReason: "low_confidence")) ==
            .abstention(reason: "The reading wasn't confident enough to make a call."))
    }

    @Test func abstainOnLowMaskConfidence() {
        let state = ResultsState(
            scan: scan(recommendation: "abstain", abstainReason: "low_mask_confidence")
        )

        #expect(state == .abstention(reason: "The plant couldn't be found clearly in the photo."))
    }

    @Test func abstainWithNoReasonUsesGenericCopy() {
        #expect(ResultsState(scan: scan(recommendation: "abstain")) ==
            .abstention(reason: AbstentionReason.generic))
    }

    /// A reason the app doesn't have copy for is surfaced rather than swallowed.
    @Test func unknownAbstainReasonIsPassedThrough() {
        #expect(ResultsState(scan: scan(recommendation: "abstain", abstainReason: "weird_new_reason")) ==
            .abstention(reason: "weird_new_reason"))
    }

    // MARK: - Abstention from a missing result

    @Test(arguments: [
        ("rejected", "That photo didn't pass the quality check."),
        ("failed", "The analysis didn't finish. Try again."),
        ("processing", "The analysis is still running."),
        ("uploaded", "The analysis is still running."),
    ])
    func missingResultAbstainsWithStatusCopy(status: String, expected: String) {
        #expect(ResultsState(scan: scan(status: status, hasResult: false)) ==
            .abstention(reason: expected))
    }

    @Test func emptyScanAbstains() {
        #expect(ResultsState(scan: Scan()) == .abstention(reason: AbstentionReason.generic))
    }

    // MARK: - Reading

    @Test func unrecognisedRecommendationFallsBackToTheReading() {
        #expect(ResultsState(scan: scan(recommendation: "maybe_later")) ==
            .reading(ndvi: 0.41, confidence: 0.82))
    }

    @Test func missingRecommendationFallsBackToTheReading() {
        #expect(ResultsState(scan: scan(recommendation: nil)) ==
            .reading(ndvi: 0.41, confidence: 0.82))
    }

    // MARK: - Bad numbers

    @Test(arguments: [Double.nan, .infinity, -.infinity])
    func nonFiniteNDVIAbstains(value: Double) {
        #expect(ResultsState(scan: scan(ndvi: value)) ==
            .abstention(reason: AbstentionReason.generic))
    }

    @Test func missingNDVIAbstains() {
        #expect(ResultsState(scan: scan(ndvi: nil)) ==
            .abstention(reason: AbstentionReason.generic))
    }

    @Test func missingConfidenceAbstains() {
        #expect(ResultsState(scan: scan(confidence: nil)) ==
            .abstention(reason: AbstentionReason.generic))
    }

    @Test func nonFiniteConfidenceAbstains() {
        #expect(ResultsState(scan: scan(confidence: Double.nan)) ==
            .abstention(reason: AbstentionReason.generic))
    }

    // MARK: - Rejection

    @Test func rejectionCarriesTheBackendsHints() {
        let body = APIErrorBody(
            code: "IMAGE_REJECTED",
            message: "Photo is too dark.",
            details: APIErrorDetails(reasons: ["too_dark"], hints: ["Move to bright light."])
        )

        #expect(ResultsState(rejection: body) ==
            .abstention(reason: "Photo is too dark.", hints: ["Move to bright light."]))
    }

    @Test func rejectionWithoutHintsStillAbstains() {
        let body = APIErrorBody(code: "IMAGE_REJECTED", message: nil, details: nil)

        #expect(ResultsState(rejection: body) ==
            .abstention(reason: "That photo didn't pass the quality check.", hints: []))
    }

    // MARK: - Enum mapping

    @Test func recommendationRawValuesMatchTheSchema() {
        #expect(Recommendation.fertilize.rawValue == "fertilize")
        #expect(Recommendation.doNotFertilize.rawValue == "do_not_fertilize")
        // `abstain` is a state, not a Recommendation case.
        #expect(Recommendation(responseValue: "abstain") == nil)
    }
}
