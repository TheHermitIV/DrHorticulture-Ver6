import Foundation
import Testing

@testable import DrHorticulture

/// Decoding is checked against payloads copied from `docs/BACKEND_SPEC.md`,
/// never a live backend.
struct ScanDecodingTests {
    private func decodeScan(_ json: String) throws -> Scan {
        try JSONDecoder().decode(Scan.self, from: Data(json.utf8))
    }

    private func decodeError(_ json: String) throws -> APIErrorEnvelope {
        try JSONDecoder().decode(APIErrorEnvelope.self, from: Data(json.utf8))
    }

    @Test func decodesTheSpecsScanObject() throws {
        let scan = try decodeScan(Fixtures.completedScan)

        #expect(scan.scanId == "11111111-1111-4111-8111-111111111111")
        #expect(scan.species == "geranium")
        #expect(scan.scanStatus == .completed)
        #expect(scan.image?.url == "https://example.invalid/signed.jpg")
        #expect(scan.image?.quality?.passed == true)
        #expect(scan.result?.recommendation == "fertilize")
        #expect(scan.result?.ndvi == 0.41)
        #expect(scan.result?.confidence == 0.82)
        #expect(scan.result?.abstainReason == nil)
        #expect(scan.result?.modelVersion == "stub-0.1")
        #expect(scan.result?.configVersion == 1)
        #expect(scan.createdAt == "2026-10-01T15:04:05Z")
    }

    /// `result` is null while the status is processing, rejected or failed.
    @Test(arguments: ["processing", "rejected", "failed"])
    func decodesAScanWithNoResult(status: String) throws {
        let scan = try decodeScan("""
        {"scan_id":"a","species":"basil","status":"\(status)","result":null}
        """)

        #expect(scan.result == nil)
        #expect(scan.scanStatus?.rawValue == status)
    }

    @Test func decodesAnAbstainedScan() throws {
        let scan = try decodeScan(Fixtures.abstainedScan)

        #expect(scan.scanStatus == .abstained)
        #expect(scan.result?.recommendation == "abstain")
        #expect(scan.result?.abstainReason == "low_confidence")
    }

    @Test func decodesEveryScanStatusInTheSchema() throws {
        for status in ["uploaded", "rejected", "processing", "completed", "abstained", "failed"] {
            let scan = try decodeScan(#"{"status":"\#(status)"}"#)
            #expect(scan.scanStatus != nil, "\(status) should map")
        }
    }

    @Test func unknownStatusDecodesButMapsToNothing() throws {
        let scan = try decodeScan(#"{"status":"brand_new"}"#)

        #expect(scan.status == "brand_new")
        #expect(scan.scanStatus == nil)
    }

    @Test func decodesEmptyObject() throws {
        let scan = try decodeScan("{}")

        #expect(scan.scanId == nil)
        #expect(scan.result == nil)
        #expect(scan.scanStatus == nil)
    }

    @Test func ignoresUnknownKeys() throws {
        let scan = try decodeScan(#"{"scan_id":"a","brand_new_field":{"x":1}}"#)

        #expect(scan.scanId == "a")
    }

    @Test func toleratesAnEmptyQualityMetricsObject() throws {
        let scan = try decodeScan(#"{"image":{"id":"i","quality":{"passed":true,"metrics":{}}}}"#)

        #expect(scan.image?.quality?.metrics?.isEmpty == true)
    }

    @Test func rejectsMalformedFieldTypes() {
        #expect(throws: DecodingError.self) {
            _ = try decodeScan(#"{"result":{"ndvi":"not-a-number"}}"#)
        }
    }

    @Test func rejectsNonObjectPayload() {
        #expect(throws: DecodingError.self) {
            _ = try decodeScan("[]")
        }
    }

    // MARK: - Error envelope

    @Test func decodesTheSpecsErrorEnvelope() throws {
        let envelope = try decodeError(Fixtures.rejectionError)

        #expect(envelope.error?.code == "IMAGE_REJECTED")
        #expect(envelope.error?.message == "Photo is too dark.")
        #expect(envelope.error?.details?.reasons == ["too_dark"])
        #expect(envelope.error?.details?.hints == ["Move to bright, indirect light."])
        #expect(envelope.error?.scanId == "22222222-2222-4222-8222-222222222222")
        #expect(envelope.error?.requestId == "33333333-3333-4333-8333-333333333333")
    }

    @Test func decodesAnErrorWithoutDetails() throws {
        let envelope = try decodeError(
            #"{"error":{"code":"INFERENCE_UNAVAILABLE","message":"Timed out."}}"#
        )

        #expect(envelope.error?.code == "INFERENCE_UNAVAILABLE")
        #expect(envelope.error?.details == nil)
    }

    enum Fixtures {
        /// Verbatim from the API specification section of the backend spec.
        static let completedScan = """
        {
          "scan_id": "11111111-1111-4111-8111-111111111111",
          "species": "geranium",
          "status": "completed",
          "image": {
            "id": "44444444-4444-4444-8444-444444444444",
            "url": "https://example.invalid/signed.jpg",
            "quality": { "passed": true, "metrics": {} }
          },
          "result": {
            "recommendation": "fertilize",
            "ndvi": 0.41,
            "confidence": 0.82,
            "abstain_reason": null,
            "model_version": "stub-0.1",
            "config_version": 1
          },
          "created_at": "2026-10-01T15:04:05Z"
        }
        """

        static let abstainedScan = """
        {
          "scan_id": "11111111-1111-4111-8111-111111111111",
          "species": "basil",
          "status": "abstained",
          "result": {
            "recommendation": "abstain",
            "ndvi": 0.33,
            "confidence": 0.21,
            "abstain_reason": "low_confidence",
            "model_version": "stub-0.1",
            "config_version": 1
          }
        }
        """

        static let rejectionError = """
        {
          "error": {
            "code": "IMAGE_REJECTED",
            "message": "Photo is too dark.",
            "details": {
              "reasons": ["too_dark"],
              "hints": ["Move to bright, indirect light."]
            },
            "scan_id": "22222222-2222-4222-8222-222222222222",
            "request_id": "33333333-3333-4333-8333-333333333333"
          }
        }
        """
    }
}
