import Foundation
import Testing

@testable import DrHorticulture

@MainActor
struct ResultsViewModelTests {
    private struct StubService: AnalysisService {
        let result: Result<PlantAnalysis, AnalysisError>

        func analyze(imageData: Data?) async throws -> PlantAnalysis {
            try result.get()
        }
    }

    @Test func startsLoading() {
        let viewModel = ResultsViewModel(service: MockAnalysisService())

        #expect(viewModel.phase == .loading)
    }

    @Test func loadsRecommendationState() async {
        let payload = MockAnalysisService.analysis(
            ndvi: 0.55, confidence: 0.8, recommendation: "fertilize"
        )
        let viewModel = ResultsViewModel(service: StubService(result: .success(payload)))

        await viewModel.load()

        #expect(viewModel.phase == .loaded(.recommendation(.fertilize, ndvi: 0.55, confidence: 0.8)))
    }

    @Test func loadsAbstentionState() async {
        let viewModel = ResultsViewModel(
            service: StubService(result: .success(MockAnalysisService.unavailableAnalysis))
        )

        await viewModel.load()

        #expect(viewModel.phase ==
            .loaded(.abstention(reason: "No sensor-trained NDVI model is available yet.")))
    }

    /// A thrown error is its own phase, not a silent abstention.
    @Test func surfacesServiceFailure() async {
        let viewModel = ResultsViewModel(
            service: StubService(result: .failure(.requestFailed("boom")))
        )

        await viewModel.load()

        #expect(viewModel.phase == .failed("Something went wrong. Try again."))
    }

    @Test func reloadsAfterServiceIsSwapped() async {
        let viewModel = ResultsViewModel(service: MockAnalysisService(scenario: .abstain))
        await viewModel.load()
        #expect(viewModel.phase == .loaded(.abstention(
            reason: "No sensor-trained NDVI model is available yet."
        )))

        viewModel.service = MockAnalysisService(scenario: .doNotFertilize)
        await viewModel.load()

        #expect(viewModel.phase ==
            .loaded(.recommendation(.doNotFertilize, ndvi: 0.72, confidence: 0.91)))
    }
}
