import SwiftUI

struct ResultsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ScanSession.self) private var session
    @Environment(\.analysisService) private var analysisService

    @State private var viewModel: ResultsViewModel?
    /// Dev-only control so all three Results states can be seen without a
    /// backend. It goes away once real capture and upload land.
    @State private var scenario: MockAnalysisService.Scenario = .abstain

    var body: some View {
        VStack(spacing: 24) {
            Text("Results")
                .font(.title2.bold())
                .accessibilityIdentifier("results.title")

            content

            Spacer()

            scenarioPicker
        }
        .padding(24)
        .navigationTitle("Results")
        .task(id: scenario) {
            let model = viewModel ?? ResultsViewModel(service: analysisService)
            model.service = MockAnalysisService(scenario: scenario)
            viewModel = model
            await model.load(imageData: session.photo?.data)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel?.phase ?? .loading {
        case .loaded(let state):
            switch state {
            case .recommendation(let recommendation, let ndvi, let confidence):
                RecommendationCard(recommendation: recommendation)
                ReadingCard(ndvi: ndvi, confidence: confidence)
            case .reading(let ndvi, let confidence):
                ReadingCard(ndvi: ndvi, confidence: confidence)
            case .abstention(let reason):
                AbstentionCard(reason: reason, onRetake: retake)
            }

        case .failed(let message):
            AbstentionCard(reason: message, onRetake: retake)

        case .loading:
            ProgressView()
                .accessibilityIdentifier("results.loading")
        }
    }

    /// Sends the user back to the start of the Scan tab with a clean slate.
    private func retake() {
        session.clear()
        router.resetScanFlow()
    }

    private var scenarioPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mock response")
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker("Mock response", selection: $scenario) {
                ForEach(MockAnalysisService.Scenario.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("results.scenarioPicker")
        }
    }
}

// MARK: - State cards

struct RecommendationCard: View {
    let recommendation: Recommendation

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: recommendation == .fertilize ? "drop.fill" : "checkmark.seal.fill")
                .font(.system(size: 44))
                .foregroundStyle(recommendation == .fertilize ? .orange : .green)
                .accessibilityHidden(true)

            Text(recommendation == .fertilize ? "Fertilize" : "Don't fertilize")
                .font(.title.bold())
                .accessibilityIdentifier("results.recommendation")
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct ReadingCard: View {
    let ndvi: Double
    let confidence: Double

    var body: some View {
        VStack(spacing: 12) {
            LabeledContent("NDVI") {
                Text(ndvi.formatted(.number.precision(.fractionLength(3))))
                    .monospacedDigit()
            }
            .accessibilityIdentifier("results.ndvi")

            LabeledContent("Confidence") {
                Text(confidence.formatted(.percent.precision(.fractionLength(0))))
                    .monospacedDigit()
            }
            .accessibilityIdentifier("results.confidence")
        }
        .padding(24)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct AbstentionCard: View {
    let reason: String
    let onRetake: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)

            Text("Couldn't get a reliable reading, try again.")
                .font(.headline)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("results.abstention")

            Text(reason)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("results.abstentionReason")

            Button("Retake photo", action: onRetake)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("results.retakeButton")
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    NavigationStack {
        ResultsView()
            .environment(AppRouter())
            .environment(ScanSession())
    }
}
