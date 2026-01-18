export type LocalPrecedenceResult<T> = {
	local: T[];
	localEffective: T[];
	sharedEffective: T[];
	localEffectiveKeys: Set<string>;
};

export function resolveLocalPrecedence<T>(options: {
	shared: T[];
	localPath: T[];
	localSuffix: T[];
	key: (item: T) => string;
}): LocalPrecedenceResult<T> {
	const local = [...options.localPath, ...options.localSuffix];
	const localPathKeys = new Set(options.localPath.map(options.key));
	const localEffective = [
		...options.localPath,
		...options.localSuffix.filter((item) => !localPathKeys.has(options.key(item))),
	];
	const localEffectiveKeys = new Set(localEffective.map(options.key));
	const sharedEffective = options.shared.filter(
		(item) => !localEffectiveKeys.has(options.key(item)),
	);
	return {
		local,
		localEffective,
		sharedEffective,
		localEffectiveKeys,
	};
}
