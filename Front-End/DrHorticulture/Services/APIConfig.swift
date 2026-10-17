import Foundation

/// Where the app finds the backend, and whether it talks to it at all.
enum APIConfig {
    static let productionURL = URL(string: "https://drhorticulture-ver6-production.up.railway.app")!

    // TODO(decision): move to build configuration
    /// Debug builds can point at a backend on your Mac by adding the launch argument
    /// `-APIBaseURL http://<your-mac-ip>:3000` in the Xcode scheme.
    static var baseURL: URL {
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "APIBaseURL"),
            let url = URL(string: override)
        {
            return url
        }
        #endif
        return productionURL
    }

    /// Debug builds launched with `-useMockServices YES` (the UI tests do) skip the
    /// backend entirely: mock login and mock analysis.
    static var usesMockServices: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "useMockServices")
        #else
        return false
        #endif
    }
}
