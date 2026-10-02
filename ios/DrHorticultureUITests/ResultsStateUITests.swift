import XCTest

/// Drives the three Results states through the mock-response picker, so no
/// backend is involved.
@MainActor
final class ResultsStateUITests: XCTestCase {
    private func launchToResults() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tabBars.firstMatch.buttons["Scan"].tap()
        app.buttons["capture.sampleButton"].tap()
        app.buttons["preview.acceptButton"].tap()
        XCTAssertTrue(app.staticTexts["results.title"].waitForExistence(timeout: 10))
        return app
    }

    private func selectScenario(_ label: String, in app: XCUIApplication) {
        let picker = app.segmentedControls["results.scenarioPicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.buttons[label].tap()
    }

    func testAbstentionStateIsShownByDefault() {
        let app = launchToResults()

        XCTAssertTrue(app.staticTexts["results.abstention"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["results.retakeButton"].exists)
    }

    func testFertilizeRecommendationState() {
        let app = launchToResults()

        selectScenario("Fertilize", in: app)

        let recommendation = app.staticTexts["results.recommendation"]
        XCTAssertTrue(recommendation.waitForExistence(timeout: 10))
        XCTAssertEqual(recommendation.label, "Fertilize")
    }

    func testDoNotFertilizeRecommendationState() {
        let app = launchToResults()

        selectScenario("Don't fertilize", in: app)

        let recommendation = app.staticTexts["results.recommendation"]
        XCTAssertTrue(recommendation.waitForExistence(timeout: 10))
        XCTAssertEqual(recommendation.label, "Don't fertilize")
    }

    func testNDVIAndConfidenceAreShownWithAReading() {
        let app = launchToResults()

        selectScenario("Fertilize", in: app)

        let ndvi = app.descendants(matching: .any).matching(identifier: "results.ndvi").firstMatch
        XCTAssertTrue(ndvi.waitForExistence(timeout: 10))

        let confidence = app.descendants(matching: .any)
            .matching(identifier: "results.confidence").firstMatch
        XCTAssertTrue(confidence.waitForExistence(timeout: 10))
    }

    func testErrorScenarioShowsTheRetryCopy() {
        let app = launchToResults()

        selectScenario("Error", in: app)

        XCTAssertTrue(app.staticTexts["results.abstention"].waitForExistence(timeout: 10))
    }
}
