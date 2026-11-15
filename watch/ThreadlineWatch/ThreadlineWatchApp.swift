import SwiftUI

@main
struct ThreadlineWatchApp: App {
    @StateObject private var session = StreamSession()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                DeviceCodeView()
            }
            .environmentObject(session)
        }
    }
}


/// Default Threadline server. Set the THREADLINE_SERVER build setting (e.g. a Mac's LAN address
/// for local testing); otherwise the deployed site is used. Users can still change it on the watch.
enum AppConfig {
    static let defaultServer: String = {
        let configured = (Bundle.main.object(forInfoDictionaryKey: "ThreadlineDefaultServer") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return configured.isEmpty || configured.contains("$(") ? "https://threadline.ayushojha.com" : configured
    }()
}
