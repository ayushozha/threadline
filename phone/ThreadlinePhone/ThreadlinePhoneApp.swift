import SwiftUI

@main
struct ThreadlinePhoneApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

enum Config {
    static var server: String {
        let configured = (Bundle.main.object(forInfoDictionaryKey: "ThreadlineDefaultServer") as? String)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return configured.isEmpty || configured.hasPrefix("$(") ? "https://threadline.ayushojha.com" : configured
    }

    static var key: String {
        let configured = (Bundle.main.object(forInfoDictionaryKey: "ThreadlineDemoKey") as? String)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return configured.hasPrefix("$(") ? "" : configured
    }
}

@MainActor
final class SendModel: ObservableObject {
    @Published var status = "Ready."
    @Published var busy = false
    @Published var succeeded = false
    private var autoRan = false

    func autoRunOnce() {
        guard !autoRan else { return }
        autoRan = true
        send()
    }

    func send() {
        guard !busy else { return }
        busy = true
        succeeded = false
        Task {
            defer { busy = false }
            do {
                guard !Config.key.isEmpty else { throw UploadError.message("This build has no Threadline key.") }
                let exporter = HealthExporter()
                status = "Asking for Health access…"
                try await exporter.authorize()
                let rows = try await exporter.collect { text in
                    Task { @MainActor in self.status = text }
                }
                guard !rows.isEmpty else { throw UploadError.message("No Health data found (or access was denied).") }
                status = "Sending \(rows.count) values…"
                let result = try await Uploader.send(rows: rows)
                status = "Sent \(result.days) days, \(result.metrics) metrics"
                    + (result.range.map { "\n\($0[0]) to \($0[1])" } ?? "")
                succeeded = true
            } catch {
                status = "Failed: \(error.localizedDescription)"
            }
        }
    }
}

struct ContentView: View {
    @StateObject private var model = SendModel()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: model.succeeded ? "checkmark.circle.fill" : "heart.text.square.fill")
                .font(.system(size: 64))
                .foregroundStyle(model.succeeded ? .green : .pink)
            Text("Threadline Health").font(.title.bold())
            Text("Sends daily totals and averages from the last 365 days of Apple Health to \(URL(string: Config.server)?.host ?? Config.server).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                model.send()
            } label: {
                Text("Send my Health data to Threadline")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.busy)
            HStack(spacing: 8) {
                if model.busy { ProgressView() }
                Text(model.status)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
            }
            .font(.callout)
            Spacer()
        }
        .padding(24)
        .task { model.autoRunOnce() }
    }
}
