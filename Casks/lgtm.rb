cask "lgtm" do
  version "0.13.1"
  sha256 "a84420b58a356ae37e4ad188b0680ae7926bfa9dd96641d8d98157779c7c381d"

  url "https://github.com/bukuwarung/lgtm/releases/download/v#{version}/lgtm-#{version}.zip"
  name "lgtm"
  desc "Review GitHub pull requests and GitLab merge requests"
  homepage "https://github.com/bukuwarung/lgtm"

  depends_on formula: "gh"
  depends_on macos: :ventura

  app "lgtm.app"
  binary "#{appdir}/lgtm.app/Contents/Resources/bin/lgtm" # `lgtm [PR link]` opens the app

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
