import SwiftUI

/// Every scan saved on the phone, newest first. Swipe to delete.
struct ScanHistoryView: View {
    @Environment(ScanHistory.self) private var history

    var body: some View {
        List {
            ForEach(history.records) { record in
                NavigationLink {
                    ScanRecordDetailView(record: record)
                } label: {
                    ScanRow(record: record)
                }
            }
            .onDelete { offsets in
                let ids = offsets.map { history.records[$0].id }
                ids.forEach(history.delete(id:))
            }
        }
        .overlay {
            if history.records.isEmpty {
                ContentUnavailableView("No scans yet", systemImage: "leaf")
            }
        }
        .navigationTitle("Scan history")
        .accessibilityIdentifier("history.list")
    }
}

/// One saved scan: thumbnail, outcome, NDVI and when it was taken.
struct ScanRow: View {
    @Environment(ScanHistory.self) private var history
    let record: ScanRecord

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 2) {
                Text(record.title)
                    .font(.subheadline.weight(.semibold))
                Text("NDVI \(record.ndvi.formatted(.number.precision(.fractionLength(3))))")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(record.date, format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("history.row")
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let image = history.thumbnail(for: record.id) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            Color.brand.opacity(0.2)
                .overlay {
                    Image(systemName: "leaf.fill").foregroundStyle(Color.brand)
                }
        }
    }
}

/// A saved scan shown with the same cards as the Results screen.
struct ScanRecordDetailView: View {
    @Environment(ScanHistory.self) private var history
    let record: ScanRecord

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let image = history.thumbnail(for: record.id) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }

                if let recommendation = record.recommendation {
                    RecommendationCard(recommendation: recommendation)
                } else {
                    Text(record.title)
                        .font(.title2.bold())
                }

                ReadingCard(ndvi: record.ndvi, confidence: record.confidence)

                if let note = record.note {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Text(record.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .navigationTitle("Scan")
        .navigationBarTitleDisplayMode(.inline)
    }
}
