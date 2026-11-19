import SwiftUI
import UIKit

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

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }

    /// Applies the theme to every open window. SwiftUI's `preferredColorScheme`
    /// does not reliably switch back once set (going back to `nil` keeps the old
    /// scheme until relaunch), so the window's UIKit override is set directly.
    @MainActor
    func apply() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = interfaceStyle
            }
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
