/**
 * Collab storage barrel (task 062) — re-exports the shared dual-form storage +
 * identity module from collab-core so existing page importers of "./storage"
 * (config-screen, landing-screen, use-collab-session, invite, config-banner)
 * are unchanged.
 */
export {
  COLLAB_PROFILE_ID_KEY,
  COLLAB_SERVER_CONFIG,
  isCollabIdentity,
  isLoopbackRelay,
  isServerConfig,
  maskKey,
  mintMemberKeypair,
  parseStoredConfig,
  readServerConfig,
  resolveIdentity,
  storageGet,
  storageSet,
  updateDisplayName,
  writeServerConfig,
} from "collab-core";
export type { CollabIdentity, ServerConfig } from "collab-core";
