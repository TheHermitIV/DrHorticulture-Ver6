import SwiftUI

/// Placeholder tab. Real settings arrive with the backend integration.
struct SettingsView: View {
    var body: some View {
        List {
            Section("Analysis") {
                LabeledContent("Source", value: "Mock service")
                    .accessibilityIdentifier("settings.source")
                LabeledContent(
                    "Abstention threshold",
                    value: AbstentionThreshold.minimumConfidence
                        .formatted(.percent.precision(.fractionLength(0)))
                )
                .accessibilityIdentifier("settings.threshold")
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
