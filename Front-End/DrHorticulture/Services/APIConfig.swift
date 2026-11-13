import Foundation

/// Where the app finds the backend, and whether it talks to it at all.
enum APIConfig {
    static let productionURL = URL(string: "https://drhorticulture-ver6-production.up.railway.app")!

    /// The backend both services talk to; `nil` when the configured address is invalid.
    ///
    /// Comes from the `DRHORTICULTURE_API_BASE_URL` build setting (through the
    /// `APIBaseURL` Info.plist key), or production when it is empty. Debug builds
    /// can also point at a backend on your Mac with the launch argument
    /// `-APIBaseURL http://<your-mac-ip>:3000` in the Xcode scheme.
    static var baseURL: URL? {
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "APIBaseURL"),
            let url = URL(string: override)
        {
            return url
        }
        #endif
        return configuredBaseURL(Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String)
    }

    /// An empty value means production; anything else must be a plain `https` URL.
    static func configuredBaseURL(_ value: String?) -> URL? {
        let value = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty else { return productionURL }
        guard let url = URL(string: value), url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil
        else { return nil }
        return url
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
