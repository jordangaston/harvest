import type { Database } from "../db.js";
import { dbFromEnv } from "../edge-db.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "./auth-service.js";

// Mints the Chef-side magic link: a long-lived weblink JWT wrapped in the public
// app URL, so a known user taps a message and lands signed in on the web.
export class WebLinkTokenService {
  constructor(
    private readonly repo: UserRepository,
    private readonly auth: AuthService,
  ) {}

  /** Wire dependencies. `db` defaults to the env-configured Turso client. */
  static create(db: Database = dbFromEnv()) {
    return new WebLinkTokenService(UserRepository.create(db), AuthService.create());
  }

  /**
   * Builds the signed web-link URL for a known user: `${PUBLIC_APP_URL}/app${path}#t=<jwt>`.
   *
   * @param userId - The user to mint the link for.
   * @param path - The in-app path (e.g. "/"); yields `/app/#t=…` for "/".
   * @returns The full URL with the weblink token in the fragment.
   * @throws If the user is unknown or `PUBLIC_APP_URL` is unset (a link with no origin is unusable).
   */
  async linkFor(userId: string, path: string): Promise<string> {
    const user = await this.repo.findById(userId);
    if (!user) throw new Error(`unknown user ${userId}`);
    const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_APP_URL is unset");
    const { jwt } = this.auth.mintWebLink(user);
    return `${base}/app${path}#t=${jwt}`;
  }
}
