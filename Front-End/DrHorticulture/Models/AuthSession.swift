import Foundation
import Observation

/// Who is signed in. Lives in memory only, so every launch starts at the login
/// screen.
@MainActor
@Observable
final class AuthSession {
    private(set) var username: String?
    private(set) var isSigningIn = false
    private(set) var errorMessage: String?

    var isSignedIn: Bool { username != nil }

    func signIn(username: String, password: String, using service: any AuthService) async {
        let username = username.trimmingCharacters(in: .whitespaces)
        guard !username.isEmpty, !password.isEmpty else {
            errorMessage = "Enter a username and password."
            return
        }

        isSigningIn = true
        errorMessage = nil
        defer { isSigningIn = false }

        do {
            self.username = try await service.login(username: username, password: password)
        } catch let error as AuthError {
            errorMessage = error.message
        } catch {
            errorMessage = "Couldn't sign in. Try again."
        }
    }

    func signOut() {
        username = nil
        errorMessage = nil
    }
}
