import SwiftUI

@main
struct DrHorticultureApp: App {
    /// UI tests launch with `-uiTesting`: they get the mock service, so they
    /// never upload to the production API and can drive every Results state
    /// through the mock-response picker.
    static let isUITesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")

    private static var analysisService: any AnalysisService {
        isUITesting ? MockAnalysisService() : APIAnalysisService()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.analysisService, Self.analysisService)
                .tint(.brand)
        }
    }
}

struct RootView: View {
    // Observed here rather than on the App: an App-level @AppStorage only
    // reacts to the first change, so later theme picks never reached the UI.
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .system
    @State private var router = AppRouter()
    @State private var session = ScanSession()
    // UI tests start from an empty, in-memory history so runs don't leak state.
    @State private var history = DrHorticultureApp.isUITesting
        ? ScanHistory.inMemory()
        : ScanHistory.onDevice()

    var body: some View {
        @Bindable var router = router

        TabView(selection: $router.selectedTab) {
            Tab(AppTab.home.title, systemImage: AppTab.home.systemImage, value: AppTab.home) {
                NavigationStack {
                    HomeView()
                }
            }

            Tab(AppTab.scan.title, systemImage: AppTab.scan.systemImage, value: AppTab.scan) {
                NavigationStack(path: $router.path) {
                    CaptureView()
                        .navigationDestination(for: Screen.self) { screen in
                            switch screen {
                            case .preview: PreviewView()
                            case .results: ResultsView()
                            }
                        }
                }
            }

            Tab(
                AppTab.settings.title,
                systemImage: AppTab.settings.systemImage,
                value: AppTab.settings
            ) {
                NavigationStack {
                    SettingsView()
                }
            }
        }
        .environment(self.router)
        .environment(session)
        .environment(history)
        .onAppear { theme.apply() }
        .onChange(of: theme) { _, newTheme in newTheme.apply() }
        .onChange(of: router.selectedTab) { previous, current in
            // Leaving Scan discards the in-progress capture, so returning to the
            // tab always starts clean.
            if previous == .scan && current != .scan {
                self.router.resetScanFlow()
                session.clear()
            }
        }
    }
}
