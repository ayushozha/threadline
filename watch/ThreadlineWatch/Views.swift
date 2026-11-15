import SwiftUI

/// Start screen: the watch gets its own code and shows it; you enter it on the Threadline website.
/// A saved pairing is resumed on launch and goes straight to the sensors screen.
struct DeviceCodeView: View {
    @EnvironmentObject var session: StreamSession
    @StateObject private var pairing = DevicePairing()
    @State private var openStream = false
    @State private var started = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if pairing.claimed {
                    Text("Paired ✓").font(.title2.bold()).foregroundStyle(.green)
                    Button("Open sensors") { openStream = true }.tint(.green)
                    Button("Unpair", role: .destructive) { pairing.unpair() }
                } else if pairing.code.isEmpty {
                    ProgressView()
                    Text(pairing.note ?? "Connecting…").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("Pair on the website").font(.headline)
                    Text(pairing.spacedCode)
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.6).lineLimit(1)
                    Text("Enter \(pairing.spacedCode) at \(pairing.host)")
                        .font(.footnote).multilineTextAlignment(.center)
                    Text(pairing.note ?? "Waiting…").font(.caption2).foregroundStyle(.secondary)
                }
                Text("Connected to \(pairing.host)").font(.caption2).foregroundStyle(.secondary)
                if !pairing.claimed {
                    NavigationLink("Enter a code from the website instead") { PairView() }
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("Threadline")
        .navigationDestination(isPresented: $openStream) {
            StreamView(autoStart: true, onUnpair: unpair)
                .onAppear { session.configure(server: pairing.server, code: pairing.code, watchKey: pairing.watchKey) }
        }
        .onAppear {
            if !started { started = true; pairing.begin() }
        }
        .onChange(of: pairing.claimed) { _, claimed in
            guard claimed else { return }
            if pairing.resumed { openStream = true; return }
            Task { try? await Task.sleep(for: .seconds(1)); if pairing.claimed { openStream = true } }
        }
        .onChange(of: session.pairingLost) { _, lost in
            if lost { unpair() }  // the server forgot this pairing: show a fresh code
        }
    }

    private func unpair() {
        openStream = false
        pairing.unpair()
    }
}

/// Fallback: a 6-digit code created on the Threadline website.
struct PairView: View {
    @EnvironmentObject var session: StreamSession
    @AppStorage("code") private var code = ""

    private var codeIsValid: Bool { code.count == 6 && code.allSatisfy(\.isNumber) }

    var body: some View {
        Form {
            Section("Pairing code") {
                TextField("123456", text: $code)
            }
            NavigationLink("Continue") {
                StreamView()
                    .onAppear { session.configure(server: AppConfig.defaultServer, code: code) }
            }
            .disabled(!codeIsValid)
        }
        .navigationTitle("Threadline")
    }
}

/// Asked when the paired page requests a mood log. Nothing is written to Health unless the user taps Save.
struct MoodConfirmView: View {
    let request: StreamSession.MoodRequest
    let answer: (Bool) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Save this mood to Apple Health?").font(.headline).multilineTextAlignment(.center)
                Text(String(format: "Valence %+.2f", request.valence)).font(.footnote.monospacedDigit())
                Text(feeling).font(.footnote).foregroundStyle(.secondary)
                if !request.labels.isEmpty { Text(request.labels.joined(separator: ", ")).font(.footnote) }
                if !request.reason.isEmpty { Text(request.reason).font(.caption2).foregroundStyle(.secondary) }
                Button("Save") { answer(true) }.tint(.green)
                Button("Not now", role: .cancel) { answer(false) }
            }
        }
    }

    private var feeling: String {
        request.valence <= -0.33 ? "Unpleasant" : request.valence >= 0.33 ? "Pleasant" : "Neutral"
    }
}

/// Screen 2: live sensor readings, what is being shared, and an optional audio recording.
struct StreamView: View {
    @EnvironmentObject var session: StreamSession
    @Environment(\.isLuminanceReduced) private var screenDimmed
    var autoStart = false
    var onUnpair: (() -> Void)?

    var body: some View {
        StreamContent(session: session, sensors: session.sensors, onUnpair: onUnpair)
            .onChange(of: screenDimmed, initial: true) { _, dimmed in session.wristRaised = !dimmed }
            .task {
                // After a device-code pairing, start right away (permission prompts still appear as usual).
                if autoStart, !session.isStreaming { session.toggle() }
            }
            .onDisappear { if session.isStreaming { session.toggle() } }
            .sheet(item: $session.moodRequest, onDismiss: { session.answerMood(save: false) }) { request in
                MoodConfirmView(request: request) { session.answerMood(save: $0) }
            }
    }
}

private struct StreamContent: View {
    @ObservedObject var session: StreamSession
    @ObservedObject var sensors: Sensors
    var onUnpair: (() -> Void)?

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
                if let reason = session.hapticReason {
                    Label(reason, systemImage: "hand.tap").font(.footnote).foregroundStyle(.yellow)
                }

                Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 2) {
                    row("Heart rate", sensors.heartRate.map { "\(Int($0)) bpm" })
                    row("Steps", sensors.steps.map(String.init))
                    row("Active", sensors.activeKcal.map { String(format: "%.1f kcal", $0) })
                    row("Activity", sensors.activity)
                }
                .font(.footnote)
                if let note = session.moodNote { Text(note).font(.caption2).foregroundStyle(.secondary) }
                if let note = sensors.note { Text(note).font(.caption2).foregroundStyle(.orange) }

                Toggle("Record audio too", isOn: $session.recordAudio)
                    .disabled(session.isStreaming)

                Toggle("Share cycle dates", isOn: $session.shareCycle)
                    .onChange(of: session.shareCycle) { _, _ in session.shareCycleChanged() }
                Text(session.cycleNote ?? "Off by default. When on, sends the first day of each period you logged in Health (last 12 months) to your page. No flow levels, no predictions.")
                    .font(.caption2).foregroundStyle(.secondary)

                Text(sharingText).font(.caption2).foregroundStyle(.secondary)

                if let onUnpair {
                    Button("Unpair", role: .destructive) {
                        if session.isStreaming { session.toggle() }
                        onUnpair()
                    }
                    Text("Connected to \(session.host)").font(.caption2).foregroundStyle(.secondary)
                }

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
        return "While streaming, heart rate, steps, active energy, activity and whether the screen is awake go to \(session.host) about once a second and on to your paired page. About once a minute it adds your latest HRV, resting heart rate, respiratory rate, blood oxygen, wrist temperature change, sleep, noise, exercise and mindful minutes, and today's logged state of mind, when Health has them. \(audio) Nothing is saved on the watch. Your page can tap your wrist with a haptic or suggest a mood, which is saved to Health only if you tap Save."
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
