import AVFoundation
import Foundation
import WatchKit

/// Streams sensor readings (about once a second) and, optionally, microphone audio to the Threadline
/// server, which forwards them to the paired web page. Audio goes on to Deepgram for transcription.
/// Nothing is stored on the watch.
///
/// Transport: a WebSocket to /api/watch/stream (works in the Simulator). watchOS blocks WebSockets for
/// most apps on a real watch (Apple TN3135), so if the socket is not ready within 6 s we switch to plain
/// HTTPS: sensors to /api/watch/sensors and ~0.5 s audio chunks to /api/watch/audio.
@MainActor
final class StreamSession: ObservableObject {
    @Published var isStreaming = false
    @Published var recordAudio = false
    @Published var startedAt: Date?
    @Published var status = "Not streaming"
    @Published var lines: [String] = []
    @Published var interim = ""
    var wristRaised: Bool?

    let sensors = Sensors()
    @Published private(set) var server = URL(string: "https://threadline.ayushojha.com")!
    private var code = ""
    private let device = WKInterfaceDevice.current().name

    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    private var audioRunning = false
    private var pending = Data()
    private static let frameBytes = 3_200   // 100 ms of 16 kHz Int16 mono
    private static let postBytes = 16_000   // 500 ms per HTTP chunk

    private var socket: URLSessionWebSocketTask?
    private var socketReady = false
    private var everReady = false
    private var rejected = false
    private var useHTTP = false
    private var httpInFlight = false
    private var reconnectAttempts = 0
    private var ticker: Task<Void, Never>?

    var host: String { server.host ?? server.absoluteString }

    func configure(server: String, code: String) {
        if let url = URL(string: server.trimmingCharacters(in: .whitespaces)) { self.server = url }
        self.code = code
    }

    func toggle() {
        isStreaming ? stop() : start()
    }

    // MARK: Start / stop

