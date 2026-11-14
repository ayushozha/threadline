import SwiftUI

@main
struct ThreadlineWatchApp: App {
    @StateObject private var session = StreamSession()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                PairView()
            }
            .environmentObject(session)
        }
    }
}
