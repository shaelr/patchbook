// Patchbook menu bar app: starts the Patchbook server (Node) when opened, stops it on quit, and puts
// the useful bits in the menu bar: open in the browser, the address for the iPad/phone, start at login.
// Opening the app (or opening it again while it runs) shows Patchbook in the browser, except at login.
// Built by mac/build.sh with plain `swiftc` (no Xcode project).

import AppKit
import Darwin

/// 3000 normally; PATCHBOOK_PORT overrides it (used for testing alongside another server).
let port = Int(ProcessInfo.processInfo.environment["PATCHBOOK_PORT"] ?? "") ?? 3000

// MARK: - Server process

enum ServerState: Equatable {
  case stopped
  case starting
  case running
  /// Another Patchbook server is already answering on the port (e.g. started from Terminal).
  case external
  case failed(String)
}

final class ServerController {
  private(set) var state: ServerState = .stopped {
    didSet { if state != oldValue { DispatchQueue.main.async { self.onChange?() } } }
  }
  var onChange: (() -> Void)?

  let root: URL
  let logURL: URL
  private var process: Process?
  /// A server this app started in an earlier run that's still going (e.g. after a crash or force quit).
  private var adoptedPid: pid_t?
  private var stopping = false
  private var healthTimer: Timer?
  /// Remembers the server's process id so a later run can find (and stop) it.
  private let pidURL: URL

  init(root: URL) {
    self.root = root
    let home = FileManager.default.homeDirectoryForCurrentUser
    let logs = home.appendingPathComponent("Library/Logs")
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    logURL = logs.appendingPathComponent("Patchbook.log")
    // Keep the log small: past 5 MB, start a fresh one and keep the previous as Patchbook.old.log.
    if let size = (try? FileManager.default.attributesOfItem(atPath: logURL.path))?[.size] as? Int, size > 5_000_000 {
      let old = logs.appendingPathComponent("Patchbook.old.log")
      try? FileManager.default.removeItem(at: old)
      try? FileManager.default.moveItem(at: logURL, to: old)
    }
    let support = home.appendingPathComponent("Library/Application Support/Patchbook")
    try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
    pidURL = support.appendingPathComponent("server-\(port).pid")
  }

