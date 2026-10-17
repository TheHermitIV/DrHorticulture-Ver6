import SwiftUI

/// The seam between the login screen and the backend.
///
/// Mirrors `POST /api/v1/auth/login`: JSON `username` and `password`, answered
/// with `{ username }` or the shared error envelope.
protocol AuthService: Sendable {
    /// Returns the signed-in username.
    func login(username: String, password: String) async throws -> String
}

enum AuthError: Error, Equatable {
    /// 401 — the username or password is wrong.
    case invalidCredentials(String)
    /// Any other failure, with a message ready to show.
    case other(String)

    var message: String {
        switch self {
        case .invalidCredentials(let message), .other(let message): return message
        }
    }
}

struct APIAuthService: AuthService {
    var baseURL = APIConfig.baseURL

    func login(username: String, password: String) async throws -> String {
        var request = URLRequest(
            url: baseURL.appending(path: "api/v1/auth/login"),
            timeoutInterval: 30
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            ["username": username, "password": password]
        )

        let result: (Data, URLResponse)
        do {
            result = try await URLSession.shared.data(for: request)
        } catch {
            throw AuthError.other("Couldn't reach the server. Check your connection and try again.")
        }
        let (data, response) = result

        guard let http = response as? HTTPURLResponse else {
            throw AuthError.other("The server sent an unexpected response.")
        }

        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?
                .error?.message
            if http.statusCode == 401 {
                throw AuthError.invalidCredentials(message ?? "Incorrect username or password.")
            }
            throw AuthError.other(
                message ?? "The server returned an error (\(http.statusCode)). Try again."
            )
        }

        struct LoginResponse: Decodable { var username: String }
        guard let body = try? JSONDecoder().decode(LoginResponse.self, from: data) else {
            throw AuthError.other("The server sent a response the app couldn't read.")
        }
        return body.username
    }
}

/// Signs in with any non-empty username and password, so the app and its UI
/// tests run without a backend.
struct MockAuthService: AuthService {
    func login(username: String, password: String) async throws -> String {
        guard !username.isEmpty, !password.isEmpty else {
            throw AuthError.invalidCredentials("Incorrect username or password.")
        }
        return username
    }
}

private struct AuthServiceKey: EnvironmentKey {
    static let defaultValue: any AuthService = MockAuthService()
}

extension EnvironmentValues {
    var authService: any AuthService {
        get { self[AuthServiceKey.self] }
        set { self[AuthServiceKey.self] = newValue }
    }
}
