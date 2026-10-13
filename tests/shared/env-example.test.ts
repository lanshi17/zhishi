import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/shared/schema.js";

function readEnvironmentNames(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=", 1)[0]);
}

describe(".env.example", () => {
  it("contains exactly the supported environment fields", () => {
    const templatePath = resolve(process.cwd(), ".env.example");
    const templateNames = readEnvironmentNames(templatePath).sort();
    const schemaNames = Object.keys(envSchema.shape).sort();

    expect(templateNames).toEqual(schemaNames);
  });
});
