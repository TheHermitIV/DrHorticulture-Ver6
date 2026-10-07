import Foundation
import Testing
import UIKit

@testable import DrHorticulture

@MainActor
struct ScanSessionTests {
    private func solidImage(
        size: CGSize = CGSize(width: 8, height: 8),
        color: UIColor = .green
    ) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { context in
            color.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    @Test func startsEmpty() {
        let session = ScanSession()

        #expect(session.photo == nil)
        #expect(session.hasPhoto == false)
    }

    @Test func acceptingAPhotoStoresIt() throws {
        let session = ScanSession()
        let photo = try #require(CapturedPhoto(image: solidImage(), source: .camera))

        session.accept(photo)

        #expect(session.hasPhoto)
        #expect(session.photo?.source == .camera)
    }

    @Test func clearingRemovesThePhoto() throws {
        let session = ScanSession()
        session.accept(try #require(CapturedPhoto(image: solidImage(), source: .photoLibrary)))

        session.clear()

        #expect(session.photo == nil)
        #expect(session.hasPhoto == false)
    }

    @Test func acceptingNilLeavesTheSessionEmpty() {
        let session = ScanSession()

        session.accept(nil)

        #expect(session.hasPhoto == false)
    }

    /// The data is what gets uploaded once the real API lands, so it must exist.
    @Test(arguments: [CapturedPhoto.Source.camera, .photoLibrary, .sample])
    func capturedPhotoCarriesEncodedData(source: CapturedPhoto.Source) throws {
        let photo = try #require(CapturedPhoto(image: solidImage(), source: source))

        #expect(!photo.data.isEmpty)
        #expect(photo.source == source)
        #expect(UIImage(data: photo.data) != nil)
    }

    @Test func sampleIsUsableWithoutACamera() throws {
        let photo = try #require(CapturedPhoto.sample())

        #expect(photo.source == .sample)
        #expect(!photo.data.isEmpty)
        #expect(photo.image.size.width > 0)
        #expect(photo.image.size.height > 0)
    }

    /// An image with no drawable pixels can't be JPEG-encoded, so the
    /// initializer has to refuse it rather than hand back an empty payload.
    @Test func rejectsAnImageThatCannotBeEncoded() {
        #expect(CapturedPhoto(image: UIImage(), source: .camera) == nil)
    }

    // MARK: - Species, required by POST /api/v1/scans

    @Test func startsWithAFallbackSpecies() {
        #expect(ScanSession().species == PlantSpecies.fallback)
        #expect(PlantSpecies.options.contains(PlantSpecies.fallback))
    }

    @Test func speciesOptionsAreNonEmptyAndWithinTheColumnLimit() {
        #expect(!PlantSpecies.options.isEmpty)
        for name in PlantSpecies.options {
            #expect(!name.isEmpty)
            #expect(name.count <= 64)
        }
    }

    /// A retake is the same plant, so clearing the photo must not clear the
    /// species the user already picked.
    @Test func clearKeepsTheSpecies() throws {
        let session = ScanSession()
        session.species = "tomato"
        session.accept(try #require(CapturedPhoto(image: solidImage(), source: .camera)))

        session.clear()

        #expect(session.photo == nil)
        #expect(session.species == "tomato")
    }

    @Test func resetRestoresTheFallbackSpecies() throws {
        let session = ScanSession()
        session.species = "tomato"
        session.accept(try #require(CapturedPhoto(image: solidImage(), source: .camera)))

        session.reset()

        #expect(session.photo == nil)
        #expect(session.species == PlantSpecies.fallback)
    }
}
