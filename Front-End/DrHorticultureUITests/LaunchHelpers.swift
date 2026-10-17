import XCTest

extension XCUIApplication {
    /// Launches against the mock services, so no backend is involved.
    static func launchWithMocks() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-useMockServices", "YES"]
        app.launch()
        return app
    }

    /// Launches with mocks and gets past the login screen.
    static func launchSignedIn() -> XCUIApplication {
        let app = launchWithMocks()
        app.signIn()
        // Taps sent while the login screen and keyboard are still animating away
        // get lost, so wait until the tabs are settled.
        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 10))
        app.dismissSavePasswordSheet()
        let keyboardGone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "count == 0"), object: app.keyboards
        )
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: 10), .completed)
        return app
    }

    func signIn(username: String = "admin", password: String = "password") {
        let usernameField = textFields["login.username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 10))
        usernameField.tap()
        usernameField.typeText(username)

        let passwordField = secureTextFields["login.password"]
        passwordField.tap()
        passwordField.typeText(password)

        buttons["login.submitButton"].tap()
    }

    /// iOS offers to save the password after every login. The sheet runs in a
    /// system process the tests can't query, and it swallows every tap until it
    /// is dismissed, so tap where its "Not Now" button sits. Without the sheet
    /// that spot is the empty "Recent scans" box on Home, so the tap is harmless.
    func dismissSavePasswordSheet() {
        Thread.sleep(forTimeInterval: 2)
        coordinate(withNormalizedOffset: CGVector(dx: 0.32, dy: 0.625)).tap()
    }
}
