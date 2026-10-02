import Foundation
import Observation

/// Loads an analysis and exposes it as one of the three Results states.
@MainActor
@Observable
final class ResultsViewModel {
    enum Phase: Equatable {
        case loading
        case loaded(ResultsState)
        case failed(String)
    }

    var service: any AnalysisService
    var phase: Phase = .loading

    init(service: any AnalysisService) {
        self.service = service
    }

    func load(imageData: Data? = nil) async {
        phase = .loading
        do {
            let analysis = try await service.analyze(imageData: imageData)
            phase = .loaded(ResultsState(analysis: analysis))
        } catch {
            phase = .failed("Something went wrong. Try again.")
        }
    }
}
