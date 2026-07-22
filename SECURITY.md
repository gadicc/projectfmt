# Security

Please report vulnerabilities privately through GitHub's security advisory
workflow for `gadicc/projectfmt` once the repository exists.

`projectfmt` intentionally loads or executes formatter code selected by the
destination project. Prettier JavaScript configuration and plugins can execute
code, and the Biome/Deno adapters run local executables. Do not use it on an
untrusted checkout. See the README's security and trust model for details.
