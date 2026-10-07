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

    func load(imageData: Data?, species: String) async {
        phase = .loading

        guard let imageData else {
            phase = .failed("No photo to analyze. Take or choose one first.")
            return
        }

        do {
            let scan = try await service.analyze(imageData: imageData, species: species)
            phase = .loaded(ResultsState(scan: scan))
        } catch let error as AnalysisError {
            phase = Self.phase(for: error)
        } catch {
            phase = .failed("Something went wrong. Try again.")
        }
    }

    /// A rejected photo is a retake prompt with the backend's own hints, not a
    /// generic error.
    private static func phase(for error: AnalysisError) -> Phase {
        switch error {
        case .imageRejected(let body):
            return .loaded(ResultsState(rejection: body))
        case .api(let body):
            return .failed(body.message ?? "Something went wrong. Try again.")
        case .transport(let message):
            return .failed(message)
        }
    }
}
