import SwiftUI

@main
struct DrHorticultureApp: App {
    @State private var auth = AuthSession()
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .system

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isSignedIn {
                    RootView()
                } else {
                    LoginView()
                }
            }
            .environment(auth)
            .preferredColorScheme(theme.colorScheme)
            .tint(.brand)
            .environment(
                \.analysisService,
                APIConfig.usesMockServices
                    ? MockAnalysisService() as any AnalysisService : APIAnalysisService()
            )
            .environment(
                \.authService,
                APIConfig.usesMockServices
                    ? MockAuthService() as any AuthService : APIAuthService()
            )
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