  /// The pid we recorded last time, if that process is still a Patchbook server.
  private func previousServerPid() -> pid_t? {
    guard let text = try? String(contentsOf: pidURL, encoding: .utf8), let pid = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)),
          kill(pid, 0) == 0 else { return nil }
    let ps = Process()
    ps.executableURL = URL(fileURLWithPath: "/bin/ps")
    ps.arguments = ["-p", String(pid), "-o", "command="]
    let pipe = Pipe()
    ps.standardOutput = pipe
    guard (try? ps.run()) != nil else { return nil }
    ps.waitUntilExit()
    let command = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return command.contains("server/src/index.ts") ? pid : nil
  }

  /// Same rule as the server (server/src/dataDir.ts): the standard per-user app data folder.
  var dataFolder: URL {
    if let custom = ProcessInfo.processInfo.environment["PATCHBOOK_DATA"] { return URL(fileURLWithPath: custom) }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Patchbook")
  }

  /// Node.js: the copy bundled in a release build, else the usual install locations
  /// (the official installer uses /usr/local/bin).
  private func findNode() -> String? {
    var candidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"]
    if let bundled = Bundle.main.resourceURL?.appendingPathComponent("node").path { candidates.insert(bundled, at: 0) }
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
  }

  func start() {
    guard process == nil else { return }
    let entry = root.appendingPathComponent("server/src/index.ts")
    guard FileManager.default.fileExists(atPath: entry.path) else {
      state = .failed("Can't find the Patchbook folder at \(root.path).")
      return
    }
    guard FileManager.default.fileExists(atPath: root.appendingPathComponent("web/dist/index.html").path) else {
      state = .failed("The web app isn't built. Run “npm run mac:app” in the Patchbook folder, or download the app again.")
      return
    }
    guard let node = findNode() else {
      state = .failed("Node.js isn't installed. Install it from nodejs.org.")
      return
    }
    state = .starting
    checkHealth { [weak self] alreadyRunning in
      guard let self else { return }
      if alreadyRunning {
        // Our own server from an earlier run? Take it back over; otherwise someone else's.
        if let pid = self.previousServerPid() {
          self.adoptedPid = pid
          self.state = .running
        } else {
          self.state = .external
        }
        self.startHealthTimer()
        return
      }
      self.launch(node: node, entry: entry)
    }
  }

  private func launch(node: String, entry: URL) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = [entry.path]
    p.currentDirectoryURL = root
    var env = ProcessInfo.processInfo.environment
    env["NODE_ENV"] = "production"
    env["PORT"] = String(port)
    p.environment = env
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    if let log = try? FileHandle(forWritingTo: logURL) {
      log.seekToEndOfFile()
      log.write("\n=== Patchbook started \(Date()) ===\n".data(using: .utf8)!)
      p.standardOutput = log
      p.standardError = log
    }
    p.terminationHandler = { [weak self] proc in
      guard let self else { return }
      DispatchQueue.main.async {
        self.process = nil
        if self.stopping {
          self.state = .stopped
        } else {
          self.state = .failed("The server stopped unexpectedly (code \(proc.terminationStatus)). See the log.")
        }
        self.stopping = false
      }
    }
    do {
      try p.run()
      process = p
      try? String(p.processIdentifier).write(to: pidURL, atomically: true, encoding: .utf8)
      startHealthTimer()
    } catch {
      state = .failed("Couldn't start the server: \(error.localizedDescription)")
    }
  }

  func stop(completion: (() -> Void)? = nil) {
    healthTimer?.invalidate()
    if process == nil, let pid = adoptedPid {
      adoptedPid = nil
      kill(pid, SIGTERM)
      DispatchQueue.global().async {
        let deadline = Date().addingTimeInterval(5)
        while kill(pid, 0) == 0 && Date() < deadline { usleep(100_000) }
        if kill(pid, 0) == 0 { kill(pid, SIGKILL) }
        try? FileManager.default.removeItem(at: self.pidURL)
        DispatchQueue.main.async {
          self.state = .stopped
          completion?()
        }
      }
      return
    }
    guard let p = process, p.isRunning else {
      if state == .external || state == .starting { state = .stopped }
      completion?()
      return
    }
    stopping = true
    p.terminate() // SIGTERM: the server closes the database cleanly
    DispatchQueue.global().async {
      let deadline = Date().addingTimeInterval(5)
      while p.isRunning && Date() < deadline { usleep(100_000) }
      if p.isRunning { kill(p.processIdentifier, SIGKILL) }
      try? FileManager.default.removeItem(at: self.pidURL)
      DispatchQueue.main.async { completion?() }
    }
  }

  private func startHealthTimer() {
    healthTimer?.invalidate()
    healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refresh() }
    refresh()
  }

  private func refresh() {
    checkHealth { [weak self] ok in
      guard let self else { return }
      switch self.state {
      case .starting where ok: self.state = .running
      case .running where !ok && self.process == nil:
        self.adoptedPid = nil
        self.state = .stopped
      case .external where !ok: self.state = .stopped
      default: break
      }
    }
  }

  private func checkHealth(_ done: @escaping (Bool) -> Void) {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/health")!)
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(ok) }
    }.resume()
  }
}

// MARK: - Network addresses (for the iPad / phone)

struct LocalAddress {
  let interface: String
  let ip: String
}

func localIPv4Addresses() -> [LocalAddress] {
  var result: [LocalAddress] = []
  var list: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&list) == 0, let first = list else { return [] }
  defer { freeifaddrs(list) }
  for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
    let entry = pointer.pointee
    guard let addr = entry.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
    let flags = Int32(entry.ifa_flags)
    guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
      let ip = String(cString: host)
      if !ip.hasPrefix("169.254.") { result.append(LocalAddress(interface: String(cString: entry.ifa_name), ip: ip)) }
    }
  }
  return result
}

