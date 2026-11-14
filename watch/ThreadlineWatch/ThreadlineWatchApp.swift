import SwiftUI

@main
struct ThreadlineWatchApp: App {
    @StateObject private var recorder = Recorder()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                PairView()
            }
            .environmentObject(recorder)
        }
    }
}
