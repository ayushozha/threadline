import Foundation

enum UploadError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(text) = self { return text }
        return nil
    }
}

struct UploadResult: Decodable {
    let days: Int
    let metrics: [String]
    let range: [String]?
}

enum Uploader {
    static func send(rows: [DailyRow]) async throws -> (days: Int, metrics: Int, range: [String]?) {
        guard let url = URL(string: Config.server.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/health/daily") else {
            throw UploadError.message("Bad server URL.")
        }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Config.key, forHTTPHeaderField: "X-Publish-Key")
        request.httpBody = try JSONEncoder().encode(Payload(rows: rows, source: "iphone"))
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"]
            let text = detail.map { "\($0)" } ?? String(data: data.prefix(300), encoding: .utf8) ?? ""
            throw UploadError.message("Server \(code): \(text)")
        }
        let result = try JSONDecoder().decode(UploadResult.self, from: data)
        return (result.days, result.metrics.filter { !$0.hasPrefix("workout:") }.count, result.range)
    }

    private struct Payload: Encodable {
        let rows: [DailyRow]
        let source: String
    }
}
