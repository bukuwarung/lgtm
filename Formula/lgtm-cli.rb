# The browser version: `lgtm` serves the review app on port 4517 and opens it.
class LgtmCli < Formula
  desc "Fast GitHub pull request review in your browser"
  homepage "https://github.com/bukuwarung/lgtm"
  url "https://github.com/bukuwarung/lgtm/releases/download/v0.4.0/lgtm-cli-0.4.0.tar.gz"
  sha256 "7d394010ec3adcde1026909618b534db2bf5af3fa097673349971d82461f12b9"
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
