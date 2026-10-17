import SwiftUI

/// The user's light/dark choice, saved on the device. `system` follows the
/// phone's own setting.
enum AppTheme: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let storageKey = "appTheme"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    /// `nil` lets the phone decide.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

// TODO(decision): placeholder palette until the team settles the design.
extension Color {
    static let brand = Color.green
}

extension View {
    /// A soft green wash behind a screen's content.
    func brandBackground() -> some View {
        background(
            LinearGradient(
                colors: [Color.brand.opacity(0.18), Color.brand.opacity(0.02)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }
}