// MARK: - Start at login (a LaunchAgent that opens the app)

enum LoginItem {
  static let label = "com.patchbook.menubar"
  /// Passed by the login item so the app starts quietly instead of opening the browser.
  static let launchFlag = "--at-login"
  static var plistURL: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist")
  }
  static var isEnabled: Bool { FileManager.default.fileExists(atPath: plistURL.path) }
  static var launchedAtLogin: Bool { CommandLine.arguments.contains(launchFlag) }
  private static var arguments: [String] { ["/usr/bin/open", "-a", Bundle.main.bundlePath, "--args", launchFlag] }

  /// Rewrite a login item made by an older version (or for an app that has moved) to the current arguments.
  static func refresh() {
    guard isEnabled, let data = try? Data(contentsOf: plistURL),
          let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          plist["ProgramArguments"] as? [String] != arguments else { return }
    set(true)
  }

  static func set(_ enabled: Bool) {
    if !enabled {
      try? FileManager.default.removeItem(at: plistURL)
      return
    }
    let plist: [String: Any] = [
      "Label": label,
      "ProgramArguments": arguments,
      "RunAtLoad": true,
    ]
    try? FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0) {
      try? data.write(to: plistURL)
    }
  }
}

// MARK: - Menu bar

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private var statusItem: NSStatusItem!
  private var server: ServerController!
  private let menu = NSMenu()
  /// Set when the user opened the app: show Patchbook in the browser once the server is up,
  /// or say why it couldn't start. A launch at login leaves it unset and stays in the menu bar.
  private var openWhenUp = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    // A release build carries Patchbook inside the app (Resources/patchbook); a local build
    // (npm run mac:app) points at the project folder instead.
    let bundled = Bundle.main.resourceURL?.appendingPathComponent("patchbook")
    let root: URL
    if let bundled, FileManager.default.fileExists(atPath: bundled.appendingPathComponent("server/src/index.ts").path) {
      root = bundled
    } else {
      root = URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "PatchbookRoot") as? String ?? "")
    }
    server = ServerController(root: root)
    server.onChange = { [weak self] in
      self?.updateIcon()
      self?.showIfWaiting()
    }

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    menu.delegate = self
    statusItem.menu = menu
    updateIcon()
    LoginItem.refresh()
    openWhenUp = !LoginItem.launchedAtLogin
    server.start()
    showIfWaiting() // start() can fail straight away (e.g. Node not found)
  }

  // Opened again while running (Finder, Dock, Spotlight): there's no window, so show Patchbook.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    openWhenUp = true
    switch server.state {
    case .stopped, .failed: server.start()
    default: break
    }
    showIfWaiting()
    return false
  }

  /// Once the user has asked to see Patchbook: open it when the server is up, or explain a failure.
  private func showIfWaiting() {
    guard openWhenUp else { return }
    switch server.state {
    case .running, .external:
      openWhenUp = false
      openInBrowser()
    case .failed(let reason):
      openWhenUp = false
      showStartFailure(reason)
    case .stopped, .starting:
      break
    }
  }

  private func showStartFailure(_ reason: String) {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "Patchbook couldn't start"
    alert.informativeText = reason
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Show Log")
    NSApp.activate(ignoringOtherApps: true) // a menu bar app isn't frontmost; bring the alert forward
    if alert.runModal() == .alertSecondButtonReturn { showLog() }
  }

  // Quitting (menu, Apple Event, logout): stop the server first, then let the app exit.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    server.stop { NSApp.reply(toApplicationShouldTerminate: true) }
    return .terminateLater
  }

  private func updateIcon() {
    guard let button = statusItem.button else { return }
    let image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "Patchbook")
    image?.isTemplate = true
    button.image = image
    switch server.state {
    case .running, .external: button.appearsDisabled = false
    default: button.appearsDisabled = true
    }
    button.toolTip = statusText
  }

  private var statusText: String {
    switch server.state {
    case .stopped: return "Patchbook is stopped"
    case .starting: return "Patchbook is starting…"
    case .running: return "Patchbook is running"
    case .external: return "Patchbook is running (started elsewhere)"
    case .failed(let reason): return "Patchbook couldn't start: \(reason)"
    }
  }

  private var isUp: Bool { server.state == .running || server.state == .external }

  // Rebuilt every time it opens, so the state and addresses are current.
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()

    let status = NSMenuItem(title: (isUp ? "● " : "○ ") + statusText, action: nil, keyEquivalent: "")
    status.isEnabled = false
    menu.addItem(status)

    let open = NSMenuItem(title: "Open Patchbook", action: #selector(openInBrowser), keyEquivalent: "o")
    open.target = self
    open.isEnabled = isUp
    menu.addItem(open)

    let addresses = localIPv4Addresses()
    let devices = NSMenuItem(title: "iPad / Phone Address", action: nil, keyEquivalent: "")
    let submenu = NSMenu()
    if addresses.isEmpty {
      let none = NSMenuItem(title: "Not connected to a network", action: nil, keyEquivalent: "")
      none.isEnabled = false
      submenu.addItem(none)
    } else {
      let hint = NSMenuItem(title: "Click to copy:", action: nil, keyEquivalent: "")
      hint.isEnabled = false
      submenu.addItem(hint)
      for address in addresses {
        let item = NSMenuItem(title: "http://\(address.ip):\(port)   (\(address.interface))", action: #selector(copyAddress(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = "http://\(address.ip):\(port)"
        submenu.addItem(item)
      }
    }
    devices.submenu = submenu
    devices.isEnabled = isUp
    menu.addItem(devices)

    menu.addItem(.separator())

    let toggle: NSMenuItem
    switch server.state {
    case .running, .starting:
      toggle = NSMenuItem(title: "Stop Server", action: #selector(stopServer), keyEquivalent: "")
    case .external:
      toggle = NSMenuItem(title: "Running from elsewhere", action: nil, keyEquivalent: "")
      toggle.isEnabled = false
    default:
      toggle = NSMenuItem(title: "Start Server", action: #selector(startServer), keyEquivalent: "")
    }
    toggle.target = self
    menu.addItem(toggle)

    let login = NSMenuItem(title: "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")
    login.target = self
    login.state = LoginItem.isEnabled ? .on : .off
    menu.addItem(login)

    let data = NSMenuItem(title: "Show Data Folder", action: #selector(showData), keyEquivalent: "")
    data.target = self
    menu.addItem(data)

    let log = NSMenuItem(title: "Show Log", action: #selector(showLog), keyEquivalent: "")
    log.target = self
    menu.addItem(log)

    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit Patchbook", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
  }

  @objc private func openInBrowser() {
    NSWorkspace.shared.open(URL(string: "http://localhost:\(port)")!)
  }

  @objc private func copyAddress(_ sender: NSMenuItem) {
    guard let text = sender.representedObject as? String else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  @objc private func startServer() { server.start() }
  @objc private func stopServer() { server.stop() }

  @objc private func toggleLogin() { LoginItem.set(!LoginItem.isEnabled) }

  @objc private func showData() {
    try? FileManager.default.createDirectory(at: server.dataFolder, withIntermediateDirectories: true)
    NSWorkspace.shared.open(server.dataFolder)
  }

  @objc private func showLog() {
    if !FileManager.default.fileExists(atPath: server.logURL.path) { FileManager.default.createFile(atPath: server.logURL.path, contents: nil) }
    NSWorkspace.shared.open(server.logURL)
  }

  @objc private func quit() {
    NSApp.terminate(nil) // stops the server in applicationShouldTerminate
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
app.run()
