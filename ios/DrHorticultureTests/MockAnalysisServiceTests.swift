import Foundation
import Testing

@testable import DrHorticulture

struct MockAnalysisServiceTests {
    /// The default has to match what the pipeline actually returns today, so the
    /// app isn't optimistic about a model that doesn't exist.
    @Test func defaultScenarioMatchesTodaysPipelineOutput() async throws {
        let analysis = try await MockAnalysisService().analyze(imageData: nil)

        #expect(analysis.ndvi?.isAvailable == false)
        #expect(analysis.fertilization?.isAvailable == false)
        #expect(analysis.greenness?.metric == "exg")
        #expect(ResultsState(analysis: analysis) ==
            .abstention(reason: "No sensor-trained NDVI model is available yet."))
    }

    @Test func fertilizeScenarioProducesFertilizeRecommendation() async throws {
        let analysis = try await MockAnalysisService(scenario: .fertilize).analyze(imageData: nil)

        guard case .recommendation(let recommendation, _, let confidence) =
            ResultsState(analysis: analysis)
        else {
            Issue.record("Expected a recommendation state")
            return
        }
        #expect(recommendation == .fertilize)
        #expect(confidence > AbstentionThreshold.minimumConfidence)
    }

    @Test func doNotFertilizeScenarioProducesDoNotFertilizeRecommendation() async throws {
        let analysis = try await MockAnalysisService(scenario: .doNotFertilize)
            .analyze(imageData: nil)

        guard case .recommendation(let recommendation, _, _) = ResultsState(analysis: analysis)
        else {
            Issue.record("Expected a recommendation state")
            return
        }
        #expect(recommendation == .doNotFertilize)
    }

    @Test func abstainScenarioAbstains() async throws {
        let analysis = try await MockAnalysisService(scenario: .abstain).analyze(imageData: nil)

        guard case .abstention = ResultsState(analysis: analysis) else {
            Issue.record("Expected an abstention state")
            return
        }
    }

    @Test func failureScenarioThrows() async {
        await #expect(throws: AnalysisError.requestFailed("Mock failure")) {
            _ = try await MockAnalysisService(scenario: .failure).analyze(imageData: nil)
        }
    }

    @Test func everyScenarioIsSelectableAndLabelled() {
        #expect(MockAnalysisService.Scenario.allCases.count == 4)
        for scenario in MockAnalysisService.Scenario.allCases {
            #expect(!scenario.label.isEmpty)
        }
    }

    /// Round-tripping the canned payloads through JSON proves the mock stays
    /// decodable by the same model the real API will feed.
    @Test func cannedPayloadsSurviveAJSONRoundTrip() throws {
        let payloads = [
            MockAnalysisService.unavailableAnalysis,
            MockAnalysisService.analysis(ndvi: 0.31, confidence: 0.88, recommendation: "fertilize"),
        ]

        for payload in payloads {
            let data = try JSONEncoder().encode(payload)
            let decoded = try JSONDecoder().decode(PlantAnalysis.self, from: data)
            #expect(decoded == payload)
        }
    }
}
