import Foundation

/// Talks to the live backend: `POST /api/v1/scans` as multipart with a
/// `species` field and one JPEG in `image`.
struct APIAnalysisService: AnalysisService {
    // TODO(decision): move to build configuration
    var baseURL = URL(string: "https://drhorticulture-ver6-production.up.railway.app")!

    func analyze(imageData: Data, species: String) async throws -> Scan {
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(
            url: baseURL.appending(path: "api/v1/scans"),
            timeoutInterval: 60
        )
        request.httpMethod = "POST"
        request.setValue(
            "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type"
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Self.multipartBody(
            imageData: imageData, species: species, boundary: boundary
        )

        let result: (Data, URLResponse)
        do {
            result = try await URLSession.shared.data(for: request)
        } catch let error as URLError {
            throw AnalysisError.transport(Self.message(for: error))
        } catch {
            throw AnalysisError.transport("Couldn't reach the server. Try again.")
        }
        let (data, response) = result

        guard let http = response as? HTTPURLResponse else {
            throw AnalysisError.transport("The server sent an unexpected response.")
        }

        guard (200..<300).contains(http.statusCode) else {
            let body =
                (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?.error
                ?? APIErrorBody(
                    code: "HTTP_\(http.statusCode)",
                    message: "The server returned an error (\(http.statusCode)). Try again."
                )
            if http.statusCode == 422 || body.code == "IMAGE_REJECTED" {
                throw AnalysisError.imageRejected(body)
            }
            throw AnalysisError.api(body)
        }

        do {
            return try JSONDecoder().decode(Scan.self, from: data)
        } catch {
            throw AnalysisError.transport("The server sent a response the app couldn't read.")
        }
    }

    /// `species` first, then the photo bytes unchanged.
    private static func multipartBody(imageData: Data, species: String, boundary: String) -> Data {
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"species\"\r\n\r\n".utf8))
        body.append(Data("\(species)\r\n".utf8))
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(
            Data("Content-Disposition: form-data; name=\"image\"; filename=\"photo.jpg\"\r\n".utf8)
        )
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(imageData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }

    private static func message(for error: URLError) -> String {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            return "You're offline. Check your connection and try again."
        case .timedOut:
            return "The server took too long to respond. Try again."
        case .cancelled:
            return "The request was cancelled."
        default:
            return "Couldn't reach the server. Try again."
        }
    }
}
