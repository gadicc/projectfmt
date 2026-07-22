/** @type {import("semantic-release").GlobalConfig} */
export default {
  branches: [
    "+([0-9])?(.{+([0-9]),x}).x",
    "main",
    "next",
    "next-major",
    { name: "beta", prerelease: true },
    { name: "alpha", prerelease: true },
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/npm", { pkgRoot: "npm" }],
    "./scripts/semantic-release-jsr.mjs",
    "@semantic-release/github",
  ],
  preset: "conventionalcommits",
  repositoryUrl: "https://github.com/gadicc/projectfmt",
};
