import SwiftUI

struct PreviewView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ScanSession.self) private var session

    var body: some View {
        VStack(spacing: 24) {
            if let photo = session.photo {
                Image(uiImage: photo.image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 400)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityIdentifier("preview.image")
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.quaternary)
                    .frame(maxHeight: 400)
                    .overlay {
                        Text("No photo")
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("preview.image")
            }

            Text("Use this photo?")
                .font(.headline)
                .accessibilityIdentifier("preview.title")

            Text("Check that one plant is centered and its leaves are sharp and evenly lit.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            ForEach(session.photo?.qualityHints ?? [], id: \.self) { hint in
                Label(hint, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 16) {
                Button("Retake") {
                    session.clear()
                    router.goBack()
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("preview.retakeButton")

                Button("Analyze photo") {
                    router.showResults()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!session.hasPhoto)
                .accessibilityIdentifier("preview.acceptButton")
            }
            .controlSize(.large)
        }
        .padding(24)
        .navigationTitle("Preview")
        .navigationBarTitleDisplayMode(.inline)
    }
}
