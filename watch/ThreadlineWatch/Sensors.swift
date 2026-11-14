import CoreMotion
import Foundation
import HealthKit

/// Live readings from the watch: heart rate and active energy from a HealthKit workout session
/// (which also keeps the app running with the wrist down), steps and activity from CoreMotion.
/// These are plain readings. The workout is discarded at the end, so nothing is saved to Health.
@MainActor
final class Sensors: NSObject, ObservableObject {
    @Published var heartRate: Double?
    @Published var steps: Int?
    @Published var activeKcal: Double?
    @Published var activity = "unknown"
    @Published var note: String?

    private let store = HKHealthStore()
    private var workout: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let pedometer = CMPedometer()
    private let motion = CMMotionActivityManager()

    func start() async {
        heartRate = nil; steps = nil; activeKcal = nil; activity = "unknown"; note = nil
        await startHealth()
        if CMPedometer.isStepCountingAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                let count = data?.numberOfSteps.intValue
                Task { @MainActor in self?.steps = count }
            }
        }
        if CMMotionActivityManager.isActivityAvailable() {
            motion.startActivityUpdates(to: .main) { [weak self] update in
                guard let update else { return }
                let name = update.running ? "run" : update.walking ? "walk" : update.stationary ? "still" : "unknown"
                Task { @MainActor in self?.activity = name }
            }
        }
    }

    func stop() {
        pedometer.stopUpdates()
        motion.stopActivityUpdates()
        workout?.end()
        let builder = self.builder
        builder?.endCollection(withEnd: Date()) { _, _ in builder?.discardWorkout() }
        workout = nil
        self.builder = nil
    }

    private func startHealth() async {
        guard HKHealthStore.isHealthDataAvailable() else { note = "Health data not available"; return }
        var read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned), Self.flowType]
        read.formUnion(Self.healthReadTypes)
        var share: Set<HKSampleType> = [HKObjectType.workoutType()]
        if #available(watchOS 11.0, *) {
            read.insert(HKObjectType.stateOfMindType())
            share.insert(HKObjectType.stateOfMindType())
        }
        do {
            try await store.requestAuthorization(toShare: share, read: read)
            let config = HKWorkoutConfiguration()
            config.activityType = .other
            config.locationType = .unknown
            let session = try HKWorkoutSession(healthStore: store, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            builder.delegate = self
            session.startActivity(with: Date())
            try await builder.beginCollection(at: Date())
            workout = session
            self.builder = builder
        } catch {
            note = "Heart rate unavailable: \(error.localizedDescription)"
        }
    }
}

// MARK: Cycle dates (only after the user turns on "Share cycle dates")

extension Sensors {
    static let flowType = HKCategoryType(.menstrualFlow)

    /// First day of each period the user logged in Health over the last 12 months, as "yyyy-MM-dd"
    /// (ascending, at most 24). Consecutive logged flow days form one period. No predictions, no flow levels.
    func periodStarts() async -> [String] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        try? await store.requestAuthorization(toShare: [], read: [Self.flowType])
        let calendar = Calendar.current
        let since = calendar.date(byAdding: .month, value: -12, to: Date())!
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: Self.flowType,
                                         predicate: HKQuery.predicateForSamples(withStart: since, end: Date()))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        guard let samples = try? await descriptor.result(for: store) else { return [] }
        let none = 5  // HKCategoryValueMenstrualFlow.none (logged "no flow")
        let days = Set(samples.filter { $0.value != none }.map { calendar.startOfDay(for: $0.startDate) }).sorted()
        var starts: [Date] = []
        for day in days {
            if let previous = calendar.date(byAdding: .day, value: -1, to: day), days.contains(previous) { continue }
            starts.append(day)
        }
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = calendar.timeZone
        format.dateFormat = "yyyy-MM-dd"
        return starts.suffix(24).map(format.string(from:))
    }
}

// MARK: Slow-changing Health values (read about once a minute while streaming)

extension Sensors {
    static let latestTypes: [(key: String, type: HKQuantityType, unit: HKUnit, scale: Double)] = [
        ("hrv_sdnn_ms", HKQuantityType(.heartRateVariabilitySDNN), .secondUnit(with: .milli), 1),
        ("resting_hr", HKQuantityType(.restingHeartRate), .count().unitDivided(by: .minute()), 1),
        ("respiratory_rate", HKQuantityType(.respiratoryRate), .count().unitDivided(by: .minute()), 1),
        ("spo2", HKQuantityType(.oxygenSaturation), .percent(), 100),
        ("wrist_temp_delta_c", HKQuantityType(.appleSleepingWristTemperature), .degreeCelsius(), 1),
        ("env_noise_db", HKQuantityType(.environmentalAudioExposure), .decibelAWeightedSoundPressureLevel(), 1),
    ]

    static var healthReadTypes: Set<HKObjectType> {
        Set(latestTypes.map(\.type) as [HKObjectType])
            .union([HKQuantityType(.appleExerciseTime), HKCategoryType(.mindfulSession), HKCategoryType(.sleepAnalysis)])
    }

