import Foundation
import Testing

@testable import DrHorticulture

@MainActor
struct AuthSessionTests {
    /// Answers every login with a fixed result and records what it was sent.
    private final class StubAuthService: AuthService, @unchecked Sendable {
        let result: Result<String, AuthError>
        private(set) var calls: [(username: String, password: String)] = []

        init(_ result: Result<String, AuthError>) {
            self.result = result
        }

        func login(username: String, password: String) async throws -> String {
            calls.append((username, password))
            return try result.get()
        }
    }

    @Test func startsSignedOut() {
        let session = AuthSession()

        #expect(session.isSignedIn == false)
        #expect(session.username == nil)
        #expect(session.errorMessage == nil)
    }

    @Test func aGoodLoginSignsIn() async {
        let session = AuthSession()
        let service = StubAuthService(.success("admin"))

        await session.signIn(username: " admin ", password: "secret", using: service)

        #expect(session.isSignedIn)
        #expect(session.username == "admin")
        #expect(session.errorMessage == nil)
        #expect(session.isSigningIn == false)
        #expect(service.calls.first?.username == "admin")
    }

    @Test func aRejectedLoginShowsTheServerMessage() async {
        let session = AuthSession()
        let service = StubAuthService(
            .failure(.invalidCredentials("Incorrect username or password."))
        )

        await session.signIn(username: "admin", password: "wrong", using: service)

        #expect(session.isSignedIn == false)
        #expect(session.errorMessage == "Incorrect username or password.")
    }

    @Test func emptyFieldsNeverReachTheService() async {
        let session = AuthSession()
        let service = StubAuthService(.success("admin"))

        await session.signIn(username: "   ", password: "secret", using: service)

        #expect(session.isSignedIn == false)
        #expect(session.errorMessage == "Enter a username and password.")
        #expect(service.calls.isEmpty)
    }

    @Test func signingOutClearsTheUser() async {
        let session = AuthSession()
        await session.signIn(
            username: "admin", password: "secret", using: StubAuthService(.success("admin"))
        )

        session.signOut()

        #expect(session.isSignedIn == false)
        #expect(session.username == nil)
    }

    @Test func mockServiceAcceptsAnyNonEmptyCredentials() async throws {
        let service = MockAuthService()

        #expect(try await service.login(username: "admin", password: "x") == "admin")
        await #expect(throws: AuthError.self) {
            try await service.login(username: "admin", password: "")
        }
    }
}
