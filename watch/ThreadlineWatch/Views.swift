import SwiftUI

/// Screen 1: server address and the 6-digit code shown on the Threadline website.
struct PairView: View {
    @EnvironmentObject var recorder: Recorder
    @AppStorage("server") private var server = "https://threadline.ayushojha.com"
    @AppStorage("code") private var code = ""

    private var codeIsValid: Bool { code.count == 6 && code.allSatisfy(\.isNumber) }

    var body: some View {
        Form {
            Section("Server") {
                TextField("https://…", text: $server)
                    .textContentType(.URL)
            }
            Section("Pairing code") {
                TextField("123456", text: $code)
            }
            NavigationLink("Continue") {
                RecordView()
                    .onAppear { recorder.configure(server: server, code: code) }
            }
            .disabled(!codeIsValid || URL(string: server)?.host == nil)
        }
        .navigationTitle("Threadline")
    }
}

/// Screen 2: record/stop, elapsed time, connection state and the live transcript.
struct RecordView: View {
    @EnvironmentObject var recorder: Recorder

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Button(action: recorder.toggle) {
                    Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                        .font(.title)
                        .frame(maxWidth: .infinity, minHeight: 56)
                }
                .tint(recorder.isRecording ? .red : .accentColor)

                if let start = recorder.startedAt {
                    TimelineView(.periodic(from: start, by: 1)) { context in
                        Text(Self.elapsed(from: start, to: context.date)).font(.title3.monospacedDigit())
                    }
                }
                Text(recorder.status).font(.footnote).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(recorder.lines.suffix(30).enumerated()), id: \.offset) { _, line in
                        Text(line).font(.footnote)
                    }
                    if !recorder.interim.isEmpty {
                        Text(recorder.interim).font(.footnote).foregroundStyle(.secondary).italic()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .navigationTitle("Record")
        .onDisappear { if recorder.isRecording { recorder.toggle() } }
    }

    static func elapsed(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
