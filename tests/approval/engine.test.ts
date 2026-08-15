import { describe, expect, it } from "vitest";
import { classifyAction } from "../../src/approval/engine.js";

describe("classifyAction", () => {
  it("auto-approves all tools in health tracking mode", () => {
    expect(classifyAction({ tool: "shell.exec" }).decision).toBe("auto_approve");
    expect(classifyAction({ tool: "fs.write" }).decision).toBe("auto_approve");
    expect(classifyAction({ tool: "fs.read" }).decision).toBe("auto_approve");
    expect(classifyAction({ tool: "web.search" }).decision).toBe("auto_approve");
  });
});
