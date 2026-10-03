import SwiftUI

private struct AnalysisServiceKey: EnvironmentKey {
    static let defaultValue: any AnalysisService = MockAnalysisService()
}

extension EnvironmentValues {
    /// Swapping the mock for the real API is a one-line change at the app entry
    /// point; nothing downstream knows the difference.
    var analysisService: any AnalysisService {
        get { self[AnalysisServiceKey.self] }
        set { self[AnalysisServiceKey.self] = newValue }
    }
}
