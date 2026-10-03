import Foundation

/// The scan object returned by every `/api/v1/scans` endpoint.
/// Contract: `docs/BACKEND_SPEC.md` -> API specification.
///
/// Every field is optional so a partial or in-progress payload still decodes.
/// `result` is null while the status is `processing`, `rejected` or `failed`.
struct Scan: Codable, Equatable {
    var scanId: String?
    var species: String?
    var status: String?
    var image: ScanImage?
    var result: AnalysisResult?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case scanId = "scan_id"
        case species
        case status
        case image
        case result
        case createdAt = "created_at"
    }
}

struct ScanImage: Codable, Equatable {
    var id: String?
    var url: String?
    var quality: ImageQuality?
}

struct ImageQuality: Codable, Equatable {
    var passed: Bool?
    var metrics: [String: Double]?
}

/// One analysis run. The backend has already applied the active
/// `decision_config`, so `recommendation` is the decision — the app never
/// re-derives it from `confidence`.
struct AnalysisResult: Codable, Equatable {
    var recommendation: String?
    var ndvi: Double?
    var confidence: Double?
    var abstainReason: String?
    var modelVersion: String?
    var configVersion: Int?

    enum CodingKeys: String, CodingKey {
        case recommendation
        case ndvi
        case confidence
        case abstainReason = "abstain_reason"
        case modelVersion = "model_version"
        case configVersion = "config_version"
    }
}

/// `scan_status` in the backend's schema.
enum ScanStatus: String {
    case uploaded
    case rejected
    case processing
    case completed
    case abstained
    case failed
}

extension Scan {
    var scanStatus: ScanStatus? {
        status.flatMap { ScanStatus(rawValue: $0.lowercased()) }
    }
}

/// The error envelope shared by every endpoint.
struct APIErrorEnvelope: Codable, Equatable {
    var error: APIErrorBody?
}

struct APIErrorBody: Codable, Equatable {
    var code: String?
    var message: String?
    var details: APIErrorDetails?
    var scanId: String?
    var requestId: String?

    enum CodingKeys: String, CodingKey {
        case code
        case message
        case details
        case scanId = "scan_id"
        case requestId = "request_id"
    }
}

struct APIErrorDetails: Codable, Equatable {
    var reasons: [String]?
    var hints: [String]?
}
