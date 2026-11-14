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
        let read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]
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
