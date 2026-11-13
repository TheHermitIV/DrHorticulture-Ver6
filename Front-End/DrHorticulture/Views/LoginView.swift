import SwiftUI

/// The first screen on every launch. The app's tabs stay hidden until the
/// backend accepts the username and password.
struct LoginView: View {
    @Environment(AuthSession.self) private var auth
    @Environment(\.authService) private var authService

    @State private var username = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    private enum Field {
        case username
        case password
    }

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
            && !auth.isSigningIn
    }

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(Color.brand)
                    .accessibilityHidden(true)

                Text("Dr. Horticulture")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("login.title")

                Text("Sign in to continue.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 48)

            VStack(spacing: 12) {
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focusedField, equals: .username)
                    .onSubmit { focusedField = .password }
                    .accessibilityIdentifier("login.username")

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused($focusedField, equals: .password)
                    .onSubmit(submit)
                    .accessibilityIdentifier("login.password")
            }
            .textFieldStyle(.roundedBorder)

            if let message = auth.errorMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("login.error")
            }

            Button(action: submit) {
                if auth.isSigningIn {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign in")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canSubmit)
            .accessibilityIdentifier("login.submitButton")

            Spacer()
        }
        .padding(24)
        .brandBackground()
        .onAppear { focusedField = .username }
    }

    private func submit() {
        guard canSubmit else { return }
        focusedField = nil
        Task {
            await auth.signIn(username: username, password: password, using: authService)
            if !auth.isSignedIn { password = "" }
        }
    }
}

#Preview {
    LoginView()
        .environment(AuthSession())
}