    private func start() {
        lines = []; interim = ""; pending = Data()
        everReady = false; rejected = false; useHTTP = false; reconnectAttempts = 0
        isStreaming = true
        status = "Starting…"
        Task {
            await sensors.start()
            if recordAudio {
                guard await AVAudioApplication.requestRecordPermission() else {
                    status = "Microphone permission denied"; stop(); return
                }
                do { try startAudio() } catch { status = "Audio failed: \(error.localizedDescription)"; stop(); return }
            }
            guard isStreaming else { return }
            startedAt = Date()  // after permission prompts
            connect()
            ticker = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    self.sendSensors()
                }
            }
        }
    }

    private func stop() {
        ticker?.cancel(); ticker = nil
        sensors.stop()
        stopAudio()
        isStreaming = false
        startedAt = nil
        if useHTTP {
            if recordAudio { flushHTTP(final: true) } else { status = "Stopped" }
        } else if let socket {
            if !pending.isEmpty && socketReady { socket.send(.data(pending)) { _ in } }
            socket.send(.string(#"{"type":"stop"}"#)) { _ in }
            status = "Finishing…"
            // The server answers {"type":"closed"} and closes; cancel anyway if it does not.
            Task { try? await Task.sleep(for: .seconds(4)); if !self.isStreaming { self.closeSocket(); self.status = "Stopped" } }
        } else {
            status = "Stopped"
        }
        pending = Data()
    }

    // MARK: Sensors

    private static let iso = ISO8601DateFormatter()

    private func sensorFrame() -> [String: Any] {
        var frame: [String: Any] = ["type": "sensors", "t": Self.iso.string(from: Date()), "activity": sensors.activity]
        if let value = sensors.heartRate { frame["heart_rate"] = (value * 10).rounded() / 10 }
        if let value = sensors.steps { frame["steps"] = value }
        if let value = sensors.activeKcal { frame["active_kcal"] = (value * 10).rounded() / 10 }
        if let value = wristRaised { frame["wrist_raised"] = value }
        return frame
    }

    private func sendSensors() {
        guard isStreaming, let body = try? JSONSerialization.data(withJSONObject: sensorFrame()) else { return }
        if useHTTP {
            Task { await post("/api/watch/sensors", body: body, contentType: "application/json") }
        } else if let socket, socketReady, let text = String(data: body, encoding: .utf8) {
            socket.send(.string(text)) { _ in }
        }
    }

    // MARK: Audio

    private func startAudio() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inputFormat, to: target) else {
            throw NSError(domain: "Threadline", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported microphone format"])
        }
        let target = self.target
        input.installTap(onBus: 0, bufferSize: 4_096, format: inputFormat) { [weak self] buffer, _ in
            guard let data = Self.convert(buffer, with: converter, to: target) else { return }
            Task { @MainActor in self?.enqueue(data) }
        }
        engine.prepare()
        try engine.start()
        audioRunning = true
    }

    private func stopAudio() {
        guard audioRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
        audioRunning = false
    }

    nonisolated private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to target: AVAudioFormat) -> Data? {
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData else { return nil }
        return Data(bytes: samples[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)
    }

    private func enqueue(_ data: Data) {
        guard isStreaming, recordAudio else { return }
        pending.append(data)
        if useHTTP {
            if pending.count >= Self.postBytes { flushHTTP(final: false) }
            return
        }
        guard let socket, socketReady else {
            if pending.count > 160_000 { pending.removeFirst(pending.count - 160_000) }  // keep ~5 s while connecting
            return
        }
        while pending.count >= Self.frameBytes {
            let frame = pending.prefix(Self.frameBytes)
            pending.removeFirst(Self.frameBytes)
            socket.send(.data(Data(frame))) { _ in }
        }
    }

    // MARK: WebSocket transport

    private func endpoint(_ path: String, websocket: Bool) -> URL? {
        guard var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
        if websocket { parts.scheme = parts.scheme == "http" ? "ws" : "wss" }
        parts.path = path
        return parts.url
    }

    private func connect() {
        guard isStreaming, let url = endpoint("/api/watch/stream", websocket: true) else { return }
        closeSocket()
        status = reconnectAttempts == 0 ? "Connecting…" : "Reconnecting…"
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        let hello = ["code": code, "device": device, "format": recordAudio ? "pcm16" : "sensors"]
        if let data = try? JSONSerialization.data(withJSONObject: hello), let text = String(data: data, encoding: .utf8) {
            task.send(.string(text)) { _ in }
        }
        receive(on: task)
        // If the first socket is not ready in 6 s, assume WebSockets are blocked (real watch) and use HTTPS.
        Task {
            try? await Task.sleep(for: .seconds(6))
            if self.socket === task, !self.socketReady, !self.everReady, self.isStreaming { self.switchToHTTP() }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.socket === task else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(text)
                    self.receive(on: task)
                case .success:
                    self.receive(on: task)
                case .failure:
                    self.socketDropped()
                }
            }
        }
    }

    private func socketDropped() {
        socketReady = false
        guard isStreaming else { closeSocket(); status = "Stopped"; return }
        if rejected { let reason = status; stop(); status = reason; return }  // e.g. bad code: retrying will not help
        if !everReady { switchToHTTP(); return }
        reconnectAttempts += 1
        status = "Connection lost, retrying…"
        let delay = min(Double(reconnectAttempts), 5)
        Task { try? await Task.sleep(for: .seconds(delay)); self.connect() }
    }

    private func closeSocket() {
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        socketReady = false
    }

    // MARK: HTTPS fallback transport

    private func switchToHTTP() {
        closeSocket()
        useHTTP = true
        status = "Streaming (HTTPS)"
    }

    private func flushHTTP(final: Bool) {
        guard !httpInFlight || final else { return }
        let chunk = pending
        pending = Data()
        httpInFlight = true
        Task {
            await post("/api/watch/audio", body: chunk)
            if final {
                await post("/api/watch/audio/stop", body: nil)
                self.status = "Stopped"
            }
            self.httpInFlight = false
        }
    }

    private func post(_ path: String, body: Data?, contentType: String = "application/octet-stream") async {
        guard let url = endpoint(path, websocket: false) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(code, forHTTPHeaderField: "X-Watch-Code")
        request.setValue(device, forHTTPHeaderField: "X-Watch-Device")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if (response as? HTTPURLResponse)?.statusCode == 401 { status = "Code expired. Pair again."; return }
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            for message in json?["messages"] as? [[String: Any]] ?? [] { handle(message) }
        } catch {
            if isStreaming { status = "Network error, retrying…" }  // the next post retries
        }
    }

    // MARK: Server messages

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        handle(message)
    }

    private func handle(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "ready":
            socketReady = true; everReady = true; reconnectAttempts = 0
            status = "Streaming"
            enqueue(Data())
        case "result":
            let transcript = message["transcript"] as? String ?? ""
            if message["is_final"] as? Bool == true {
                if !transcript.isEmpty { lines.append(transcript) }
                interim = ""
            } else {
                interim = transcript
            }
        case "error":
            status = message["message"] as? String ?? "Server error"
            if !everReady { rejected = true }
        case "closed":
            if !isStreaming { status = "Stopped"; closeSocket() }
        default:
            break
        }
    }
}
