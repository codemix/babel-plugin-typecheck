export default function countArgs(...args: Array<number>): number {
	return args.length;
}

export default function countArgs2(...args2: Array<number>|Array<string>): number {
	return args2.length;
}

function noAnnotation(...unannotated) {
	countArgs2(...unannotated);
	return countArgs(...unannotated);
}