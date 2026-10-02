import PhotosUI
import SwiftUI

/// Root of the Scan tab: shoot a photo, pick a saved one, or use the built-in
/// sample.
struct CaptureView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ScanSession.self) private var session

    @State private var isShowingCamera = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var loadFailed = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            RoundedRectangle(cornerRadius: 20)
                .fill(.quaternary)
                .overlay {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.viewfinder")
                            .font(.system(size: 52))
                            .foregroundStyle(.secondary)
                        Text("Photograph a whole potted plant")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                }
                .frame(maxHeight: 320)
                // Without this the placeholder is invisible to VoiceOver: a
                // plain shape isn't an accessibility element on its own.
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("capture.viewfinder")

            if loadFailed {
                Text("That photo couldn't be loaded. Try another one.")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("capture.loadError")
            }

            Spacer()

            VStack(spacing: 12) {
                if CameraPicker.isAvailable {
                    Button {
                        isShowingCamera = true
                    } label: {
                        Label("Take photo", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("capture.cameraButton")

                    libraryPicker
                        .buttonStyle(.bordered)
                } else {
                    // No camera in the simulator, so the library is the primary
                    // action there.
                    libraryPicker
                        .buttonStyle(.borderedProminent)
                }

                Button("Use sample photo") {
                    loadFailed = false
                    session.accept(CapturedPhoto.sample())
                    router.showPreview()
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("capture.sampleButton")
            }
            .controlSize(.large)
        }
        .padding(24)
        .navigationTitle("Scan")
        .fullScreenCover(isPresented: $isShowingCamera) {
            CameraPicker(
                onCapture: { image in
                    isShowingCamera = false
                    accept(image, from: .camera)
                },
                onCancel: { isShowingCamera = false }
            )
            .ignoresSafeArea()
        }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
    }

    private var libraryPicker: some View {
        PhotosPicker(selection: $libraryItem, matching: .images, photoLibrary: .shared()) {
            Label("Choose saved photo", systemImage: "photo.on.rectangle")
                .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("capture.libraryButton")
    }

    private func accept(_ image: UIImage, from source: CapturedPhoto.Source) {
        guard let photo = CapturedPhoto(image: image, source: source) else {
            loadFailed = true
            return
        }
        loadFailed = false
        session.accept(photo)
        router.showPreview()
    }

    private func load(_ item: PhotosPickerItem) async {
        defer { libraryItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data)
        else {
            loadFailed = true
            return
        }
        accept(image, from: .photoLibrary)
    }
}
