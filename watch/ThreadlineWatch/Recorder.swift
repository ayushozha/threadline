import AVFoundation
import Foundation
import WatchKit

/// Captures the microphone, converts it to 16 kHz mono Int16 PCM and streams it to the Threadline server,
/// which relays it to Deepgram. Audio is never written to disk on the watch.
///
/// Transport: a WebSocket to /api/watch/stream (works in the Simulator). watchOS blocks WebSockets for
/// most apps on a real watch (Apple TN3135), so if the socket never becomes ready we switch to plain
/// HTTPS POSTs of ~0.5 s chunks to /api/watch/audio, which URLSession allows everywhere.
@MainActor
final class Recorder: ObservableObject {
    @Published var isRecording = false
    @Published var startedAt: Date?
    @Published var status = "Not connected"
    @Published var lines: [String] = []
    @Published var interim = ""

    private var server = URL(string: "https://threadline.ayushojha.com")!
    private var code = ""
    private let device = WKInterfaceDevice.current().name

    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    private var pending = Data()
    private static let frameBytes = 3_200   // 100 ms of 16 kHz Int16 mono
    private static let postBytes = 16_000   // 500 ms per HTTP chunk

    private var socket: URLSessionWebSocketTask?
    private var socketReady = false
    private var everReady = false
    private var useHTTP = false
    private var httpInFlight = false
    private var reconnectAttempts = 0
    private var rejected = false

    func configure(server: String, code: String) {
        if let url = URL(string: server.trimmingCharacters(in: .whitespaces)) { self.server = url }
        self.code = code
    }

    func toggle() {
        isRecording ? stop() : start()
    }

    // MARK: Recording

    private func start() {
        lines = []; interim = ""; pending = Data()
        everReady = false; useHTTP = false; reconnectAttempts = 0; rejected = false
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                guard granted else { self.status = "Microphone permission denied"; return }
                do {
                    try self.startAudio()
                    self.isRecording = true
                    self.startedAt = Date()
                    self.connect()
                } catch {
                    self.status = "Audio failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
        isRecording = false
        startedAt = nil
        if useHTTP {
            flushHTTP(final: true)
        } else if let socket {
            if !pending.isEmpty { socket.send(.data(pending)) { _ in } }
            socket.send(.string(#"{"type":"stop"}"#)) { _ in }
            status = "Finishing…"
            // The server answers {"type":"closed"} and closes; cancel anyway if it does not.
            Task { try? await Task.sleep(for: .seconds(4)); if !self.isRecording { self.closeSocket() } }
        }
        pending = Data()
    }

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
        guard isRecording else { return }
        pending.append(data)
        if useHTTP {
            if pending.count >= Self.postBytes { flushHTTP(final: false) }
            return
        }
        guard let socket, socketReady else {
            // Keep at most ~5 s while (re)connecting.
            if pending.count > 160_000 { pending.removeFirst(pending.count - 160_000) }
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
        guard isRecording, let url = endpoint("/api/watch/stream", websocket: true) else { return }
        closeSocket()
        status = reconnectAttempts == 0 ? "Connecting…" : "Reconnecting…"
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        let hello = ["code": code, "device": device, "format": "pcm16"]
        let text = String(data: try! JSONSerialization.data(withJSONObject: hello), encoding: .utf8)!
        task.send(.string(text)) { _ in }
        receive(on: task)
        // If the socket has not said "ready" in 6 s on the first try, assume WebSockets are blocked.
        Task {
            try? await Task.sleep(for: .seconds(6))
            if self.socket === task, !self.socketReady, !self.everReady, self.isRecording { self.switchToHTTP() }
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
        guard isRecording else { closeSocket(); status = "Stopped"; return }
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

    // MARK: HTTP fallback transport

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

    private func post(_ path: String, body: Data?) async {
        guard let url = endpoint(path, websocket: false) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(code, forHTTPHeaderField: "X-Watch-Code")
        request.setValue(device, forHTTPHeaderField: "X-Watch-Device")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if (response as? HTTPURLResponse)?.statusCode == 401 { status = "Code expired. Pair again."; return }
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            for message in json?["messages"] as? [[String: Any]] ?? [] { handle(message) }
        } catch {
            status = "Network error, retrying…"  // the next chunk retries; this one is dropped
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
            status = useHTTP ? "Streaming (HTTPS)" : "Streaming"
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
            if !isRecording { status = "Stopped"; closeSocket() }
        default:
            break
        }
    }
}
