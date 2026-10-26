cask "lgtm" do
  version "0.1.0"
  sha256 "9d80a6eb563c7ebcad16a3c2dc167fed502e4a29e4fbc75302403dab4da39eef"

  url "https://github.com/bukuwarung/lgtm/releases/download/v#{version}/lgtm-#{version}.zip"
  name "lgtm"
  desc "Fast GitHub pull request review"
  homepage "https://github.com/bukuwarung/lgtm"

  depends_on formula: "gh"
  depends_on macos: :ventura

  app "lgtm.app"

  # Not notarized (no Apple Developer account): without this, macOS blocks the app until "Open Anyway" in
  # System Settings → Privacy & Security.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/lgtm.app"]
  end

  zap trash: [
    "~/.config/lgtm",
    "~/Library/Caches/com.bukuwarung.lgtm",
    "~/Library/Preferences/com.bukuwarung.lgtm.plist",
    "~/Library/WebKit/com.bukuwarung.lgtm",
  ]

  caveats <<~EOS
    lgtm signs in with the GitHub CLI: run `gh auth login` first.
    Optional: slackcli (Slack messages) and acli (Jira tickets), see
      https://github.com/bukuwarung/lgtm#install
  EOS
end
