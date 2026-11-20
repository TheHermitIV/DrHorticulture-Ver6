import SwiftUI
import Testing

@testable import DrHorticulture

struct AppThemeTests {
    @Test func systemLetsThePhoneDecide() {
        #expect(AppTheme.system.colorScheme == nil)
    }

    @Test func lightAndDarkForceTheirScheme() {
        #expect(AppTheme.light.colorScheme == .light)
        #expect(AppTheme.dark.colorScheme == .dark)
    }

    @Test func windowStyleMatchesTheme() {
        #expect(AppTheme.system.interfaceStyle == .unspecified)
        #expect(AppTheme.light.interfaceStyle == .light)
        #expect(AppTheme.dark.interfaceStyle == .dark)
    }

    @Test func pickerOffersAllThreeInOrder() {
        #expect(AppTheme.allCases.map(\.label) == ["System", "Light", "Dark"])
    }
}
