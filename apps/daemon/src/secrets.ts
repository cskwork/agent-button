import { AbtnError, makeRedactor } from "@abtn/core";
import { runProcess } from "@abtn/process-runner";

/**
 * Secret broker: resolves `secret://keychain/<service>/<account>` and
 * `secret://env/<NAME>` references. Resolved values are injected only at the
 * integration boundary (Jenkins auth header, step env) and registered for
 * redaction — they never enter prompts, transcripts, or SQLite (spec §10).
 */
export class SecretBroker {
  private resolved = new Map<string, string>();

  async resolve(ref: string): Promise<string> {
    const cached = this.resolved.get(ref);
    if (cached !== undefined) return cached;

    const match = /^secret:\/\/(keychain|env)\/(.+)$/.exec(ref);
    if (!match) throw new AbtnError("VALIDATION_FAILED", `Invalid secret reference: ${ref}`);
    const [, backend, rest] = match;

    let value: string;
    if (backend === "env") {
      const fromEnv = process.env[rest!];
      if (!fromEnv) throw new AbtnError("AUTH_REQUIRED", `Environment secret not set: ${rest}`);
      value = fromEnv;
    } else {
      value = await this.fromKeychain(rest!);
    }

    this.resolved.set(ref, value);
    return value;
  }

  private async fromKeychain(path: string): Promise<string> {
    const [service, ...accountParts] = path.split("/");
    const account = accountParts.join("/");
    const args = ["find-generic-password", "-s", service!, "-w"];
    if (account) args.splice(3, 0, "-a", account);

    const result = await runProcess({
      executable: "/usr/bin/security",
      args,
      minimalEnv: false,
      timeoutMs: 15000,
    });
    if (result.exitCode !== 0) {
      throw new AbtnError("AUTH_REQUIRED", `Keychain item not found: ${path}`, {
        hint: `security add-generic-password -s ${service} ${account ? `-a ${account} ` : ""}-w <token>`,
      });
    }
    return result.stdout.trim();
  }

  /** Redactor covering every secret resolved so far in this daemon lifetime. */
  redactor(): (text: string) => string {
    const named = new Map<string, string>();
    for (const [ref, value] of this.resolved) {
      named.set(ref.replace("secret://", ""), value);
    }
    return makeRedactor(named);
  }
}
