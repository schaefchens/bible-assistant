import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        observeAudioSession()
        return true
    }

    /// Interruptions (calls, Siri, another app taking the session) and route
    /// changes (headphones unplugged).
    ///
    /// The *pausing* side needs nothing here: iOS pauses the WebView's media
    /// element and the element fires `pause`, which the web layer listens for
    /// (see elementTrackPlayer.ts / audioPlaybackManager's onExternalPause).
    /// That is the part Web Audio could never report.
    ///
    /// What does need native help is the session itself: after an interruption
    /// ends the session can be left deactivated, and a later play() then fails
    /// silently with no error the web layer can see. Reactivating here is what
    /// makes "resume after a phone call" work at all.
    private func observeAudioSession() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { notification in
            guard
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: raw)
            else { return }

            if type == .ended {
                // Deliberately NOT auto-resuming playback, even when
                // .shouldResume is set: this is spoken scripture, and audio
                // restarting by itself after a call is startling. The
                // lock-screen and in-app play buttons both work, so resuming
                // stays the user's call.
                try? AVAudioSession.sharedInstance().setActive(true)
            }
        }
    }

    /// Put the app in the `.playback` audio category so reading continues with
    /// the screen locked or another app in front. `UIBackgroundModes: audio` in
    /// Info.plist only takes effect while an audio session is active and
    /// actually playing.
    ///
    /// `.spokenAudio` is the mode Apple documents for prose and audiobooks — it
    /// makes the system treat this as speech rather than music, which is what
    /// gives sane behaviour when another app interrupts.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
        } catch {
            // Non-fatal: without this the app simply behaves as it did before
            // (foreground-only audio), so don't take the launch down with it.
            CAPLog.print("Audio session setup failed: \(error.localizedDescription)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
