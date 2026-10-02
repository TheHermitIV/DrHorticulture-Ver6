import Foundation

/// The seam between the app and whatever produces an analysis. `MockAnalysisService`
/// implements it today; a real `APIAnalysisService` can replace it without any
/// view or model change.
protocol AnalysisService: Sendable {
    func analyze(imageData: Data?) async throws -> PlantAnalysis
}

enum AnalysisError: Error, Equatable {
    case requestFailed(String)
    case invalidResponse
}
