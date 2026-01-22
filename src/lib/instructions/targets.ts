export type InstructionTargetName = string;
export type InstructionTargetGroup = string;

export function resolveInstructionTargetGroup(
	targetName: InstructionTargetName,
	group?: string | null,
): InstructionTargetGroup {
	return group && group.trim().length > 0 ? group : targetName;
}
