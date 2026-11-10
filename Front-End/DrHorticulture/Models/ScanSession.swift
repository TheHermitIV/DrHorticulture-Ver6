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
    var qualityHints: [String]

    init?(image: UIImage, source: Source) {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
        self.image = image
        self.data = data
        self.source = source
        self.qualityHints = source == .sample ? [] : Self.qualityHints(for: image)
    }

    /// Advisory defaults. The server applies the active quality rules to the upload.
    private static func qualityHints(for image: UIImage) -> [String] {
        guard let cgImage = image.cgImage else { return [] }
        var hints: [String] = []
        if min(cgImage.width, cgImage.height) < 1024 {
            hints.append("This photo is small. Try the original full-resolution photo.")
        }

        let side = 64
        var pixels = [UInt8](repeating: 0, count: side * side)
        let sampled = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8,
                bytesPerRow: side, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.interpolationQuality = .medium
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: CGFloat(side), height: CGFloat(side)))
            return true
        }
        if sampled {
            let mean = Double(pixels.reduce(0) { $0 + Int($1) }) / Double(pixels.count)
            if mean < 60 {
                hints.append("This photo looks dark. Try brighter, even lighting.")
            } else if mean > 200 {
                hints.append("This photo looks very bright. Try softer light and avoid glare.")
            }
        }
        return hints
    }
}

/// Demo scans leave the optional species hint blank.
enum PlantSpecies {
    static let fallback = ""
}

/// The scan in progress. One instance lives for the life of the Scan tab.
@MainActor
@Observable
final class ScanSession {
    var photo: CapturedPhoto?
    var species: String = PlantSpecies.fallback

    var hasPhoto: Bool { photo != nil }

    func accept(_ photo: CapturedPhoto?) {
        self.photo = photo
    }

    func clear() {
        photo = nil
    }

    /// Species survives a retake: the plant hasn't changed, only the photo.
    func reset() {
        photo = nil
        species = PlantSpecies.fallback
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
