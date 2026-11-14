import SwiftUI

/// Screen 1: server address and the 6-digit code shown on the Threadline website.
struct PairView: View {
    @EnvironmentObject var session: StreamSession
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
                StreamView()
                    .onAppear { session.configure(server: server, code: code) }
            }
            .disabled(!codeIsValid || URL(string: server)?.host == nil)
        }
        .navigationTitle("Threadline")
    }
}

/// Screen 2: live sensor readings, what is being shared, and an optional audio recording.
struct StreamView: View {
    @EnvironmentObject var session: StreamSession
    @Environment(\.isLuminanceReduced) private var screenDimmed

    var body: some View {
        StreamContent(session: session, sensors: session.sensors)
            .onChange(of: screenDimmed, initial: true) { _, dimmed in session.wristRaised = !dimmed }
            .onDisappear { if session.isStreaming { session.toggle() } }
    }
}

private struct StreamContent: View {
    @ObservedObject var session: StreamSession
    @ObservedObject var sensors: Sensors

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Button(action: session.toggle) {
                    Label(session.isStreaming ? "Stop" : "Start streaming",
                          systemImage: session.isStreaming ? "stop.fill" : "dot.radiowaves.left.and.right")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .tint(session.isStreaming ? .red : .green)

                if let start = session.startedAt {
                    TimelineView(.periodic(from: start, by: 1)) { context in
                        Text(Self.elapsed(from: start, to: context.date)).font(.title3.monospacedDigit())
                    }
                }
                Text(session.status).font(.footnote).foregroundStyle(.secondary)

                Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 2) {
                    row("Heart rate", sensors.heartRate.map { "\(Int($0)) bpm" })
                    row("Steps", sensors.steps.map(String.init))
                    row("Active", sensors.activeKcal.map { String(format: "%.1f kcal", $0) })
                    row("Activity", sensors.activity)
                }
                .font(.footnote)
                if let note = sensors.note { Text(note).font(.caption2).foregroundStyle(.orange) }

                Toggle("Record audio too", isOn: $session.recordAudio)
                    .disabled(session.isStreaming)

                Text(sharingText).font(.caption2).foregroundStyle(.secondary)

                if session.recordAudio {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(session.lines.suffix(30).enumerated()), id: \.offset) { _, line in
                            Text(line).font(.footnote)
                        }
                        if !session.interim.isEmpty {
                            Text(session.interim).font(.footnote).foregroundStyle(.secondary).italic()
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .navigationTitle("Sensors")
    }

    private var sharingText: String {
        let audio = session.recordAudio
            ? "Microphone audio is sent too and transcribed by Deepgram."
            : "No audio is sent."
        return "While streaming, heart rate, steps, active energy, activity and whether the screen is awake go to \(session.host) about once a second and on to your paired page. \(audio) Nothing is saved on the watch or in Health."
    }

    @ViewBuilder private func row(_ label: String, _ value: String?) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value ?? "–")
        }
    }

    static func elapsed(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
