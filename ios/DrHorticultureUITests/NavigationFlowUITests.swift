import XCTest

@MainActor
final class NavigationFlowUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        return app
    }

    func testOpensOnHomeWithAllThreeTabs() {
        let app = launch()

        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["home.emptyHistory"].exists)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10))
        XCTAssertTrue(tabBar.buttons["Home"].exists)
        XCTAssertTrue(tabBar.buttons["Scan"].exists)
        XCTAssertTrue(tabBar.buttons["Settings"].exists)
    }

    func testScanTabOffersASavedPhotoAndTheSample() {
        let app = launch()

        app.tabBars.firstMatch.buttons["Scan"].tap()

        // Queried type-agnostically: SwiftUI decides the element type for a
        // combined accessibility container, and it is not part of the contract.
        let viewfinder = app.descendants(matching: .any)
            .matching(identifier: "capture.viewfinder").firstMatch
        XCTAssertTrue(viewfinder.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["capture.libraryButton"].exists)
        XCTAssertTrue(app.buttons["capture.sampleButton"].exists)
        // No camera exists in the simulator, so that button must not be offered.
        XCTAssertFalse(app.buttons["capture.cameraButton"].exists)
    }

    func testHomeButtonJumpsToTheScanTab() {
        let app = launch()

        app.buttons["home.startButton"].tap()

        XCTAssertTrue(app.buttons["capture.sampleButton"].waitForExistence(timeout: 10))
    }

    func testWalksScanToResults() {
        let app = launch()

        app.tabBars.firstMatch.buttons["Scan"].tap()
        app.buttons["capture.sampleButton"].tap()

        XCTAssertTrue(app.staticTexts["preview.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["preview.image"].exists)

        app.buttons["preview.acceptButton"].tap()
        XCTAssertTrue(app.staticTexts["results.title"].waitForExistence(timeout: 10))
    }

    func testRetakeFromPreviewReturnsToCapture() {
        let app = launch()

        app.tabBars.firstMatch.buttons["Scan"].tap()
        app.buttons["capture.sampleButton"].tap()
        XCTAssertTrue(app.staticTexts["preview.title"].waitForExistence(timeout: 10))

        app.buttons["preview.retakeButton"].tap()

        XCTAssertTrue(app.buttons["capture.sampleButton"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["preview.title"].exists)
    }

    /// Leaving Scan mid-flow must not strand the user deep in the stack.
    func testLeavingScanResetsTheFlow() {
        let app = launch()
        let tabBar = app.tabBars.firstMatch

        tabBar.buttons["Scan"].tap()
        app.buttons["capture.sampleButton"].tap()
        XCTAssertTrue(app.staticTexts["preview.title"].waitForExistence(timeout: 10))

        tabBar.buttons["Home"].tap()
        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 10))

        tabBar.buttons["Scan"].tap()

        XCTAssertTrue(app.buttons["capture.sampleButton"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["preview.title"].exists)
    }

    func testSettingsTabShowsTheAbstentionThreshold() {
        let app = launch()

        app.tabBars.firstMatch.buttons["Settings"].tap()

        XCTAssertTrue(app.otherElements["settings.threshold"].waitForExistence(timeout: 10)
            || app.staticTexts["settings.threshold"].waitForExistence(timeout: 10))
    }
}
