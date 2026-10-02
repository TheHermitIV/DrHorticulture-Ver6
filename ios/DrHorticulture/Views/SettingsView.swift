import SwiftUI

/// Placeholder tab. Real settings arrive with the backend integration.
struct SettingsView: View {
    var body: some View {
        List {
            Section("Analysis") {
                LabeledContent("Source", value: "Mock service")
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
    }
}
