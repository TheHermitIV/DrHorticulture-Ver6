import Foundation
import Testing

@testable import DrHorticulture

@MainActor
struct ResultsViewModelTests {
    private let image = Data([0xFF, 0xD8, 0xFF])

    private struct StubService: AnalysisService {
        var result: Result<Scan, AnalysisError>
        func analyze(imageData: Data, species: String) async throws -> Scan {
            try result.get()
        }
    }

    @Test func startsLoading() {
        #expect(ResultsViewModel(service: MockAnalysisService()).phase == .loading)
    }

    @Test func loadsRecommendationState() async {
        let scan = MockAnalysisService.completed(
            species: "geranium", recommendation: "fertilize", ndvi: 0.55, confidence: 0.8
        )
        let viewModel = ResultsViewModel(service: StubService(result: .success(scan)))

        await viewModel.load(imageData: image, species: "geranium")

        #expect(viewModel.phase ==
            .loaded(.recommendation(.fertilize, ndvi: 0.55, confidence: 0.8)))
    }

    @Test func loadsAbstentionState() async {
        let viewModel = ResultsViewModel(
            service: StubService(result: .success(MockAnalysisService.abstained(species: "basil")))
        )

        await viewModel.load(imageData: image, species: "basil")

        #expect(viewModel.phase ==
            .loaded(.abstention(reason: "The reading wasn't confident enough to make a call.")))
    }

    /// A rejected photo is a retake prompt with hints, not a dead end.
    @Test func rejectionBecomesAnAbstentionWithHints() async {
        let body = APIErrorBody(
            code: "IMAGE_REJECTED",
            message: "Photo is too dark.",
            details: APIErrorDetails(reasons: ["too_dark"], hints: ["Move to bright light."])
        )
        let viewModel = ResultsViewModel(service: StubService(result: .failure(.imageRejected(body))))

        await viewModel.load(imageData: image, species: "geranium")

        #expect(viewModel.phase ==
            .loaded(.abstention(reason: "Photo is too dark.", hints: ["Move to bright light."])))
    }

    @Test func apiErrorSurfacesTheBackendsMessage() async {
        let body = APIErrorBody(code: "INFERENCE_UNAVAILABLE", message: "Timed out.")
        let viewModel = ResultsViewModel(service: StubService(result: .failure(.api(body))))

        await viewModel.load(imageData: image, species: "geranium")

        #expect(viewModel.phase == .failed("Timed out."))
    }

    @Test func transportErrorSurfaces() async {
        let viewModel = ResultsViewModel(
            service: StubService(result: .failure(.transport("No connection.")))
        )

        await viewModel.load(imageData: image, species: "geranium")

        #expect(viewModel.phase == .failed("No connection."))
    }

    /// Reaching Results with no photo is a programming error, not an abstention.
    @Test func missingImageFailsWithoutCallingTheService() async {
        let viewModel = ResultsViewModel(service: MockAnalysisService(scenario: .fertilize))

        await viewModel.load(imageData: nil, species: "geranium")

        #expect(viewModel.phase == .failed("No photo to analyze. Take or choose one first."))
    }

    @Test func reloadsAfterServiceIsSwapped() async {
        let viewModel = ResultsViewModel(service: MockAnalysisService(scenario: .abstain))
        await viewModel.load(imageData: image, species: "basil")
        guard case .loaded(.abstention) = viewModel.phase else {
            Issue.record("Expected abstention first")
            return
        }

        viewModel.service = MockAnalysisService(scenario: .doNotFertilize)
        await viewModel.load(imageData: image, species: "basil")

        #expect(viewModel.phase ==
            .loaded(.recommendation(.doNotFertilize, ndvi: 0.72, confidence: 0.9)))
    }
}
