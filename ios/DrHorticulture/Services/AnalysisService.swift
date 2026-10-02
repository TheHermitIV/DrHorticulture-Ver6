import Foundation

/// The seam between the app and the backend.
///
/// Mirrors `POST /api/v1/scans`: multipart with an `image` and a `species`.
/// `MockAnalysisService` implements it today; a real `APIAnalysisService` can
/// replace it without any view or model change.
protocol AnalysisService: Sendable {
    func analyze(imageData: Data, species: String) async throws -> Scan
}

/// Mirrors the backend's shared error envelope.
enum AnalysisError: Error, Equatable {
    /// 422 IMAGE_REJECTED — the quality gate refused the photo.
    case imageRejected(APIErrorBody)
    /// Any other 4xx/5xx with a decodable body.
    case api(APIErrorBody)
    /// Transport failure, timeout, or an undecodable response.
    case transport(String)
}
