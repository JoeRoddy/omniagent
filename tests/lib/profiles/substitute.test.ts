import { substituteVariables } from "../../../src/lib/profiles/substitute.js";

describe("substituteVariables", () => {
	it("leaves content unchanged when there are no placeholders", () => {
		const result = substituteVariables("plain content", { FOO: "bar" });
		expect(result.content).toBe("plain content");
		expect(result.unresolved).toEqual([]);
	});

	it("substitutes a simple placeholder", () => {
		const result = substituteVariables("Hello {{NAME}}!", { NAME: "World" });
		expect(result.content).toBe("Hello World!");
		expect(result.unresolved).toEqual([]);
	});

	it("tolerates whitespace around the name", () => {
		const result = substituteVariables("{{ NAME }}", { NAME: "World" });
		expect(result.content).toBe("World");
	});

	it("supports multiple placeholders with repeats", () => {
		const result = substituteVariables("{{A}}-{{B}}-{{A}}", { A: "1", B: "2" });
		expect(result.content).toBe("1-2-1");
	});

	it("substitutes empty-string values correctly (doesn't fall through to default)", () => {
		const result = substituteVariables("{{FOO=fallback}}", { FOO: "" });
		expect(result.content).toBe("");
		expect(result.unresolved).toEqual([]);
	});

	it("uses default when the variable is unset", () => {
		const result = substituteVariables("{{FOO=datadog}}", {});
		expect(result.content).toBe("datadog");
		expect(result.unresolved).toEqual([]);
	});

	it("allows spaces inside the default value", () => {
		const result = substituteVariables("{{GREETING=hello world}}", {});
		expect(result.content).toBe("hello world");
	});

	it("reports unresolved bare placeholders once per name", () => {
		const result = substituteVariables("{{MISSING}}-{{MISSING}}", {});
		expect(result.content).toBe("{{MISSING}}-{{MISSING}}");
		expect(result.unresolved).toEqual([{ name: "MISSING" }]);
	});

	it("does not match lowercase names", () => {
		const result = substituteVariables("{{foo}}", { foo: "bar" });
		expect(result.content).toBe("{{foo}}");
		expect(result.unresolved).toEqual([]);
	});

	it("handles null variables argument", () => {
		const result = substituteVariables("{{FOO=fallback}}", null);
		expect(result.content).toBe("fallback");
	});
});
