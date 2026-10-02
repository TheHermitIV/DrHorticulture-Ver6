import Foundation
import Testing

@testable import DrHorticulture

struct MockAnalysisServiceTests {
    private let image = Data([0xFF, 0xD8, 0xFF])

    @Test func fertilizeScenario() async throws {
        let scan = try await MockAnalysisService(scenario: .fertilize)
            .analyze(imageData: image, species: "geranium")

        #expect(scan.scanStatus == .completed)
        #expect(ResultsState(scan: scan) ==
            .recommendation(.fertilize, ndvi: 0.41, confidence: 0.82))
    }

    @Test func doNotFertilizeScenario() async throws {
        let scan = try await MockAnalysisService(scenario: .doNotFertilize)
            .analyze(imageData: image, species: "basil")

        guard case .recommendation(let recommendation, _, _) = ResultsState(scan: scan) else {
            Issue.record("Expected a recommendation state")
            return
        }
        #expect(recommendation == .doNotFertilize)
    }

    /// Abstained is the model's own call and must carry a reason, not look like
    /// a system failure.
    @Test func abstainScenario() async throws {
        let scan = try await MockAnalysisService(scenario: .abstain)
            .analyze(imageData: image, species: "tomato")

        #expect(scan.scanStatus == .abstained)
        #expect(scan.result?.abstainReason == "low_confidence")
        guard case .abstention = ResultsState(scan: scan) else {
            Issue.record("Expected an abstention state")
            return
        }
    }

    @Test func rejectedScenarioThrowsWithRetakeHints() async throws {
        do {
            _ = try await MockAnalysisService(scenario: .rejected)
                .analyze(imageData: image, species: "geranium")
            Issue.record("Expected a rejection")
        } catch let error as AnalysisError {
            guard case .imageRejected(let body) = error else {
                Issue.record("Expected imageRejected, got \(error)")
                return
            }
            #expect(body.code == "IMAGE_REJECTED")
            #expect(body.details?.hints?.isEmpty == false)
        }
    }

    @Test func failureScenarioThrowsAnAPIError() async throws {
        do {
            _ = try await MockAnalysisService(scenario: .failure)
                .analyze(imageData: image, species: "geranium")
            Issue.record("Expected a failure")
        } catch let error as AnalysisError {
            guard case .api(let body) = error else {
                Issue.record("Expected api, got \(error)")
                return
            }
            #expect(body.code == "INFERENCE_UNAVAILABLE")
        }
    }

    /// The species the caller passes has to reach the scan, since the endpoint
    /// requires it.
    @Test(arguments: MockAnalysisService.Scenario.allCases.filter {
        $0 != .rejected && $0 != .failure
    })
    func scenarioEchoesTheRequestedSpecies(scenario: MockAnalysisService.Scenario) async throws {
        let scan = try await MockAnalysisService(scenario: scenario)
            .analyze(imageData: image, species: "pothos")

        #expect(scan.species == "pothos")
    }

    @Test func everyScenarioIsSelectableAndLabelled() {
        #expect(MockAnalysisService.Scenario.allCases.count == 5)
        for scenario in MockAnalysisService.Scenario.allCases {
            #expect(!scenario.label.isEmpty)
        }
    }

    /// Round-tripping the canned payloads proves the mock stays decodable by the
    /// same model the real API will feed.
    @Test func cannedPayloadsSurviveAJSONRoundTrip() throws {
        let payloads = [
            MockAnalysisService.completed(
                species: "geranium", recommendation: "fertilize", ndvi: 0.41, confidence: 0.82
            ),
            MockAnalysisService.abstained(species: "basil"),
        ]

        for payload in payloads {
            let data = try JSONEncoder().encode(payload)
            #expect(try JSONDecoder().decode(Scan.self, from: data) == payload)
        }
    }
}
