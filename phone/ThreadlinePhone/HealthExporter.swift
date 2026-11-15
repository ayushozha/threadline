import Foundation
import HealthKit

/// One per-day aggregate, matching the server's health_daily rows and the metric names that
/// app/health_import.py produces for the XML export.
struct DailyRow: Encodable {
    let date: String
    let metric: String
    let value: Double?
    let count: Int
    let min: Double?
    let max: Double?
}

private func round3(_ value: Double) -> Double { (value * 1000).rounded() / 1000 }

final class HealthExporter {
    static let days = 365
    private let store = HKHealthStore()
    private let calendar = Calendar.current
    private let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private enum Kind { case sum, avg }

    private struct QuantitySpec {
        let id: HKQuantityTypeIdentifier
        let metric: String
        let kind: Kind
        let unit: HKUnit
        var scale: Double = 1
    }

    private static let perMinute = HKUnit.count().unitDivided(by: .minute())

    // Same identifiers and units as QUANTITY + convert() in app/health_import.py (percents as 0-100).
    private let quantities: [QuantitySpec] = [
        QuantitySpec(id: .stepCount, metric: "steps", kind: .sum, unit: .count()),
        QuantitySpec(id: .distanceWalkingRunning, metric: "distance_km", kind: .sum, unit: .meterUnit(with: .kilo)),
        QuantitySpec(id: .activeEnergyBurned, metric: "active_energy_kcal", kind: .sum, unit: .kilocalorie()),
        QuantitySpec(id: .appleExerciseTime, metric: "exercise_min", kind: .sum, unit: .minute()),
        QuantitySpec(id: .flightsClimbed, metric: "flights_climbed", kind: .sum, unit: .count()),
        QuantitySpec(id: .appleStandTime, metric: "stand_min", kind: .sum, unit: .minute()),
        QuantitySpec(id: .heartRate, metric: "heart_rate", kind: .avg, unit: perMinute),
        QuantitySpec(id: .restingHeartRate, metric: "resting_heart_rate", kind: .avg, unit: perMinute),
        QuantitySpec(id: .heartRateVariabilitySDNN, metric: "hrv_sdnn", kind: .avg, unit: .secondUnit(with: .milli)),
        QuantitySpec(id: .respiratoryRate, metric: "respiratory_rate", kind: .avg, unit: perMinute),
        QuantitySpec(id: .oxygenSaturation, metric: "oxygen_saturation", kind: .avg, unit: .percent(), scale: 100),
        QuantitySpec(id: .walkingSpeed, metric: "walking_speed_kmh", kind: .avg, unit: HKUnit(from: "km/hr")),
        QuantitySpec(id: .appleWalkingSteadiness, metric: "walking_steadiness", kind: .avg, unit: .percent(), scale: 100),
        QuantitySpec(id: .appleSleepingWristTemperature, metric: "wrist_temp_c", kind: .avg, unit: .degreeCelsius()),
        QuantitySpec(id: .environmentalAudioExposure, metric: "audio_exposure_db", kind: .avg,
                     unit: .decibelAWeightedSoundPressureLevel()),
    ]

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>(quantities.compactMap { HKObjectType.quantityType(forIdentifier: $0.id) })
        for id: HKCategoryTypeIdentifier in [.sleepAnalysis, .mindfulSession, .menstrualFlow] {
            if let t = HKObjectType.categoryType(forIdentifier: id) { types.insert(t) }
        }
        types.insert(HKObjectType.workoutType())
        types.insert(HKObjectType.activitySummaryType())
        if #available(iOS 18.0, *) { types.insert(HKObjectType.stateOfMindType()) }
        return types
    }

    func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw UploadError.message("Health data is not available on this device.")
        }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    private var startDay: Date {
        calendar.date(byAdding: .day, value: -(Self.days - 1), to: calendar.startOfDay(for: Date()))!
    }

    private func key(_ date: Date) -> String { dayFormatter.string(from: date) }

    func collect(progress: @escaping (String) -> Void) async throws -> [DailyRow] {
        var rows: [DailyRow] = []
        let start = startDay
        let cutoff = key(start)
        for (i, spec) in quantities.enumerated() {
            progress("Reading \(spec.metric) (\(i + 1)/\(quantities.count))…")
            rows += await quantityRows(spec, start: start)
        }
        progress("Reading sleep…")
        rows += await sleepRows(start: start, cutoff: cutoff)
        progress("Reading mindful minutes…")
        rows += await mindfulRows(start: start)
        progress("Reading workouts…")
        rows += await workoutRows(start: start)
        progress("Reading activity rings…")
        rows += await standHourRows(start: start)
        progress("Reading periods…")
        rows += await flowRows(start: start)
        if #available(iOS 18.0, *) {
            progress("Reading state of mind…")
            rows += await moodRows(start: start)
        }
        return rows.filter { $0.date >= cutoff }
    }

    // MARK: quantities (HKStatisticsCollection, daily buckets anchored at local midnight)

    private func quantityRows(_ spec: QuantitySpec, start: Date) async -> [DailyRow] {
        guard let type = HKObjectType.quantityType(forIdentifier: spec.id) else { return [] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil)
        let options: HKStatisticsOptions = spec.kind == .sum ? .cumulativeSum
            : [.discreteAverage, .discreteMin, .discreteMax]
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate),
            options: options, anchorDate: start, intervalComponents: DateComponents(day: 1))
        guard let collection = try? await descriptor.result(for: store) else { return [] }
        var out: [DailyRow] = []
        collection.enumerateStatistics(from: start, to: Date()) { stats, _ in
            let day = self.key(stats.startDate)
            if spec.kind == .sum {
                guard let q = stats.sumQuantity() else { return }
                out.append(DailyRow(date: day, metric: spec.metric, value: round3(q.doubleValue(for: spec.unit) * spec.scale),
                                    count: 1, min: nil, max: nil))
            } else {
                guard let q = stats.averageQuantity() else { return }
                let lo = stats.minimumQuantity().map { round3($0.doubleValue(for: spec.unit) * spec.scale) }
                let hi = stats.maximumQuantity().map { round3($0.doubleValue(for: spec.unit) * spec.scale) }
                out.append(DailyRow(date: day, metric: spec.metric, value: round3(q.doubleValue(for: spec.unit) * spec.scale),
                                    count: 1, min: lo, max: hi))
            }
        }
        return out
    }

    // MARK: samples

    private func categorySamples(_ id: HKCategoryTypeIdentifier, start: Date) async -> [HKCategorySample] {
        guard let type = HKObjectType.categoryType(forIdentifier: id) else { return [] }
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        return (try? await descriptor.result(for: store)) ?? []
    }

    /// Asleep stages per night, overlaps merged, attributed to the local day the segment ends (like the XML import).
    private func sleepRows(start: Date, cutoff: String) async -> [DailyRow] {
        let asleep = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue))
        let lookback = calendar.date(byAdding: .day, value: -1, to: start)!
        var spans: [String: [(Double, Double)]] = [:]
        for s in await categorySamples(.sleepAnalysis, start: lookback) where asleep.contains(s.value) {
            guard s.endDate > s.startDate else { continue }
            spans[key(s.endDate), default: []].append((s.startDate.timeIntervalSince1970, s.endDate.timeIntervalSince1970))
        }
        return spans.compactMap { day, list in
            guard day >= cutoff else { return nil }
            let sorted = list.sorted { $0.0 < $1.0 }
            var seconds = 0.0
            var current: (Double, Double)?
            for (s, e) in sorted {
                if let cur = current, s <= cur.1 {
                    current = (cur.0, Swift.max(cur.1, e))
                } else {
                    if let cur = current { seconds += cur.1 - cur.0 }
                    current = (s, e)
                }
            }
            if let cur = current { seconds += cur.1 - cur.0 }
            return DailyRow(date: day, metric: "sleep_hours", value: round3(seconds / 3600), count: list.count, min: nil, max: nil)
        }
    }

    private func mindfulRows(start: Date) async -> [DailyRow] {
        var minutes: [String: (Double, Int)] = [:]
        for s in await categorySamples(.mindfulSession, start: start) where s.endDate > s.startDate {
            let cur = minutes[key(s.startDate)] ?? (0, 0)
            minutes[key(s.startDate)] = (cur.0 + s.endDate.timeIntervalSince(s.startDate) / 60, cur.1 + 1)
        }
        return minutes.map { DailyRow(date: $0.key, metric: "mindful_min", value: round3($0.value.0), count: $0.value.1,
                                      min: nil, max: nil) }
    }

    private func flowRows(start: Date) async -> [DailyRow] {
        let none = HKCategoryValueMenstrualFlow.none.rawValue
        let days = Set(await categorySamples(.menstrualFlow, start: start).filter { $0.value != none }.map { key($0.startDate) })
        return days.map { DailyRow(date: $0, metric: "menstrual_flow", value: 1, count: 1, min: nil, max: nil) }
    }

    /// "workouts" = total minutes with count = number of workouts; "workout:<Type>" per activity type.
    private func workoutRows(start: Date) async -> [DailyRow] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        let workouts = (try? await descriptor.result(for: store)) ?? []
        var totals: [String: (Double, Int, Double, Double)] = [:]  // key "day|metric" -> (sum, count, min, max)
        for w in workouts {
            let day = key(w.startDate)
            let minutes = w.duration / 60
            for metric in ["workouts", "workout:\(Self.name(of: w.workoutActivityType))"] {
                let k = "\(day)|\(metric)"
                let cur = totals[k] ?? (0, 0, minutes, minutes)
                totals[k] = (cur.0 + minutes, cur.1 + 1, Swift.min(cur.2, minutes), Swift.max(cur.3, minutes))
            }
        }
        return totals.map { k, v in
            let parts = k.split(separator: "|", maxSplits: 1).map(String.init)
            return DailyRow(date: parts[0], metric: parts[1], value: round3(v.0), count: v.1, min: round3(v.2), max: round3(v.3))
        }
    }

    private func standHourRows(start: Date) async -> [DailyRow] {
        var startComponents = calendar.dateComponents([.year, .month, .day, .era], from: start)
        var endComponents = calendar.dateComponents([.year, .month, .day, .era], from: Date())
        startComponents.calendar = calendar
        endComponents.calendar = calendar
        let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: startComponents, end: endComponents)
        let summaries: [HKActivitySummary] = await withCheckedContinuation { cont in
            let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, _ in
                cont.resume(returning: summaries ?? [])
            }
            store.execute(query)
        }
        return summaries.compactMap { s in
            var comps = s.dateComponents(for: calendar)
            comps.calendar = calendar
            guard let date = comps.date else { return nil }
            let hours = s.appleStandHours.doubleValue(for: .count())
            guard hours > 0 else { return nil }
            return DailyRow(date: key(date), metric: "stand_hours", value: hours, count: 1, min: hours, max: hours)
        }
    }

    @available(iOS 18.0, *)
    private func moodRows(start: Date) async -> [DailyRow] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.stateOfMind(HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        let samples = (try? await descriptor.result(for: store)) ?? []
        var byDay: [String: [Double]] = [:]
        for s in samples { byDay[key(s.startDate), default: []].append(s.valence) }
        return byDay.map { day, vals in
            DailyRow(date: day, metric: "mood", value: round3(vals.reduce(0, +) / Double(vals.count)), count: vals.count,
                     min: vals.min(), max: vals.max())
        }
    }

    /// HKWorkoutActivityType case name without the prefix, as in the export's workoutActivityType attribute.
    static func name(of type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "Running"
        case .walking: return "Walking"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .barre: return "Barre"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .stairClimbing: return "StairClimbing"
        case .stairs: return "Stairs"
        case .traditionalStrengthTraining: return "TraditionalStrengthTraining"
        case .functionalStrengthTraining: return "FunctionalStrengthTraining"
        case .highIntensityIntervalTraining: return "HighIntensityIntervalTraining"
        case .coreTraining: return "CoreTraining"
        case .flexibility: return "Flexibility"
        case .mixedCardio: return "MixedCardio"
        case .cardioDance: return "CardioDance"
        case .socialDance: return "SocialDance"
        case .mindAndBody: return "MindAndBody"
        case .cooldown: return "Cooldown"
        case .preparationAndRecovery: return "PreparationAndRecovery"
        case .jumpRope: return "JumpRope"
        case .kickboxing: return "Kickboxing"
        case .boxing: return "Boxing"
        case .martialArts: return "MartialArts"
        case .climbing: return "Climbing"
        case .tennis: return "Tennis"
        case .tableTennis: return "TableTennis"
        case .badminton: return "Badminton"
        case .pickleball: return "Pickleball"
        case .soccer: return "Soccer"
        case .basketball: return "Basketball"
        case .americanFootball: return "AmericanFootball"
        case .cricket: return "Cricket"
        case .volleyball: return "Volleyball"
        case .golf: return "Golf"
        case .skatingSports: return "SkatingSports"
        case .snowboarding: return "Snowboarding"
        case .downhillSkiing: return "DownhillSkiing"
        case .crossCountrySkiing: return "CrossCountrySkiing"
        case .surfingSports: return "SurfingSports"
        case .paddleSports: return "PaddleSports"
        case .waterFitness: return "WaterFitness"
        case .handCycling: return "HandCycling"
        case .wheelchairWalkPace: return "WheelchairWalkPace"
        case .wheelchairRunPace: return "WheelchairRunPace"
        case .play: return "Play"
        default: return "Other"
        }
    }
}
