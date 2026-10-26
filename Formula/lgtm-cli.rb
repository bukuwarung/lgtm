# The browser version: `lgtm` serves the review app on port 4517 and opens it.
class LgtmCli < Formula
  desc "Fast GitHub pull request review in your browser"
  homepage "https://github.com/bukuwarung/lgtm"
  url "https://github.com/bukuwarung/lgtm/releases/download/v0.1.0/lgtm-cli-0.1.0.tar.gz"
  sha256 "adaa71e49002bf8159f9fbceddd922604e251dc3f1200a5998c6a9392af10249"
  license "MIT"

  depends_on "gh"
  depends_on "node"

  def install
    libexec.install "bin", "dist", "package.json"
    (bin/"lgtm").write_env_script libexec/"bin/lgtm.mjs", PATH: "#{formula_opt_bin("node")}:$PATH"
  end

  test do
    assert_path_exists libexec/"dist/index.html"
  end
end
