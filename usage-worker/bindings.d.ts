// Owner-provisioned native binding, absent from the non-deployable placeholder.
// Keep generated runtime types separate; absence is checked before any D1 write.
interface Env {
  USAGE_LIMITER?: RateLimit;
}
