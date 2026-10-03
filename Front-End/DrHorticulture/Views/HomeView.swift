import SwiftUI

/// The landing tab. Scan history is a later sprint, so the list is an empty
/// state for now.
struct HomeView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.green)
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
                Text("Recent scans")
                    .font(.headline)

                RoundedRectangle(cornerRadius: 16)
                    .fill(.quaternary)
                    .frame(height: 140)
                    .overlay {
                        Text("No scans yet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("home.emptyHistory")
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
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environment(AppRouter())
    }
}
