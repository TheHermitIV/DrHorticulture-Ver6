import Observation

/// The bottom tabs. `scan` sits in the middle, between the two side tabs.
enum AppTab: String, Hashable, CaseIterable, Identifiable {
    case home
    case scan
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .scan: return "Scan"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .scan: return "viewfinder.circle.fill"
        case .settings: return "gearshape.fill"
        }
    }
}

/// Steps inside the Scan tab. The capture screen is the tab's root, so it isn't
/// a case here.
enum Screen: Hashable {
    case preview
    case results
}

/// Owns the selected tab and the Scan tab's Capture -> Preview -> Results path,
/// so the views stay free of navigation plumbing and the flow can be tested
/// without a UI.
@MainActor
@Observable
final class AppRouter {
    var selectedTab: AppTab = .home
    var path: [Screen] = []

    /// Switching to Scan always starts a fresh capture rather than dropping the
    /// user back into a half-finished one.
    func startScan() {
        path.removeAll()
        selectedTab = .scan
    }

    func showPreview() {
        path = [.preview]
    }

    func showResults() {
        path = [.preview, .results]
    }

    func goBack() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    func resetScanFlow() {
        path.removeAll()
    }
}
