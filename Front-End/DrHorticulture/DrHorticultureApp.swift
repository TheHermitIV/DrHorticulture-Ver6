import SwiftUI

@main
struct DrHorticultureApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.analysisService, APIAnalysisService())
        }
    }
}

struct RootView: View {
    @State private var router = AppRouter()
    @State private var session = ScanSession()

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
