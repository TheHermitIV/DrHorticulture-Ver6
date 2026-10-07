import Testing

@testable import DrHorticulture

@MainActor
struct AppRouterTests {
    @Test func startsOnHomeWithNoScanInProgress() {
        let router = AppRouter()

        #expect(router.selectedTab == .home)
        #expect(router.path.isEmpty)
    }

    /// The Scan tab has to sit between the two side tabs.
    @Test func scanIsTheMiddleTab() {
        #expect(AppTab.allCases == [.home, .scan, .settings])
        #expect(AppTab.allCases[AppTab.allCases.count / 2] == .scan)
    }

    @Test func everyTabHasATitleAndAnIcon() {
        for tab in AppTab.allCases {
            #expect(!tab.title.isEmpty)
            #expect(!tab.systemImage.isEmpty)
        }
    }

    @Test func startScanSwitchesToTheScanTab() {
        let router = AppRouter()

        router.startScan()

        #expect(router.selectedTab == .scan)
        #expect(router.path.isEmpty)
    }

    /// Re-entering Scan must not drop the user into a half-finished capture.
    @Test func startScanClearsAnInProgressFlow() {
        let router = AppRouter()
        router.showResults()

        router.startScan()

        #expect(router.path.isEmpty)
    }

    @Test func walksCaptureToPreviewToResults() {
        let router = AppRouter()
        router.startScan()

        router.showPreview()
        #expect(router.path == [.preview])

        router.showResults()
        #expect(router.path == [.preview, .results])
    }

    @Test func goBackFromPreviewReturnsToCapture() {
        let router = AppRouter()
        router.showPreview()

        router.goBack()

        #expect(router.path.isEmpty)
    }

    @Test func goBackFromResultsReturnsToPreview() {
        let router = AppRouter()
        router.showResults()

        router.goBack()

        #expect(router.path == [.preview])
    }

    @Test func goBackAtTheRootIsHarmless() {
        let router = AppRouter()

        router.goBack()

        #expect(router.path.isEmpty)
    }

    @Test func resetScanFlowReturnsToCaptureWithoutChangingTab() {
        let router = AppRouter()
        router.startScan()
        router.showResults()

        router.resetScanFlow()

        #expect(router.path.isEmpty)
        #expect(router.selectedTab == .scan)
    }

    @Test func tabsAreSelectableDirectly() {
        let router = AppRouter()

        router.selectedTab = .settings

        #expect(router.selectedTab == .settings)
    }
}
