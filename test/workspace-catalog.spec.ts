import { describe, expect, it } from "vitest";
import {
  normalizeAssignedWorkspaceCodes,
  resolveCommunityWorkspaceCodes,
} from "../src/auth/workspace-catalog";

describe("catálogo de espacios asignados", () => {
  it("lee espacios vigentes sin depender del rol, normaliza legados y elimina duplicados", () => {
    expect(
      normalizeAssignedWorkspaceCodes([
        { workspaceCode: "ADMINISTRATION" },
        { workspaceCode: "treasury" },
        { workspaceCode: "ACCOUNTING" },
        { workspaceCode: "PURCHASES" },
        { workspaceCode: "UNKNOWN" },
      ]),
    ).toEqual(["ADMINISTRATION", "ACCOUNTING", "PURCHASES"]);
  });

  it("reconoce acceso integral por capacidad y expone todos los espacios", () => {
    expect(
      resolveCommunityWorkspaceCodes(
        [{ workspaceCode: "ADMINISTRATION" }],
        ["community.full_access"],
      ),
    ).toEqual([
      "ADMINISTRATION",
      "ACCOUNTING",
      "PURCHASES",
      "OWNER_SERVICE",
      "COLLECTIONS",
      "CONTROL_PRINCIPAL",
      "WRISTBANDS",
      "BOARD",
    ]);
  });
});
