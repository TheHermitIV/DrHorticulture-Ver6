import SwiftUI

/// The landing tab, with the most recent scans saved on the phone.
struct HomeView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ScanHistory.self) private var history

    private static let recentCount = 3

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(Color.brand)
                    .accessibilityHidden(true)

                Text("Dr. Horticulture")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("home.title")

                Text("Photograph a potted plant to get an NDVI estimate and a fertilizer recommendation.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 24)

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Recent scans")
                        .font(.headline)
                    Spacer()
                    if !history.records.isEmpty {
                        NavigationLink("See all") {
                            ScanHistoryView()
                        }
                        .font(.subheadline)
                        .accessibilityIdentifier("home.seeAllButton")
                    }
                }

                if history.records.isEmpty {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.brand.opacity(0.12))
                        .frame(height: 140)
                        .overlay {
                            Text("No scans yet")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("home.emptyHistory")
                        }
                } else {
                    VStack(spacing: 0) {
                        ForEach(history.records.prefix(Self.recentCount)) { record in
                            NavigationLink {
                                ScanRecordDetailView(record: record)
                            } label: {
                                ScanRow(record: record)
                                    .padding(.vertical, 10)
                                    .padding(.horizontal, 12)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)

                            if record.id != history.records.prefix(Self.recentCount).last?.id {
                                Divider().padding(.leading, 72)
                            }
                        }
                    }
                    .background(
                        Color.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 16)
                    )
                    .accessibilityIdentifier("home.recentScans")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer()

            Button("Scan a plant") {
                router.startScan()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("home.startButton")
        }
        .padding(24)
        .brandBackground()
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environment(AppRouter())
            .environment(ScanHistory.inMemory())
    }
}
