import Foundation
import UIKit

/// A photo the user picked or shot, held between Capture, Preview and Results.
struct CapturedPhoto: Equatable {
    enum Source: String, Equatable {
        case camera
        case photoLibrary
        case sample
    }

    var image: UIImage
    var data: Data
    var source: Source

    init?(image: UIImage, source: Source) {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
        self.image = image
        self.data = data
        self.source = source
    }
}

/// The scan in progress. One instance lives for the life of the Scan tab.
@MainActor
@Observable
final class ScanSession {
    var photo: CapturedPhoto?

    var hasPhoto: Bool { photo != nil }

    func accept(_ photo: CapturedPhoto?) {
        self.photo = photo
    }

    func clear() {
        photo = nil
    }
}

extension CapturedPhoto {
    /// Stands in for a real photo so the flow is usable in the simulator, where
    /// there is no camera.
    static func sample() -> CapturedPhoto? {
        let size = CGSize(width: 600, height: 800)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(red: 0.85, green: 0.92, blue: 0.82, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))

            UIColor(red: 0.22, green: 0.55, blue: 0.24, alpha: 1).setFill()
            let leaf = UIBezierPath(ovalIn: CGRect(x: 120, y: 180, width: 360, height: 300))
            leaf.fill()

            UIColor(red: 0.55, green: 0.36, blue: 0.24, alpha: 1).setFill()
            context.fill(CGRect(x: 200, y: 520, width: 200, height: 180))
        }
        return CapturedPhoto(image: image, source: .sample)
    }
}
