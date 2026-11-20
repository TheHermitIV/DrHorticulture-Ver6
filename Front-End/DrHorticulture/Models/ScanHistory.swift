import Foundation
import Observation
import UIKit

/// One finished scan, kept on the phone so Home can show recent results
/// without a backend round trip.
struct ScanRecord: Codable, Identifiable, Equatable {
    enum Outcome: String, Codable {
        case fertilize
        case doNotFertilize
        /// A reading the backend did not turn into a call.
        case reading
        /// An estimate with fertilizer advice deliberately withheld.
        case noRecommendation
    }

    var id: UUID
    var date: Date
    var outcome: Outcome
    var ndvi: Double
    var confidence: Double?
    var note: String?
    var isDemo: Bool?

    /// Only results with a usable reading are kept.
    /// TODO(decision): abstained and failed attempts are not saved, since they
    /// carry no reading; revisit if the team wants them in the history.
    init?(id: UUID = UUID(), date: Date = .now, state: ResultsState) {
        self.id = id
        self.date = date
        switch state {
        case .recommendation(let recommendation, let ndvi, let confidence):
            outcome = recommendation == .fertilize ? .fertilize : .doNotFertilize
            self.ndvi = ndvi
            self.confidence = confidence
        case .demoRecommendation(let recommendation, let ndvi, let cutoffDistance):
            outcome = recommendation == .fertilize ? .fertilize : .doNotFertilize
            self.ndvi = ndvi
            isDemo = true
            note = "Experimental demo recommendation. Distance from NDVI cutoff: \(cutoffDistance.formatted(.number.precision(.fractionLength(3))))"
        case .reading(let ndvi, let confidence):
            outcome = .reading
            self.ndvi = ndvi
            self.confidence = confidence
        case .estimateWithoutRecommendation(let ndvi, let reason):
            outcome = .noRecommendation
            self.ndvi = ndvi
            note = reason
        case .abstention:
            return nil
        }
    }

    var title: String {
        switch outcome {
        case .fertilize: return isDemo == true ? "Demo · Fertilize" : "Fertilize"
        case .doNotFertilize: return isDemo == true ? "Demo · Don't fertilize" : "Don't fertilize"
        case .reading: return "Reading only"
        case .noRecommendation: return "No recommendation"
        }
    }

    var recommendation: Recommendation? {
        switch outcome {
        case .fertilize: return .fertilize
        case .doNotFertilize: return .doNotFertilize
        case .reading, .noRecommendation: return nil
        }
    }
}

/// Scan history stored on the device: an index file plus one small JPEG
/// thumbnail per scan, in Application Support. Nothing leaves the phone.
@MainActor
@Observable
final class ScanHistory {
    /// TODO(decision): cap picked to keep storage small; not a product rule.
    static let maxRecords = 50
    static let thumbnailSide: CGFloat = 240

    private(set) var records: [ScanRecord] = []

    /// `nil` keeps everything in memory (UI tests and previews).
    private let directory: URL?

    init(directory: URL?) {
        self.directory = directory
        load()
    }

    /// The store the app uses: `Application Support/ScanHistory`.
    static func onDevice() -> ScanHistory {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return ScanHistory(directory: base?.appendingPathComponent("ScanHistory", isDirectory: true))
    }

    static func inMemory(_ records: [ScanRecord] = []) -> ScanHistory {
        let history = ScanHistory(directory: nil)
        history.records = records
        return history
    }

    /// Saves or replaces the record with `id`. A state without a reading
    /// removes any earlier record with that id instead.
    func save(_ state: ResultsState, photo: UIImage?, id: UUID, date: Date = .now) {
        guard let record = ScanRecord(id: id, date: date, state: state) else {
            delete(id: id)
            return
        }
        let isNew = !records.contains { $0.id == id }
        records.removeAll { $0.id == id }
        records.insert(record, at: 0)
        if isNew, let photo { writeThumbnail(photo, id: id) }

        while records.count > Self.maxRecords {
            let dropped = records.removeLast()
            removeThumbnail(id: dropped.id)
        }
        persist()
    }

    func delete(id: UUID) {
        guard records.contains(where: { $0.id == id }) else { return }
        records.removeAll { $0.id == id }
        removeThumbnail(id: id)
        persist()
    }

    func thumbnail(for id: UUID) -> UIImage? {
        guard let url = thumbnailURL(id) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    // MARK: - Files

    private var indexURL: URL? { directory?.appendingPathComponent("index.json") }

    private func thumbnailURL(_ id: UUID) -> URL? {
        directory?.appendingPathComponent("\(id.uuidString).jpg")
    }

    private func load() {
        guard let indexURL, let data = try? Data(contentsOf: indexURL) else { return }
        records = (try? Self.decoder.decode([ScanRecord].self, from: data)) ?? []
    }

    private func persist() {
        guard let directory, let indexURL else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Self.encoder.encode(records).write(to: indexURL, options: .atomic)
        } catch {
            // History is a convenience; a failed write must never break a scan.
        }
    }

    private func writeThumbnail(_ image: UIImage, id: UUID) {
        guard let directory, let url = thumbnailURL(id) else { return }
        let scale = min(1, Self.thumbnailSide / max(image.size.width, image.size.height, 1))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = small.jpegData(compressionQuality: 0.8) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    private func removeThumbnail(id: UUID) {
        guard let url = thumbnailURL(id) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
