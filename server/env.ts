try {
  process.loadEnvFile?.();
} catch {
  // `.env` is optional in local development.
}
