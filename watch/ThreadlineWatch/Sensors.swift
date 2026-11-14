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
        let read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned), Self.flowType]
        do {
            try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: read)
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
