import type { HookContext, HookHandler, SyncHooks } from "./config-types.js";

export async function runHook(hook: HookHandler | undefined, context: HookContext): Promise<void> {
	if (!hook) {
		return;
	}
	await hook(context);
}

export async function runSyncHook(
	hooks: SyncHooks | undefined,
	stage: "preSync" | "postSync",
	context: HookContext,
): Promise<void> {
	if (!hooks) {
		return;
	}
	await runHook(hooks[stage], context);
}

export async function runConvertHook(
	hooks: SyncHooks | undefined,
	stage: "preConvert" | "postConvert",
	context: HookContext,
): Promise<void> {
	if (!hooks) {
		return;
	}
	await runHook(hooks[stage], context);
}
