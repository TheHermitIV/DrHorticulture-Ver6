import Foundation
import Testing

@testable import DrHorticulture

struct ResultsStateTests {
    private func analysis(
        ndviStatus: String? = ResponseStatus.available,
        ndviValue: Double? = 0.42,
        confidence: Double? = 0.9,
        ndviReason: String? = nil,
        fertilizationStatus: String? = nil,
        recommendation: String? = nil
    ) -> PlantAnalysis {
        PlantAnalysis(
            ndvi: ndviStatus == nil && ndviValue == nil && confidence == nil && ndviReason == nil
                ? nil
                : NDVI(
                    status: ndviStatus,
                    value: ndviValue,
                    reason: ndviReason,
                    confidence: confidence
                ),
            fertilization: fertilizationStatus == nil && recommendation == nil
                ? nil
                : Fertilization(status: fertilizationStatus, recommendation: recommendation)
        )
    }

    // MARK: - Recommendation state

    @Test func fertilizeRecommendation() {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: "fertilize"
        ))

        #expect(state == .recommendation(.fertilize, ndvi: 0.42, confidence: 0.9))
    }

    @Test func doNotFertilizeRecommendation() {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: "do_not_fertilize"
        ))

        #expect(state == .recommendation(.doNotFertilize, ndvi: 0.42, confidence: 0.9))
    }

    @Test(arguments: [
        "Fertilize", "  FERTILIZE  ", "yes", "true", "recommended",
    ])
    func fertilizeSynonymsAndCasing(value: String) {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: value
        ))

        #expect(state == .recommendation(.fertilize, ndvi: 0.42, confidence: 0.9))
    }

    @Test(arguments: [
        "DO_NOT_FERTILIZE", "do not fertilize", "no", "false", "not recommended",
    ])
    func doNotFertilizeSynonymsAndCasing(value: String) {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: value
        ))

        #expect(state == .recommendation(.doNotFertilize, ndvi: 0.42, confidence: 0.9))
    }

    // MARK: - Reading state

    @Test func readingWhenFertilizationUnavailable() {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.unavailable,
            recommendation: nil
        ))

        #expect(state == .reading(ndvi: 0.42, confidence: 0.9))
    }

    @Test func readingWhenFertilizationBlockMissing() {
        #expect(ResultsState(analysis: analysis()) == .reading(ndvi: 0.42, confidence: 0.9))
    }

    /// An unrecognised recommendation string must not be guessed at — the
    /// backend's vocabulary isn't fixed yet.
    @Test func readingWhenRecommendationUnrecognized() {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: "maybe_later"
        ))

        #expect(state == .reading(ndvi: 0.42, confidence: 0.9))
    }

    @Test func readingWhenRecommendationEmpty() {
        let state = ResultsState(analysis: analysis(
            fertilizationStatus: ResponseStatus.available,
            recommendation: "   "
        ))

        #expect(state == .reading(ndvi: 0.42, confidence: 0.9))
    }

    // MARK: - Abstention: threshold edges

    /// The threshold itself abstains — confidence must be strictly above it.
    @Test func confidenceExactlyAtThresholdAbstains() {
        let state = ResultsState(analysis: analysis(confidence: 0.5))

        #expect(state == .abstention(reason: AbstentionReason.lowConfidence))
    }

    @Test func confidenceJustAboveThresholdIsShown() {
        let state = ResultsState(analysis: analysis(confidence: 0.5000001))

        #expect(state == .reading(ndvi: 0.42, confidence: 0.5000001))
    }

    @Test func confidenceJustBelowThresholdAbstains() {
        #expect(ResultsState(analysis: analysis(confidence: 0.4999999)) ==
            .abstention(reason: AbstentionReason.lowConfidence))
    }

    @Test func fullConfidenceIsShown() {
        #expect(ResultsState(analysis: analysis(confidence: 1.0)) ==
            .reading(ndvi: 0.42, confidence: 1.0))
    }

    @Test(arguments: [0.0, -0.3, 1.2, Double.infinity, -Double.infinity, Double.nan])
    func invalidOrOutOfRangeConfidenceAbstains(confidence: Double) {
        #expect(ResultsState(analysis: analysis(confidence: confidence)) ==
            .abstention(reason: AbstentionReason.lowConfidence))
    }

    /// The field the backend doesn't send yet.
    @Test func missingConfidenceAbstains() {
        #expect(ResultsState(analysis: analysis(confidence: nil)) ==
            .abstention(reason: AbstentionReason.lowConfidence))
    }

    // MARK: - Abstention: no usable reading

    @Test func unavailableNDVIAbstainsWithBackendReason() {
        let state = ResultsState(analysis: analysis(
            ndviStatus: ResponseStatus.unavailable,
            ndviValue: nil,
            confidence: nil,
            ndviReason: "No sensor-trained NDVI model is available yet."
        ))

        #expect(state == .abstention(reason: "No sensor-trained NDVI model is available yet."))
    }

    @Test func unavailableNDVIWithoutReasonUsesDefaultCopy() {
        let state = ResultsState(analysis: analysis(
            ndviStatus: ResponseStatus.unavailable,
            ndviValue: nil,
            confidence: nil
        ))

        #expect(state == .abstention(reason: AbstentionReason.noReading))
    }

    @Test func missingNDVIBlockAbstains() {
        let state = ResultsState(analysis: PlantAnalysis())

        #expect(state == .abstention(reason: AbstentionReason.noReading))
    }

    /// Status says available but no number came with it.
    @Test func availableStatusWithoutValueAbstains() {
        let state = ResultsState(analysis: analysis(ndviValue: nil))

        #expect(state == .abstention(reason: AbstentionReason.noReading))
    }

    @Test func nonFiniteNDVIValueAbstains() {
        #expect(ResultsState(analysis: analysis(ndviValue: Double.nan)) ==
            .abstention(reason: AbstentionReason.noReading))
    }

    @Test func unknownStatusAbstains() {
        #expect(ResultsState(analysis: analysis(ndviStatus: "pending")) ==
            .abstention(reason: AbstentionReason.noReading))
    }

    /// The greenness proxy must never be mistaken for a reading.
    @Test func greennessAloneDoesNotProduceAReading() {
        var payload = PlantAnalysis()
        payload.greenness = Greenness(value: 105.7, metric: "exg")

        #expect(ResultsState(analysis: payload) ==
            .abstention(reason: AbstentionReason.noReading))
    }

    @Test func thresholdConstantIsHalf() {
        #expect(AbstentionThreshold.minimumConfidence == 0.5)
    }
}