    /// Latest real samples only. A value with no sample is left out; nothing is estimated.
    func healthSnapshot() async -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else { return [:] }
        var out: [String: Any] = [:]
        let now = Date()
        let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: now)!
        for item in Self.latestTypes {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: item.type, predicate: HKQuery.predicateForSamples(withStart: weekAgo, end: now))],
                sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)], limit: 1)
            if let sample = try? await descriptor.result(for: store).first {
                out[item.key] = sample.quantity.doubleValue(for: item.unit) * item.scale
            }
        }
        let today = Calendar.current.startOfDay(for: now)
        let todayPredicate = HKQuery.predicateForSamples(withStart: today, end: now)
        let exercise = HKStatisticsQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(.appleExerciseTime), predicate: todayPredicate), options: .cumulativeSum)
        if let minutes = try? await exercise.result(for: store)?.sumQuantity()?.doubleValue(for: .minute()) {
            out["exercise_min_today"] = minutes
        }
        let mindful = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.mindfulSession), predicate: todayPredicate)], sortDescriptors: [])
        if let sessions = try? await mindful.result(for: store), !sessions.isEmpty {
            out["mindful_min_today"] = Self.mergedSeconds(sessions.map { ($0.startDate, $0.endDate) }) / 60
        }
        // Last night: asleep stages (core, deep, REM, unspecified) since 6 pm yesterday, overlaps merged.
        let evening = Calendar.current.date(byAdding: .hour, value: -6, to: today)!
        let sleep = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis),
                                         predicate: HKQuery.predicateForSamples(withStart: evening, end: now))], sortDescriptors: [])
        let asleep = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue))
        if let samples = try? await sleep.result(for: store).filter({ asleep.contains($0.value) }), !samples.isEmpty {
            out["sleep_hours_last_night"] = Self.mergedSeconds(samples.map { ($0.startDate, $0.endDate) }) / 3600
        }
        if #available(watchOS 11.0, *), let mood = await latestStateOfMind(since: today) { out["state_of_mind"] = mood }
        return out.mapValues { ($0 as? Double).map { ($0 * 100).rounded() / 100 } ?? $0 }
    }

    static func mergedSeconds(_ intervals: [(Date, Date)]) -> Double {
        var total = 0.0
        var current: (Date, Date)?
        for (start, end) in intervals.sorted(by: { $0.0 < $1.0 }) {
            if let open = current, start <= open.1 { current = (open.0, max(open.1, end)); continue }
            if let open = current { total += open.1.timeIntervalSince(open.0) }
            current = (start, end)
        }
        if let open = current { total += open.1.timeIntervalSince(open.0) }
        return total
    }
}

// MARK: State of Mind (watchOS 11+): read today's latest; write only after the user confirms on the watch

@available(watchOS 11.0, *)
extension Sensors {
    static let moodLabels: [String: HKStateOfMind.Label] = [
        "amazed": .amazed, "amused": .amused, "angry": .angry, "annoyed": .annoyed, "anxious": .anxious,
        "ashamed": .ashamed, "brave": .brave, "calm": .calm, "confident": .confident, "content": .content,
        "disappointed": .disappointed, "discouraged": .discouraged, "disgusted": .disgusted, "drained": .drained,
        "embarrassed": .embarrassed, "excited": .excited, "frustrated": .frustrated, "grateful": .grateful,
        "guilty": .guilty, "happy": .happy, "hopeful": .hopeful, "hopeless": .hopeless, "indifferent": .indifferent,
        "irritated": .irritated, "jealous": .jealous, "joyful": .joyful, "lonely": .lonely,
        "overwhelmed": .overwhelmed, "passionate": .passionate, "peaceful": .peaceful, "proud": .proud,
        "relieved": .relieved, "sad": .sad, "satisfied": .satisfied, "scared": .scared, "stressed": .stressed,
        "surprised": .surprised, "worried": .worried,
    ]

    func latestStateOfMind(since start: Date) async -> [String: Any]? {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.stateOfMind(HKQuery.predicateForSamples(withStart: start, end: Date()))],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)], limit: 1)
        guard let sample = try? await descriptor.result(for: store).first else { return nil }
        let names = sample.labels.compactMap { label in Self.moodLabels.first { $0.value == label }?.key }
        return ["valence": sample.valence, "labels": Array(names.prefix(3)),
                "at": ISO8601DateFormatter().string(from: sample.endDate)]
    }

    func saveMood(valence: Double, labels: [String]) async throws {
        let sample = HKStateOfMind(date: Date(), kind: .momentaryEmotion, valence: max(-1, min(1, valence)),
                                   labels: labels.compactMap { Self.moodLabels[$0] }, associations: [])
        try await store.save(sample)
    }
}

extension Sensors: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ builder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        let bpm = builder.statistics(for: HKQuantityType(.heartRate))?.mostRecentQuantity()?
            .doubleValue(for: .count().unitDivided(by: .minute()))
        let kcal = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?
            .doubleValue(for: .kilocalorie())
        Task { @MainActor in
            if let bpm { self.heartRate = bpm }
            if let kcal { self.activeKcal = kcal }
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ builder: HKLiveWorkoutBuilder) {}
}
