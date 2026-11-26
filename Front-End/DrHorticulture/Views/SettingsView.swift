import SwiftUI

/// Placeholder tab. Real settings arrive with the backend integration.
struct SettingsView: View {
    @Environment(AuthSession.self) private var auth
    @Environment(\.analysisService) private var analysisService
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .system

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Signed in as", value: auth.username ?? "—")
                    .accessibilityIdentifier("settings.username")
                Button("Sign out", role: .destructive) {
                    auth.signOut()
                }
                .accessibilityIdentifier("settings.signOutButton")
            }

            Section("Appearance") {
                Picker("Theme", selection: $theme) {
                    ForEach(AppTheme.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("settings.themePicker")
            }

            Section("Analysis") {
                LabeledContent(
                    "Source",
                    value: analysisService is MockAnalysisService ? "Mock service" : "Backend"
                )
                    .accessibilityIdentifier("settings.source")
                LabeledContent("Contract", value: "inference v1")
                    .accessibilityIdentifier("settings.contract")
            }

            Section {
                Text("Fertilizer thresholds live in the backend's decision_config and are versioned there, not in the app.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("settings.thresholdNote")
            }

            Section("About") {
                LabeledContent("Version", value: "1.0")
                LabeledContent("Course", value: "FIU CIS 4951")
            }
        }
        .navigationTitle("Settings")
        .accessibilityIdentifier("settings.list")
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environment(AuthSession())
    }
}
