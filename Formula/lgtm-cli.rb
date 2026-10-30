# The browser version: `lgtm` serves the review app on port 4517 and opens it.
class LgtmCli < Formula
  desc "Fast GitHub pull request review in your browser"
  homepage "https://github.com/bukuwarung/lgtm"
  url "https://github.com/bukuwarung/lgtm/releases/download/v0.4.1/lgtm-cli-0.4.1.tar.gz"
  sha256 "6de8c3ffd10b931f8efc0c380a8103f58860a8932cf0a6d33dc8bafe9a1c3ab2"
  license "MIT"

  depends_on "gh"
  depends_on "node"

  def install
    libexec.install Dir["*"] # bin, dist, package.json, claude-skill.md
    (bin/"lgtm").write_env_script libexec/"bin/lgtm.mjs", PATH: "#{formula_opt_bin("node")}:$PATH"
  end

  test do
    assert_path_exists libexec/"dist/index.html"
  end
end
