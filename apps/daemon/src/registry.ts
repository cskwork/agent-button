import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AbtnError, ButtonDefinitionSchema, type ButtonDefinition } from "@abtn/core";

export interface ButtonLoadError {
  file: string;
  message: string;
}

/**
 * Buttons live as versioned YAML files in <home>/buttons — human-editable,
 * git-friendly, importable/exportable by copying files.
 */
export class ButtonRegistry {
  private readonly dir: string;
  private buttons = new Map<string, ButtonDefinition>();
  private errors: ButtonLoadError[] = [];

  constructor(home: string) {
    this.dir = join(home, "buttons");
    mkdirSync(this.dir, { recursive: true });
  }

  get buttonsDir(): string {
    return this.dir;
  }

  load(): void {
    this.buttons = new Map();
    this.errors = [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files.sort()) {
      try {
        const raw = parseYaml(readFileSync(join(this.dir, file), "utf8"));
        const parsed = ButtonDefinitionSchema.safeParse(raw);
        if (!parsed.success) {
          this.errors.push({ file, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
          continue;
        }
        if (this.buttons.has(parsed.data.id)) {
          this.errors.push({ file, message: `Duplicate button id: ${parsed.data.id}` });
          continue;
        }
        this.buttons.set(parsed.data.id, parsed.data);
      } catch (err) {
        this.errors.push({ file, message: String(err) });
      }
    }
  }

  list(): ButtonDefinition[] {
    return [...this.buttons.values()];
  }

  loadErrors(): ButtonLoadError[] {
    return this.errors;
  }

  get(id: string): ButtonDefinition {
    const button = this.buttons.get(id);
    if (!button) throw new AbtnError("NOT_FOUND", `Button not found: ${id}`);
    return button;
  }

  /** Raw YAML file contents (advanced editing in clients). */
  raw(id: string): string {
    this.get(id);
    return readFileSync(join(this.dir, `${id}.yaml`), "utf8");
  }

  save(definition: unknown): ButtonDefinition {
    const parsed = ButtonDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      throw new AbtnError("VALIDATION_FAILED", "Invalid button definition", parsed.error.issues);
    }
    writeFileSync(join(this.dir, `${parsed.data.id}.yaml`), stringifyYaml(parsed.data));
    this.load();
    return parsed.data;
  }

  delete(id: string): void {
    this.get(id);
    const file = join(this.dir, `${id}.yaml`);
    if (existsSync(file)) unlinkSync(file);
    this.load();
  }
}
