function countArgs(...args: Array<number>|number): number
{
	return args.length;
}

export default function test(): number
{
	return countArgs();
}