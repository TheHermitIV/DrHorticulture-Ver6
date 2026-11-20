import Foundation
import Testing
import UIKit

@testable import DrHorticulture

@MainActor
struct ScanHistoryTests {
    private func tempDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("ScanHistoryTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func photo() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 800, height: 600)).image { context in
            UIColor.green.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 600))
        }
    }

    private let fertilize = ResultsState.recommendation(.fertilize, ndvi: 0.42, confidence: 0.9)

    @Test func startsEmptyWithNoFiles() {
        let history = ScanHistory(directory: tempDirectory())
        #expect(history.records.isEmpty)
    }

    @Test func demoResultsKeepTheirLabelAfterDecoding() throws {
        let record = try #require(ScanRecord(state: .demoRecommendation(.doNotFertilize, ndvi: 0.8, cutoffDistance: 0.3)))
        let decoded = try JSONDecoder().decode(ScanRecord.self, from: JSONEncoder().encode(record))
        #expect(decoded.isDemo == true)
        #expect(decoded.title == "Demo · Don't fertilize")
        #expect(decoded.confidence == nil)
    }

    @Test func recordsWithoutTheDemoFlagStillDecode() throws {
        let record = try #require(ScanRecord(state: fertilize))
        let data = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(ScanRecord.self, from: data)
        #expect(decoded.isDemo == nil)
        #expect(decoded.title == "Fertilize")
    }

    @Test func savedScansSurviveARelaunch() throws {
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let id = UUID()

        ScanHistory(directory: directory).save(fertilize, photo: photo(), id: id)
        let reopened = ScanHistory(directory: directory)

        let record = try #require(reopened.records.first)
        #expect(reopened.records.count == 1)
        #expect(record.id == id)
        #expect(record.outcome == .fertilize)
        #expect(record.ndvi == 0.42)
        #expect(record.confidence == 0.9)
        let thumbnail = try #require(reopened.thumbnail(for: id))
        #expect(max(thumbnail.size.width, thumbnail.size.height) <= ScanHistory.thumbnailSide)
    }

    @Test func newestScanComesFirst() {
        let history = ScanHistory.inMemory()
        let first = UUID()
        let second = UUID()

        history.save(fertilize, photo: nil, id: first)
        history.save(.reading(ndvi: 0.3, confidence: 0.5), photo: nil, id: second)

        #expect(history.records.map(\.id) == [second, first])
    }

    @Test func savingTheSameIDReplacesTheEntry() {
        let history = ScanHistory.inMemory()
        let id = UUID()

        history.save(fertilize, photo: nil, id: id)
        history.save(.recommendation(.doNotFertilize, ndvi: 0.7, confidence: 0.8), photo: nil, id: id)

        #expect(history.records.count == 1)
        #expect(history.records.first?.outcome == .doNotFertilize)
    }

    @Test func abstentionsAreNotSavedAndRemoveAnEarlierEntry() {
        let history = ScanHistory.inMemory()
        let id = UUID()

        history.save(.abstention(reason: "blurry"), photo: nil, id: UUID())
        #expect(history.records.isEmpty)

        history.save(fertilize, photo: nil, id: id)
        history.save(.abstention(reason: "blurry"), photo: nil, id: id)
        #expect(history.records.isEmpty)
    }

    @Test func estimateWithoutRecommendationKeepsTheReason() {
        let history = ScanHistory.inMemory()
        history.save(.estimateWithoutRecommendation(ndvi: 0.2, reason: "Low confidence"), photo: nil, id: UUID())

        let record = history.records.first
        #expect(record?.outcome == .noRecommendation)
        #expect(record?.recommendation == nil)
        #expect(record?.note == "Low confidence")
    }

    @Test func deleteRemovesTheRecordAndItsThumbnail() {
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let history = ScanHistory(directory: directory)
        let id = UUID()

        history.save(fertilize, photo: photo(), id: id)
        history.delete(id: id)

        #expect(history.records.isEmpty)
        #expect(history.thumbnail(for: id) == nil)
        #expect(ScanHistory(directory: directory).records.isEmpty)
    }

    @Test func keepsOnlyTheNewestRecords() {
        let history = ScanHistory.inMemory()
        for _ in 0..<(ScanHistory.maxRecords + 5) {
            history.save(fertilize, photo: nil, id: UUID())
        }
        #expect(history.records.count == ScanHistory.maxRecords)
    }
}
