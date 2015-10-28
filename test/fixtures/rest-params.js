export default function countArgs(...args: Array<number>): number
{
	return args.length;
}

function noAnnotation(...unannotated) {
	return countArgs(...unannotated);
}