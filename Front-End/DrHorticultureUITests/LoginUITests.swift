import XCTest

@MainActor
final class LoginUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testOpensOnTheLoginScreen() {
        let app = XCUIApplication.launchWithMocks()

        XCTAssertTrue(app.staticTexts["login.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["login.username"].exists)
        XCTAssertTrue(app.secureTextFields["login.password"].exists)
        XCTAssertFalse(app.buttons["login.submitButton"].isEnabled)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }

    func testSigningInShowsTheTabs() {
        let app = XCUIApplication.launchSignedIn()

        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.tabBars.firstMatch.exists)
    }

    func testSigningOutReturnsToTheLoginScreen() {
        let app = XCUIApplication.launchSignedIn()

        app.tabBars.firstMatch.buttons["Settings"].tap()
        let username = app.descendants(matching: .any)
            .matching(identifier: "settings.username").firstMatch
        XCTAssertTrue(username.waitForExistence(timeout: 10))
        app.buttons["settings.signOutButton"].tap()

        XCTAssertTrue(app.staticTexts["login.title"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }

    func testSettingsOffersALightAndDarkTheme() {
        let app = XCUIApplication.launchSignedIn()

        app.tabBars.firstMatch.buttons["Settings"].tap()
        let picker = app.segmentedControls["settings.themePicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertTrue(picker.buttons["System"].exists)
        XCTAssertTrue(picker.buttons["Light"].exists)

        picker.buttons["Dark"].tap()
        XCTAssertTrue(picker.buttons["Dark"].isSelected)

        // The choice is saved on the device, so put it back for the other tests.
        picker.buttons["System"].tap()
        XCTAssertTrue(picker.buttons["System"].isSelected)
    }
}
